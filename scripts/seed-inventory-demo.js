const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const envFile = process.env.ENV_FILE;
const envResult = dotenv.config(envFile ? { path: envFile } : undefined);
if (envFile && envResult.error) throw envResult.error;

const database = process.env.DB_NAME || 'inventory_db';
if (database !== 'inventory_supplier_db') {
  throw new Error(`Refusing to replace records in database "${database}". Set DB_NAME=inventory_supplier_db.`);
}
if (!process.argv.includes('--replace')) {
  throw new Error('This replaces business records. Rerun with --replace after confirming the target database.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  socketPath: process.env.DB_SOCKET_PATH || undefined,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database,
  waitForConnections: true,
  connectionLimit: 1,
  decimalNumbers: true
});

const demoDescription = 'Seeded illustrative demo data only; not verified business or inventory records.';
const categoryData = [
  ['Electronics', 'Chargers, peripherals, displays, and networking equipment.'],
  ['Stationery', 'Paper, writing supplies, files, and desk organization.'],
  ['Furniture', 'Desks, seating, lighting, and office furniture.'],
  ['Storage', 'Shelving, archive boxes, organizers, and containers.'],
  ['Cleaning & Safety', 'Cleaning products and workplace safety supplies.']
];

const supplierData = [
  ['Northstar Office Supply', 'orders@northstar.example', null, 'Pune, India'],
  ['Brightline Technology Wholesale', 'orders@brightline.example', null, 'Bengaluru, India'],
  ['Papertrail Stationery', 'orders@papertrail.example', null, 'New Delhi, India'],
  ['Oak & Iron Furnishings', 'orders@oakandiron.example', null, 'Mumbai, India'],
  ['ClearBox Storage Solutions', 'orders@clearbox.example', null, 'Hyderabad, India'],
  ['Citywide Workplace Safety', 'orders@citywide.example', null, 'Chennai, India']
];

const productGroups = [
  [
    ['USB-C 65W Laptop Charger', 1600, 2799], ['USB-C Hub, 7-port', 1800, 3299],
    ['Wireless Optical Mouse', 650, 1299], ['Mechanical Keyboard, TKL', 2400, 4499],
    ['27-inch QHD Monitor', 14500, 22999], ['Noise-cancelling Headphones', 5200, 8999],
    ['1080p USB Webcam', 2200, 3999], ['Portable SSD, 1 TB', 5800, 9999],
    ['Wi-Fi 6 Router', 5200, 8999]
  ],
  [
    ['A4 Copy Paper, 500 sheets', 240, 399], ['Hardcover Notebook, A5', 100, 199],
    ['Blue Ballpoint Pens, box of 50', 300, 599], ['Permanent Markers, 12 pack', 240, 449],
    ['Lever Arch File, A4', 100, 199], ['Sticky Notes, assorted pack', 120, 249],
    ['Desk Organizer Tray', 650, 1199], ['Black Printer Toner Cartridge', 2800, 4999],
    ['Whiteboard Markers, 4 pack', 250, 449]
  ],
  [
    ['Ergonomic Office Chair, black', 9500, 15999], ['Height-adjustable Desk, 120 cm', 19000, 31999],
    ['Folding Visitor Chair', 2200, 3999], ['Bamboo Monitor Riser', 1200, 2299],
    ['Two-drawer Filing Cabinet', 7500, 12999], ['Six-seat Meeting Table', 16500, 27999],
    ['Adjustable Footrest', 900, 1699], ['LED Task Lamp', 1250, 2299],
    ['Mobile Three-drawer Pedestal', 6200, 10999]
  ],
  [
    ['Stackable Storage Bin, 20 L', 350, 699], ['A4 Archive Box, pack of 10', 700, 1299],
    ['Four-tier Wire Shelving Unit', 4200, 6999], ['Parts Organizer, 24 compartments', 650, 1199],
    ['Lockable Document Box', 1100, 1999], ['Cable Management Box', 450, 899],
    ['Label Holder, pack of 20', 250, 449], ['Lidded Tote, 45 L', 900, 1599],
    ['Under-desk Drawer Unit', 3500, 5999]
  ],
  [
    ['Nitrile Gloves, box of 100', 350, 699], ['Microfiber Cloths, pack of 10', 250, 499],
    ['Surface Cleaner, 5 L', 450, 799], ['Hand Sanitiser, 500 ml', 150, 299],
    ['Clear Safety Glasses', 180, 349], ['Workplace First Aid Kit', 1350, 2499],
    ['Bin Liners, roll of 50', 220, 399], ['Paper Towels, pack of 6', 480, 899],
    ['Spill Absorbent Granules, 10 kg', 1100, 1999]
  ]
];

const suppliersByCategory = [[0, 1], [2, 0], [3, 0], [4, 0], [5, 0]];
const lowStockIndexes = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40]);
const customers = [
  'Westbridge Design Studio', 'Riverside Learning Centre', 'North End Architects',
  'Greenfield Accountancy', 'Market Street Printworks', 'Hilltop Community Hub',
  'Redwood Property Services', 'Walk-in Customer', 'Sample Office Account'
];
const supplierPassword = 'SupplierDemo123!';
const salesCount = 300;
const purchasesCount = 300;
const historyDays = 1460;

function daysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function daysBefore(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function eventAge(index, count) {
  const recentDailyCount = Math.min(7, count);
  if (index >= count - recentDailyCount) return count - index - 1;

  const spreadCount = count - recentDailyCount;
  return recentDailyCount + Math.round(
    (spreadCount - index - 1) * (historyDays - recentDailyCount) / (spreadCount - 1)
  );
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function salesTarget(random, saleIndex) {
  if (saleIndex === salesCount - 4) return 140000 + Math.floor(random() * 40001);
  const band = random();
  if (band < 0.7) return 30000 + Math.floor(random() * 50001);
  if (band < 0.95) return 80000 + Math.floor(random() * 45001);
  return 125000 + Math.floor(random() * 55001);
}

function money(amount) {
  return Number(amount).toFixed(2);
}

async function main() {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const [adminRows] = await connection.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (!adminRows.length) throw new Error('No admin login exists; start the app once before seeding.');

    await connection.beginTransaction();
    transactionStarted = true;
    await connection.query('DELETE FROM sale_items');
    await connection.query('DELETE FROM sales');
    await connection.query('DELETE FROM purchase_items');
    await connection.query('DELETE FROM purchases');
    await connection.query('DELETE FROM products');
    await connection.query("DELETE FROM users WHERE role <> 'admin'");
    await connection.query('DELETE FROM suppliers');
    await connection.query('DELETE FROM categories');

    const categoryIds = [];
    for (const [name, description] of categoryData) {
      const [result] = await connection.execute(
        'INSERT INTO categories (name, description) VALUES (?, ?)',
        [name, `${demoDescription} ${description}`]
      );
      categoryIds.push(result.insertId);
    }

    const supplierIds = [];
    for (const [name, email, phone, address] of supplierData) {
      const [result] = await connection.execute(
        'INSERT INTO suppliers (name, email, phone, address) VALUES (?, ?, ?, ?)',
        [name, email, phone, address]
      );
      supplierIds.push(result.insertId);
    }

    const supplierHash = await bcrypt.hash(supplierPassword, 10);
    for (let index = 0; index < supplierIds.length; index += 1) {
      await connection.execute(
        'INSERT INTO users (name, email, password, role, supplier_id) VALUES (?, ?, ?, ?, ?)',
        [supplierData[index][0], supplierData[index][1], supplierHash, 'supplier', supplierIds[index]]
      );
    }

    const products = productGroups.flatMap((group, categoryIndex) =>
      group.map(([name, cost, price], itemIndex) => {
        const supplierOptions = suppliersByCategory[categoryIndex];
        const supplierIndex = supplierOptions[itemIndex % supplierOptions.length];
        const index = categoryIndex * group.length + itemIndex;
        const categoryCode = ['ELEC', 'STAT', 'FURN', 'STOR', 'SAFE'][categoryIndex];
        return {
          index,
          name,
          sku: `${categoryCode}-${String(itemIndex + 1).padStart(3, '0')}`,
          categoryId: categoryIds[categoryIndex],
          supplierId: supplierIds[supplierIndex],
          cost,
          price
        };
      })
    );

    const random = seededRandom(20261117);
    const sales = Array.from({ length: salesCount }, (_, saleIndex) => {
      const targetRevenue = salesTarget(random, saleIndex);
      const quantities = new Map();
      const anchorIndex = saleIndex % products.length;
      quantities.set(anchorIndex, 1);

      let total = products[anchorIndex].price;
      let attempts = 0;
      while (total < targetRevenue && attempts < 1000) {
        attempts += 1;
        const availableIndexes = products
          .map((product, index) => index)
          .filter(index => !quantities.has(index));
        if (!availableIndexes.length) break;

        const productIndex = availableIndexes[Math.floor(random() * availableIndexes.length)];
        const product = products[productIndex];
        const remaining = targetRevenue - total;
        const maxQuantity = product.price >= 15000 ? 3 : product.price >= 5000 ? 8 : 30;
        const quantity = Math.min(maxQuantity, Math.max(1, Math.ceil(remaining / product.price)));
        quantities.set(productIndex, quantity);
        total += product.price * quantity;
      }

      if (total < targetRevenue) {
        throw new Error(`Could not meet the sales target for transaction ${saleIndex + 1}.`);
      }

      const items = Array.from(quantities, ([productIndex, quantity]) => ({ productIndex, quantity }));
      return {
        saleIndex,
        soldAt: daysAgo(eventAge(saleIndex, salesCount)),
        items,
        total
      };
    });

    const purchases = Array.from({ length: purchasesCount }, (_, index) => {
      const statusRoll = random();
      const status = statusRoll < 0.75
        ? 'received'
        : statusRoll < 0.87
          ? 'pending'
          : statusRoll < 0.95
            ? 'available'
            : 'insufficient';
      return {
        productIndex: index % products.length,
        status,
        quantity: 0,
        receivedQuantity: 0,
        reservedQuantity: 0,
        purchasedAt: daysAgo(eventAge(index, purchasesCount))
      };
    });

    const salesByProduct = products.map(() => []);
    for (const sale of sales) {
      for (const item of sale.items) {
        salesByProduct[item.productIndex].push({ soldAt: sale.soldAt, quantity: item.quantity });
      }
    }

    const purchaseIndexesByProduct = products.map(() => []);
    for (let index = 0; index < purchases.length; index += 1) {
      purchaseIndexesByProduct[purchases[index].productIndex].push(index);
    }

    const endingStockByProduct = products.map((_, index) => (
      lowStockIndexes.has(index) ? 2 + index % 3 : 12 + index % 9
    ));
    const reservedByProduct = Array(products.length).fill(0);
    for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
      const orderIndexes = purchaseIndexesByProduct[productIndex];
      let receivedIndexes = orderIndexes.filter(index => purchases[index].status === 'received');
      if (!receivedIndexes.length) {
        purchases[orderIndexes[0]].status = 'received';
        receivedIndexes = [orderIndexes[0]];
      }

      const productSales = salesByProduct[productIndex]
        .sort((left, right) => left.soldAt - right.soldAt);
      receivedIndexes.forEach((purchaseIndex, groupIndex) => {
        const start = Math.floor(groupIndex * productSales.length / receivedIndexes.length);
        const end = Math.floor((groupIndex + 1) * productSales.length / receivedIndexes.length);
        const groupSales = productSales.slice(start, end);
        const soldQuantity = groupSales.reduce((sum, sale) => sum + sale.quantity, 0);
        const endingStock = groupIndex === receivedIndexes.length - 1
          ? endingStockByProduct[productIndex]
          : 0;
        const purchase = purchases[purchaseIndex];
        purchase.quantity = Math.max(1, soldQuantity + endingStock);
        purchase.receivedQuantity = purchase.quantity;
        purchase.purchasedAt = groupSales.length
          ? daysBefore(groupSales[0].soldAt, 1 + Math.floor(random() * 14))
          : daysAgo(eventAge(purchaseIndex, purchasesCount));
      });

      for (const purchaseIndex of orderIndexes) {
        const purchase = purchases[purchaseIndex];
        if (purchase.status === 'received') continue;
        purchase.quantity = 8 + Math.floor(random() * 23);
        if (purchase.status === 'available') {
          purchase.reservedQuantity = purchase.quantity;
          reservedByProduct[productIndex] += purchase.quantity;
        }
      }
    }

    const productIds = [];
    for (const product of products) {
      const [result] = await connection.execute(
        `INSERT INTO products
         (name, sku, category_id, supplier_id, supplier_unit_cost, supplier_stock, price, stock, reorder_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5)`,
        [
          product.name, product.sku, product.categoryId, product.supplierId,
          money(product.cost), reservedByProduct[product.index] + 50,
          money(product.price), 0
        ]
      );
      productIds.push(result.insertId);
    }

    for (const purchase of purchases) {
      const product = products[purchase.productIndex];
      const total = product.cost * purchase.quantity;
      const [result] = await connection.execute(
        'INSERT INTO purchases (supplier_id, total, status, purchased_at) VALUES (?, ?, ?, ?)',
        [product.supplierId, money(total), purchase.status, purchase.purchasedAt]
      );
      await connection.execute(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)',
        [result.insertId, productIds[purchase.productIndex], purchase.quantity, money(product.cost)]
      );
      if (purchase.receivedQuantity) {
        await connection.execute(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [purchase.receivedQuantity, productIds[purchase.productIndex]]
        );
      }
    }

    for (const sale of sales) {
      const [result] = await connection.execute(
        'INSERT INTO sales (customer_name, total, sold_at) VALUES (?, ?, ?)',
        [`DEMO-SALES - ${customers[sale.saleIndex % customers.length]}`, money(sale.total), sale.soldAt]
      );
      for (const item of sale.items) {
        const product = products[item.productIndex];
        await connection.execute(
          'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [result.insertId, productIds[item.productIndex], item.quantity, money(product.price)]
        );
        await connection.execute(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [item.quantity, productIds[item.productIndex]]
        );
      }
    }

    const [validationRows] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM purchases) AS purchases,
        (SELECT COUNT(*) FROM products WHERE stock < 0) AS negative_stock,
        (SELECT COUNT(*) FROM sales s
         WHERE ABS(s.total - (
           SELECT COALESCE(SUM(si.quantity * si.unit_price), 0)
           FROM sale_items si WHERE si.sale_id = s.id
         )) > 0.01) AS mismatched_sales
    `);
    const validation = validationRows[0];
    if (
      Number(validation.sales) !== salesCount
      || Number(validation.purchases) !== purchasesCount
      || Number(validation.negative_stock) !== 0
      || Number(validation.mismatched_sales) !== 0
    ) {
      throw new Error('Generated data failed count, stock, or sales-total validation.');
    }

    await connection.commit();
    transactionStarted = false;

    const [counts] = await connection.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM suppliers) AS suppliers,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM purchases) AS purchases,
        (SELECT COUNT(*) FROM purchase_items) AS purchase_items,
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM sale_items) AS sale_items,
        (SELECT ROUND(SUM(total), 2) FROM sales) AS sales_revenue,
        (SELECT COUNT(*) FROM sales WHERE total >= 100000) AS sales_over_100k,
        (SELECT DATE_FORMAT(MIN(sold_at), '%Y-%m-%d') FROM sales) AS first_sale,
        (SELECT DATE_FORMAT(MAX(sold_at), '%Y-%m-%d') FROM sales) AS last_sale
    `);
    console.log('Illustrative inventory data seeded; existing business records were replaced.');
    console.log(`Supplier demo login password: ${supplierPassword}`);
    console.table(counts[0]);
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Inventory seed failed; no changes were committed:', error.message);
  process.exitCode = 1;
});
