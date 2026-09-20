require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_db',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'inventory-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.path = req.path;
  next();
});

const query = (sql, params = []) => pool.query(sql, params).then(([rows]) => rows);
const redirectWithMessage = (res, pathName, type, message) => res.redirect(`${pathName}?${type}=${encodeURIComponent(message)}`);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function renderOptions(items, selected = '') {
  return items.map(item => `<option value="${item.id}" ${String(item.id) === String(selected) ? 'selected' : ''}>${item.name}</option>`).join('');
}

app.get('/login', (req, res) => res.render('login', { error: req.query.error }));
app.post('/login', async (req, res) => {
  try {
    const users = await query('SELECT * FROM users WHERE email = ?', [req.body.email]);
    const user = users[0];
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
      return redirectWithMessage(res, '/login', 'error', 'Invalid email or password');
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (error) {
    redirectWithMessage(res, '/login', 'error', 'Database connection failed. Check your .env settings.');
  }
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/', requireAuth, async (req, res) => {
  const [stats, lowStock, recentSales, recentPurchases] = await Promise.all([
    query('SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM suppliers) AS suppliers, (SELECT COALESCE(SUM(stock), 0) FROM products) AS units, (SELECT COALESCE(SUM(total), 0) FROM sales) AS revenue'),
    query('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.stock <= p.reorder_level ORDER BY p.stock ASC LIMIT 6'),
    query('SELECT s.*, COUNT(si.id) AS items FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id GROUP BY s.id ORDER BY s.sold_at DESC LIMIT 5'),
    query('SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.purchased_at DESC LIMIT 5')
  ]);
  res.render('dashboard', { stats: stats[0], lowStock, recentSales, recentPurchases });
});

app.get('/products', requireAuth, async (req, res) => {
  const [products, categories, suppliers] = await Promise.all([
    query('SELECT p.*, c.name AS category_name, s.name AS supplier_name FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC'),
    query('SELECT * FROM categories ORDER BY name'),
    query('SELECT * FROM suppliers ORDER BY name')
  ]);
  res.render('products', { products, categories, suppliers, message: req.query.message, error: req.query.error });
});
app.post('/products', requireAuth, async (req, res) => {
  try {
    await query('INSERT INTO products (name, sku, category_id, supplier_id, price, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.body.name, req.body.sku, req.body.category_id, req.body.supplier_id || null, req.body.price, req.body.stock || 0, req.body.reorder_level || 5]);
    redirectWithMessage(res, '/products', 'message', 'Product added successfully');
  } catch (error) { redirectWithMessage(res, '/products', 'error', error.code === 'ER_DUP_ENTRY' ? 'SKU already exists' : 'Could not add product'); }
});
app.post('/products/:id/delete', requireAuth, async (req, res) => {
  try { await query('DELETE FROM products WHERE id = ?', [req.params.id]); redirectWithMessage(res, '/products', 'message', 'Product deleted'); }
  catch (error) { redirectWithMessage(res, '/products', 'error', 'Product cannot be deleted after it has been used in a transaction'); }
});

app.get('/categories', requireAuth, async (req, res) => {
  const categories = await query('SELECT c.*, COUNT(p.id) AS product_count FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY c.name');
  res.render('categories', { categories, message: req.query.message, error: req.query.error });
});
app.post('/categories', requireAuth, async (req, res) => {
  try { await query('INSERT INTO categories (name, description) VALUES (?, ?)', [req.body.name, req.body.description]); redirectWithMessage(res, '/categories', 'message', 'Category added'); }
  catch (error) { redirectWithMessage(res, '/categories', 'error', 'Category name must be unique'); }
});

app.get('/suppliers', requireAuth, async (req, res) => {
  const suppliers = await query('SELECT s.*, COUNT(p.id) AS product_count FROM suppliers s LEFT JOIN products p ON p.supplier_id = s.id GROUP BY s.id ORDER BY s.name');
  res.render('suppliers', { suppliers, message: req.query.message, error: req.query.error });
});
app.post('/suppliers', requireAuth, async (req, res) => {
  try { await query('INSERT INTO suppliers (name, email, phone, address) VALUES (?, ?, ?, ?)', [req.body.name, req.body.email, req.body.phone, req.body.address]); redirectWithMessage(res, '/suppliers', 'message', 'Supplier added'); }
  catch (error) { redirectWithMessage(res, '/suppliers', 'error', 'Could not add supplier'); }
});

app.get('/purchases', requireAuth, async (req, res) => {
  const [purchases, suppliers, products] = await Promise.all([
    query('SELECT pu.*, s.name AS supplier_name FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id ORDER BY pu.purchased_at DESC'),
    query('SELECT * FROM suppliers ORDER BY name'),
    query('SELECT * FROM products ORDER BY name')
  ]);
  res.render('purchases', { purchases, suppliers, products, message: req.query.message, error: req.query.error });
});
app.post('/purchases', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const quantity = Number(req.body.quantity);
    const unitCost = Number(req.body.unit_cost);
    const [purchase] = await connection.query('INSERT INTO purchases (supplier_id, total) VALUES (?, ?)', [req.body.supplier_id, quantity * unitCost]);
    await connection.query('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', [purchase.insertId, req.body.product_id, quantity, unitCost]);
    await connection.query('UPDATE products SET stock = stock + ?, price = ? WHERE id = ?', [quantity, unitCost, req.body.product_id]);
    await connection.commit();
    redirectWithMessage(res, '/purchases', 'message', 'Purchase recorded and stock updated');
  } catch (error) { await connection.rollback(); redirectWithMessage(res, '/purchases', 'error', 'Could not record purchase'); }
  finally { connection.release(); }
});

app.get('/sales', requireAuth, async (req, res) => {
  const [sales, products] = await Promise.all([
    query('SELECT sa.*, COUNT(si.id) AS items FROM sales sa LEFT JOIN sale_items si ON si.sale_id = sa.id GROUP BY sa.id ORDER BY sa.sold_at DESC'),
    query('SELECT * FROM products WHERE stock > 0 ORDER BY name')
  ]);
  res.render('sales', { sales, products, message: req.query.message, error: req.query.error });
});
app.post('/sales', requireAuth, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const quantity = Number(req.body.quantity);
    await connection.beginTransaction();
    const [productRows] = await connection.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [req.body.product_id]);
    const product = productRows[0];
    if (!product || product.stock < quantity || quantity < 1) throw new Error('INSUFFICIENT_STOCK');
    const total = quantity * Number(product.price);
    const [sale] = await connection.query('INSERT INTO sales (customer_name, total) VALUES (?, ?)', [req.body.customer_name, total]);
    await connection.query('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)', [sale.insertId, product.id, quantity, product.price]);
    await connection.query('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, product.id]);
    await connection.commit();
    redirectWithMessage(res, '/sales', 'message', 'Sale recorded and stock reduced');
  } catch (error) { await connection.rollback(); redirectWithMessage(res, '/sales', 'error', error.message === 'INSUFFICIENT_STOCK' ? 'Insufficient stock for this sale' : 'Could not record sale'); }
  finally { connection.release(); }
});

app.get('/reports', requireAuth, async (req, res) => {
  const [topProducts, categoryStock, monthlySales] = await Promise.all([
    query('SELECT p.name, p.sku, p.stock, COALESCE(SUM(si.quantity), 0) AS sold FROM products p LEFT JOIN sale_items si ON si.product_id = p.id GROUP BY p.id ORDER BY sold DESC LIMIT 10'),
    query('SELECT c.name, COALESCE(SUM(p.stock), 0) AS units FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY units DESC'),
    query("SELECT DATE_FORMAT(sold_at, '%b %Y') AS month, SUM(total) AS revenue FROM sales GROUP BY YEAR(sold_at), MONTH(sold_at) ORDER BY YEAR(sold_at) DESC, MONTH(sold_at) DESC LIMIT 6")
  ]);
  res.render('reports', { topProducts, categoryStock, monthlySales });
});

async function start() {
  try {
    await query('SELECT 1');
    const password = await bcrypt.hash('admin123', 10);
    await query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id', ['Administrator', 'admin@inventory.local', password, 'admin']);
    app.listen(port, () => console.log(`Inventory system running at http://localhost:${port}`));
  } catch (error) {
    console.error('Unable to connect to MySQL. Import schema.sql and check your .env file.');
    console.error(error.message);
    process.exit(1);
  }
}

start();
