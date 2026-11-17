const envFile = process.env.ENV_FILE;
const envResult = require('dotenv').config(envFile ? { path: envFile } : undefined);
if (envFile && envResult.error) throw envResult.error;
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const formatMoney = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatRoundedMoney = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  socketPath: process.env.DB_SOCKET_PATH || undefined,
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
  res.locals.currencySymbol = '₹';
  res.locals.currencyCode = 'INR';
  res.locals.formatMoney = amount => formatMoney.format(Number(amount));
  res.locals.formatRoundedMoney = amount => formatRoundedMoney.format(Number(amount));
  res.locals.hasDemoData = Boolean(app.locals.hasDemoData);
  next();
});

const query = (sql, params = []) => pool.query(sql, params).then(([rows]) => rows);
const redirectWithMessage = (res, pathName, type, message) => res.redirect(`${pathName}?${type}=${encodeURIComponent(message)}`);
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.redirect(req.session.user.role === 'supplier' ? '/supplier' : '/login?error=Admin%20access%20required');
  next();
}

function requireAdminOrWelcome(req, res, next) {
  if (!req.session.user) return res.render('welcome');
  return requireAdmin(req, res, next);
}

function requireSupplier(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'supplier' || !req.session.user.supplierId) return res.redirect('/');
  next();
}

function renderOptions(items, selected = '') {
  return items.map(item => `<option value="${item.id}" ${String(item.id) === String(selected) ? 'selected' : ''}>${item.name}</option>`).join('');
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildSalesSeries(rows, period, count, anchor) {
  if (!anchor) return [];

  const end = new Date(`${anchor}T00:00:00.000Z`);
  const start = new Date(end);
  if (period === 'day') {
    start.setUTCDate(start.getUTCDate() - count + 1);
  } else if (period === 'week') {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    start.setUTCDate(start.getUTCDate() - (count - 1) * 7);
    end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  } else if (period === 'month') {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - count + 1);
    end.setUTCDate(1);
  } else {
    start.setUTCMonth(0, 1);
    start.setUTCFullYear(start.getUTCFullYear() - count + 1);
    end.setUTCMonth(0, 1);
  }

  const totalsByBucket = new Map(rows.map(row => [
    String(row.bucket).slice(0, 10),
    { revenue: Number(row.revenue), transactions: Number(row.transactions) }
  ]));
  const series = [];
  const cursor = new Date(start);

  while (cursor <= end && series.length < count) {
    const key = dateKey(cursor);
    const bucket = period === 'week'
      ? key
      : period === 'month'
        ? `${key.slice(0, 7)}-01`
        : period === 'year'
          ? `${key.slice(0, 4)}-01-01`
          : key;
    const values = totalsByBucket.get(bucket) || { revenue: 0, transactions: 0 };
    const label = period === 'day'
      ? cursor.toLocaleDateString('en', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
      : period === 'week'
        ? cursor.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        : period === 'month'
          ? cursor.toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })
          : String(cursor.getUTCFullYear());

    series.push({ label, revenue: values.revenue, transactions: values.transactions });
    if (period === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (period === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else if (period === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }

  return series;
}

app.get('/login', (req, res) => res.render('login', { error: req.query.error }));
app.post('/login', async (req, res) => {
  try {
    const users = await query('SELECT * FROM users WHERE email = ?', [req.body.email]);
    const user = users[0];
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
      return redirectWithMessage(res, '/login', 'error', 'Invalid email or password');
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, supplierId: user.supplier_id };
    res.redirect(user.role === 'supplier' ? '/supplier' : '/');
  } catch (error) {
    redirectWithMessage(res, '/login', 'error', 'Database connection failed. Check your .env settings.');
  }
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/', requireAdminOrWelcome, async (req, res) => {
  const [stats, lowStock, recentSales, recentPurchases, popularProducts] = await Promise.all([
    query("SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM suppliers) AS suppliers, (SELECT COALESCE(SUM(stock), 0) FROM products) AS units, (SELECT COALESCE(SUM(total), 0) FROM sales) AS revenue, (SELECT COUNT(*) FROM categories WHERE description LIKE 'Seeded illustrative demo data only;%') AS demo_data"),
    query('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.stock <= p.reorder_level ORDER BY p.stock ASC LIMIT 6'),
    query('SELECT s.*, COUNT(si.id) AS items FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id GROUP BY s.id ORDER BY s.sold_at DESC LIMIT 5'),
    query('SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.purchased_at DESC LIMIT 5'),
    query('SELECT p.id, p.name, p.sku, SUM(si.quantity) AS units_sold FROM products p JOIN sale_items si ON si.product_id = p.id GROUP BY p.id, p.name, p.sku ORDER BY units_sold DESC, p.name LIMIT 5')
  ]);
  res.render('dashboard', { stats: stats[0], lowStock, recentSales, recentPurchases, popularProducts, hasDemoData: Number(stats[0].demo_data) > 0 });
});

app.get('/products', requireAdmin, async (req, res) => {
  const products = await query('SELECT p.*, c.name AS category_name, s.name AS supplier_name FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC');
  res.render('products', { products, message: req.query.message, error: req.query.error });
});
app.post('/products/:id/price', requireAdmin, async (req, res) => {
  const price = Number(req.body.price);
  try {
    const result = await query('UPDATE products SET price = ? WHERE id = ? AND ? >= supplier_unit_cost', [price, req.params.id, price]);
    if (!result.affectedRows) return redirectWithMessage(res, '/products', 'error', 'Retail price must be at least the supplier cost');
    redirectWithMessage(res, '/products', 'message', 'Retail price updated');
  } catch (error) { redirectWithMessage(res, '/products', 'error', 'Could not update retail price'); }
});
app.post('/products/:id/delete', requireAdmin, async (req, res) => {
  try { await query('DELETE FROM products WHERE id = ?', [req.params.id]); redirectWithMessage(res, '/products', 'message', 'Product deleted'); }
  catch (error) { redirectWithMessage(res, '/products', 'error', 'Product cannot be deleted after it has been used in a transaction'); }
});

app.get('/categories', requireAdmin, async (req, res) => {
  const categories = await query('SELECT c.*, COUNT(p.id) AS product_count FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY c.name');
  res.render('categories', { categories, message: req.query.message, error: req.query.error });
});
app.post('/categories', requireAdmin, async (req, res) => {
  try { await query('INSERT INTO categories (name, description) VALUES (?, ?)', [req.body.name, req.body.description]); redirectWithMessage(res, '/categories', 'message', 'Category added'); }
  catch (error) { redirectWithMessage(res, '/categories', 'error', 'Category name must be unique'); }
});

app.get('/suppliers', requireAdmin, async (req, res) => {
  const suppliers = await query('SELECT s.*, u.email AS login_email, COUNT(DISTINCT p.id) AS product_count FROM suppliers s LEFT JOIN users u ON u.supplier_id = s.id LEFT JOIN products p ON p.supplier_id = s.id GROUP BY s.id, u.email ORDER BY s.name');
  res.render('suppliers', { suppliers, message: req.query.message, error: req.query.error });
});
app.post('/suppliers', requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.body.email || !req.body.password || req.body.password.length < 8) throw new Error('INVALID_CREDENTIALS');
    await connection.beginTransaction();
    const [supplier] = await connection.query('INSERT INTO suppliers (name, email, phone, address) VALUES (?, ?, ?, ?)', [req.body.name, req.body.email, req.body.phone, req.body.address]);
    const password = await bcrypt.hash(req.body.password, 10);
    await connection.query('INSERT INTO users (name, email, password, role, supplier_id) VALUES (?, ?, ?, ?, ?)', [req.body.name, req.body.email, password, 'supplier', supplier.insertId]);
    await connection.commit();
    redirectWithMessage(res, '/suppliers', 'message', 'Supplier and login created');
  } catch (error) {
    await connection.rollback();
    redirectWithMessage(res, '/suppliers', 'error', error.message === 'INVALID_CREDENTIALS' ? 'Enter a login email and password with at least 8 characters' : error.code === 'ER_DUP_ENTRY' ? 'That login email already exists' : 'Could not add supplier');
  } finally { connection.release(); }
});
app.post('/suppliers/:id/account', requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.body.email || !req.body.password || req.body.password.length < 8) throw new Error('INVALID_CREDENTIALS');
    await connection.beginTransaction();
    const [suppliers] = await connection.query('SELECT * FROM suppliers WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!suppliers[0]) throw new Error('NOT_FOUND');
    const password = await bcrypt.hash(req.body.password, 10);
    await connection.query('INSERT INTO users (name, email, password, role, supplier_id) VALUES (?, ?, ?, ?, ?)', [suppliers[0].name, req.body.email, password, 'supplier', suppliers[0].id]);
    await connection.commit();
    redirectWithMessage(res, '/suppliers', 'message', 'Supplier login created');
  } catch (error) {
    await connection.rollback();
    redirectWithMessage(res, '/suppliers', 'error', error.message === 'INVALID_CREDENTIALS' ? 'Enter a login email and password with at least 8 characters' : error.code === 'ER_DUP_ENTRY' ? 'That email or supplier login already exists' : 'Could not create supplier login');
  } finally { connection.release(); }
});

app.get('/purchases', requireAdmin, async (req, res) => {
  const [purchases, suppliers, products] = await Promise.all([
    query('SELECT pu.*, s.name AS supplier_name, GROUP_CONCAT(CONCAT(pr.name, " x", pi.quantity) SEPARATOR ", ") AS items FROM purchases pu JOIN suppliers s ON s.id = pu.supplier_id LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id LEFT JOIN products pr ON pr.id = pi.product_id GROUP BY pu.id, s.name ORDER BY pu.purchased_at DESC'),
    query('SELECT * FROM suppliers ORDER BY name'),
    query('SELECT * FROM products WHERE supplier_id IS NOT NULL ORDER BY name')
  ]);
  res.render('purchases', { purchases, suppliers, products, message: req.query.message, error: req.query.error });
});
app.post('/purchases', requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const quantity = Number(req.body.quantity);
    const [products] = await connection.query('SELECT * FROM products WHERE id = ? AND supplier_id = ? FOR UPDATE', [req.body.product_id, req.body.supplier_id]);
    if (!products[0] || !Number.isInteger(quantity) || quantity < 1) throw new Error('INVALID_REQUEST');
    const [purchase] = await connection.query('INSERT INTO purchases (supplier_id, total, status) VALUES (?, ?, ?)', [req.body.supplier_id, quantity * Number(products[0].supplier_unit_cost), 'pending']);
    await connection.query('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', [purchase.insertId, req.body.product_id, quantity, products[0].supplier_unit_cost]);
    await connection.commit();
    redirectWithMessage(res, '/purchases', 'message', 'Purchase request sent to supplier');
  } catch (error) { await connection.rollback(); redirectWithMessage(res, '/purchases', 'error', error.message === 'INVALID_REQUEST' ? 'Choose a product from that supplier and enter a valid quantity' : 'Could not send purchase request'); }
  finally { connection.release(); }
});
app.post('/purchases/:id/receive', requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [purchases] = await connection.query('SELECT * FROM purchases WHERE id = ? AND status = "available" FOR UPDATE', [req.params.id]);
    if (!purchases[0]) throw new Error('NOT_READY');
    const [items] = await connection.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [req.params.id]);
    for (const item of items) await connection.query('UPDATE products SET stock = stock + ? WHERE id = ?', [item.quantity, item.product_id]);
    await connection.query('UPDATE purchases SET status = "received" WHERE id = ?', [req.params.id]);
    await connection.commit();
    redirectWithMessage(res, '/purchases', 'message', 'Stock received and inventory updated');
  } catch (error) {
    await connection.rollback();
    redirectWithMessage(res, '/purchases', 'error', error.message === 'NOT_READY' ? 'This request is not ready to receive' : 'Could not receive purchase');
  } finally { connection.release(); }
});

app.get('/supplier', requireSupplier, async (req, res) => {
  const [products, requests, categories] = await Promise.all([
    query('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.supplier_id = ? ORDER BY p.name', [req.session.user.supplierId]),
    query('SELECT pu.*, GROUP_CONCAT(CONCAT(pr.name, " x", pi.quantity) SEPARATOR ", ") AS items FROM purchases pu LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id LEFT JOIN products pr ON pr.id = pi.product_id WHERE pu.supplier_id = ? GROUP BY pu.id ORDER BY pu.purchased_at DESC', [req.session.user.supplierId]),
    query('SELECT * FROM categories ORDER BY name')
  ]);
  res.render('supplier', { products, requests, categories, message: req.query.message, error: req.query.error });
});
app.post('/supplier/products', requireSupplier, async (req, res) => {
  try {
    const cost = Number(req.body.supplier_unit_cost);
    const quantity = Number(req.body.supplier_stock);
    if (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(quantity) || quantity < 0) throw new Error('INVALID_VALUES');
    await query('INSERT INTO products (name, sku, category_id, supplier_id, supplier_unit_cost, supplier_stock, price, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 5)', [req.body.name, req.body.sku, req.body.category_id, req.session.user.supplierId, cost, quantity, cost]);
    redirectWithMessage(res, '/supplier', 'message', 'Catalog product added; retail price is awaiting admin review');
  } catch (error) { redirectWithMessage(res, '/supplier', 'error', error.code === 'ER_DUP_ENTRY' ? 'That SKU already exists' : 'Could not add catalog product'); }
});
app.post('/supplier/products/:id/update', requireSupplier, async (req, res) => {
  const cost = Number(req.body.supplier_unit_cost);
  const quantity = Number(req.body.supplier_stock);
  if (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(quantity) || quantity < 0) return redirectWithMessage(res, '/supplier', 'error', 'Enter a valid cost and available quantity');
  try {
    const result = await query('UPDATE products SET supplier_unit_cost = ?, supplier_stock = ? WHERE id = ? AND supplier_id = ?', [cost, quantity, req.params.id, req.session.user.supplierId]);
    redirectWithMessage(res, '/supplier', result.affectedRows ? 'message' : 'error', result.affectedRows ? 'Catalog updated' : 'Product not found');
  } catch (error) { redirectWithMessage(res, '/supplier', 'error', 'Could not update catalog'); }
});
app.post('/supplier/requests/:id/respond', requireSupplier, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM purchases WHERE id = ? AND supplier_id = ? AND status = "pending" FOR UPDATE', [req.params.id, req.session.user.supplierId]);
    if (!rows[0] || !['available', 'insufficient'].includes(req.body.status)) throw new Error('INVALID_REQUEST');
    const [items] = await connection.query('SELECT pi.*, p.supplier_stock, p.supplier_unit_cost FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? AND p.supplier_id = ? FOR UPDATE', [req.params.id, req.session.user.supplierId]);
    if (!items.length) throw new Error('INVALID_REQUEST');
    const isAvailable = req.body.status === 'available' && items.every(item => item.supplier_stock >= item.quantity);
    if (isAvailable) {
      let total = 0;
      for (const item of items) {
        total += Number(item.quantity) * Number(item.supplier_unit_cost);
        await connection.query('UPDATE products SET supplier_stock = supplier_stock - ? WHERE id = ?', [item.quantity, item.product_id]);
        await connection.query('UPDATE purchase_items SET unit_cost = ? WHERE id = ?', [item.supplier_unit_cost, item.id]);
      }
      await connection.query('UPDATE purchases SET status = "available", total = ? WHERE id = ?', [total, req.params.id]);
    } else {
      await connection.query('UPDATE purchases SET status = "insufficient" WHERE id = ?', [req.params.id]);
    }
    await connection.commit();
    redirectWithMessage(res, '/supplier', 'message', isAvailable ? 'Availability confirmed; stock reserved for the request' : 'Request marked as insufficient stock');
  } catch (error) {
    await connection.rollback();
    redirectWithMessage(res, '/supplier', 'error', error.message === 'INVALID_REQUEST' ? 'That request is no longer pending or is not yours' : 'Could not respond to request');
  } finally { connection.release(); }
});

app.get('/sales', requireAdmin, asyncRoute(async (req, res) => {
  const [sales, products, summaryRows, latestRows, dailyRows, weeklyRows, monthlyRows, yearlyRows] = await Promise.all([
    query('SELECT sa.*, COUNT(si.id) AS items FROM sales sa LEFT JOIN sale_items si ON si.sale_id = sa.id GROUP BY sa.id ORDER BY sa.sold_at DESC'),
    query('SELECT * FROM products WHERE stock > 0 ORDER BY name'),
    query(`
      SELECT
        COALESCE(SUM(CASE WHEN sold_at >= CURDATE()
          AND sold_at < CURDATE() + INTERVAL 1 DAY THEN total ELSE 0 END), 0) AS today_revenue,
        COALESCE(SUM(CASE WHEN sold_at >= CURDATE()
          AND sold_at < CURDATE() + INTERVAL 1 DAY THEN 1 ELSE 0 END), 0) AS today_count,
        COALESCE(SUM(CASE WHEN YEARWEEK(sold_at, 3) = YEARWEEK(CURDATE(), 3)
          THEN total ELSE 0 END), 0) AS week_revenue,
        COALESCE(SUM(CASE WHEN YEARWEEK(sold_at, 3) = YEARWEEK(CURDATE(), 3)
          THEN 1 ELSE 0 END), 0) AS week_count,
        COALESCE(SUM(CASE WHEN YEAR(sold_at) = YEAR(CURDATE())
          AND MONTH(sold_at) = MONTH(CURDATE()) THEN total ELSE 0 END), 0) AS month_revenue,
        COALESCE(SUM(CASE WHEN YEAR(sold_at) = YEAR(CURDATE())
          AND MONTH(sold_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END), 0) AS month_count,
        COALESCE(SUM(CASE WHEN YEAR(sold_at) = YEAR(CURDATE())
          THEN total ELSE 0 END), 0) AS year_revenue,
        COALESCE(SUM(CASE WHEN YEAR(sold_at) = YEAR(CURDATE())
          THEN 1 ELSE 0 END), 0) AS year_count
      FROM sales
    `),
    query("SELECT DATE_FORMAT(MAX(sold_at), '%Y-%m-%d') AS latest_date FROM sales"),
    query("SELECT DATE_FORMAT(sold_at, '%Y-%m-%d') AS bucket, SUM(total) AS revenue, COUNT(*) AS transactions FROM sales GROUP BY DATE_FORMAT(sold_at, '%Y-%m-%d')"),
    query("SELECT DATE_FORMAT(DATE_SUB(DATE(sold_at), INTERVAL WEEKDAY(sold_at) DAY), '%Y-%m-%d') AS bucket, SUM(total) AS revenue, COUNT(*) AS transactions FROM sales GROUP BY DATE_FORMAT(DATE_SUB(DATE(sold_at), INTERVAL WEEKDAY(sold_at) DAY), '%Y-%m-%d')"),
    query("SELECT DATE_FORMAT(sold_at, '%Y-%m-01') AS bucket, SUM(total) AS revenue, COUNT(*) AS transactions FROM sales GROUP BY DATE_FORMAT(sold_at, '%Y-%m-01')"),
    query("SELECT DATE_FORMAT(sold_at, '%Y-01-01') AS bucket, SUM(total) AS revenue, COUNT(*) AS transactions FROM sales GROUP BY DATE_FORMAT(sold_at, '%Y-01-01')")
  ]);
  const latestSaleDate = latestRows[0].latest_date;
  const trends = {
    daily: buildSalesSeries(dailyRows, 'day', 7, latestSaleDate),
    weekly: buildSalesSeries(weeklyRows, 'week', 8, latestSaleDate),
    monthly: buildSalesSeries(monthlyRows, 'month', 12, latestSaleDate),
    yearly: buildSalesSeries(yearlyRows, 'year', 5, latestSaleDate)
  };
  res.render('sales', { sales, products, summary: summaryRows[0], trends, latestSaleDate, message: req.query.message, error: req.query.error });
}));
app.post('/sales', requireAdmin, async (req, res) => {
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

app.get('/reports', requireAdmin, asyncRoute(async (req, res) => {
  const [topProducts, categoryStock, monthlySales, latestRows, totalsRows, inventoryRows] = await Promise.all([
    query('SELECT p.name, p.sku, p.stock, COALESCE(SUM(si.quantity), 0) AS sold, COALESCE(SUM(si.quantity * si.unit_price), 0) AS revenue FROM products p LEFT JOIN sale_items si ON si.product_id = p.id GROUP BY p.id, p.name, p.sku, p.stock HAVING sold > 0 ORDER BY sold DESC, p.name LIMIT 10'),
    query('SELECT c.name, COALESCE(SUM(p.stock), 0) AS units, COUNT(p.id) AS products FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id, c.name ORDER BY units DESC, c.name'),
    query("SELECT DATE_FORMAT(sold_at, '%Y-%m-01') AS bucket, SUM(total) AS revenue, COUNT(*) AS transactions FROM sales GROUP BY DATE_FORMAT(sold_at, '%Y-%m-01')"),
    query("SELECT DATE_FORMAT(MAX(sold_at), '%Y-%m-%d') AS latest_date FROM sales"),
    query('SELECT COUNT(*) AS transactions, COALESCE(SUM(total), 0) AS revenue FROM sales'),
    query('SELECT COUNT(*) AS products, COALESCE(SUM(stock), 0) AS units FROM products')
  ]);
  const latestSaleDate = latestRows[0].latest_date;
  const monthlyTrend = buildSalesSeries(monthlySales, 'month', 12, latestSaleDate);
  res.render('reports', {
    topProducts,
    categoryStock,
    monthlyTrend,
    latestSaleDate,
    totals: totalsRows[0],
    inventory: inventoryRows[0]
  });
}));

app.use((error, req, res, next) => {
  console.error(`Request failed for ${req.method} ${req.path}:`, error);
  if (res.headersSent) return next(error);
  res.status(500).send('Unable to load this page. Please try again.');
});

async function start() {
  try {
    await query('SELECT 1');
    await query("ALTER TABLE users MODIFY role ENUM('admin', 'manager', 'staff', 'supplier') NOT NULL DEFAULT 'staff'");
    if (!(await query("SHOW COLUMNS FROM users LIKE 'supplier_id'")).length) await query('ALTER TABLE users ADD COLUMN supplier_id INT NULL UNIQUE');
    if (!(await query("SHOW COLUMNS FROM products LIKE 'supplier_unit_cost'")).length) await query('ALTER TABLE products ADD COLUMN supplier_unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0');
    if (!(await query("SHOW COLUMNS FROM products LIKE 'supplier_stock'")).length) await query('ALTER TABLE products ADD COLUMN supplier_stock INT NOT NULL DEFAULT 0');
    if (!(await query("SHOW COLUMNS FROM purchases LIKE 'status'")).length) await query("ALTER TABLE purchases ADD COLUMN status ENUM('pending', 'available', 'insufficient', 'received') NOT NULL DEFAULT 'received'");
    const password = await bcrypt.hash('admin123', 10);
    await query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id', ['Administrator', 'admin@inventory.local', password, 'admin']);
    const demoRows = await query("SELECT COUNT(*) AS count FROM categories WHERE description LIKE 'Seeded illustrative demo data only;%'");
    app.locals.hasDemoData = Number(demoRows[0].count) > 0;
    app.listen(port, () => console.log(`Inventory system running at http://localhost:${port}`));
  } catch (error) {
    console.error('Unable to connect to MySQL. Import schema.sql and check your .env file.');
    console.error(error.message);
    process.exit(1);
  }
}

start();
