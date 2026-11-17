const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const envFile = process.env.ENV_FILE;
const envResult = dotenv.config(envFile ? { path: envFile } : undefined);
if (envFile && envResult.error) throw envResult.error;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  socketPath: process.env.DB_SOCKET_PATH || undefined,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_db',
  waitForConnections: true,
  connectionLimit: 2,
  decimalNumbers: true
});

const legacyDemoProductSql = "(sku LIKE 'BULK-DEMO-%' OR sku LIKE 'DEMO-SALES-%')";
const demoSaleSql = "(customer_name LIKE 'DEMO-SALES - %' OR customer_name LIKE 'BULK DEMO - Customer %' OR customer_name LIKE 'DEMO ONLY - %')";
const demoSupplierSql = "(email LIKE 'bulk-demo-supplier-%@seed.invalid' OR email IN ('orders@northstar.example', 'orders@brightline.example', 'orders@papertrail.example', 'orders@oakandiron.example', 'orders@clearbox.example', 'orders@citywide.example'))";
const demoCategorySql = "(name LIKE 'BULK DEMO - %' OR description LIKE 'Seeded illustrative demo data only;%')";
const demoProductSql = `(${legacyDemoProductSql} OR category_id IN (SELECT id FROM categories WHERE ${demoCategorySql}))`;

async function assertNoUnmarkedReferences(connection) {
  const checks = [
    [
      'A marked product is referenced by a sale without a demo customer marker.',
      `SELECT s.id
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       WHERE ${legacyDemoProductSql.replaceAll('sku', 'p.sku')}
         AND NOT ${demoSaleSql.replaceAll('customer_name', 's.customer_name')}
       LIMIT 1`
    ],
    [
      'A seeded illustrative product is referenced by a sale without the seed customer marker.',
      `SELECT s.id
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       WHERE p.category_id IN (
         SELECT id FROM categories WHERE description LIKE 'Seeded illustrative demo data only;%'
       )
         AND s.customer_name NOT LIKE 'DEMO-SALES - %'
       LIMIT 1`
    ],
    [
      'A seeded illustrative sale also contains a product outside the seeded dataset.',
      `SELECT s.id
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       WHERE p.category_id IN (
         SELECT id FROM categories WHERE description LIKE 'Seeded illustrative demo data only;%'
       )
         AND EXISTS (
           SELECT 1
           FROM sale_items other_si
           JOIN products other_p ON other_p.id = other_si.product_id
           WHERE other_si.sale_id = s.id
             AND NOT (${demoProductSql.replaceAll('sku', 'other_p.sku').replaceAll('category_id', 'other_p.category_id')})
         )
       LIMIT 1`
    ],
    [
      'A marked demo sale contains a product without a demo marker.',
      `SELECT s.id
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       WHERE ${demoSaleSql.replaceAll('customer_name', 's.customer_name')}
         AND NOT (${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')})
       LIMIT 1`
    ],
    [
      'A marked product is referenced by a purchase from a non-demo supplier.',
      `SELECT pu.id
       FROM purchases pu
       JOIN purchase_items pi ON pi.purchase_id = pu.id
       JOIN products p ON p.id = pi.product_id
       JOIN suppliers s ON s.id = pu.supplier_id
       WHERE ${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')}
         AND NOT (${demoSupplierSql.replaceAll('email', 's.email')})
       LIMIT 1`
    ],
    [
      'A demo supplier purchase contains a product without a demo SKU marker.',
      `SELECT pu.id
       FROM purchases pu
       JOIN purchase_items pi ON pi.purchase_id = pu.id
       JOIN products p ON p.id = pi.product_id
       JOIN suppliers s ON s.id = pu.supplier_id
       WHERE (${demoSupplierSql.replaceAll('email', 's.email')})
         AND NOT (${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')})
       LIMIT 1`
    ],
    [
      'A demo supplier purchase has no marked demo product.',
      `SELECT pu.id
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       WHERE (${demoSupplierSql.replaceAll('email', 's.email')})
         AND NOT EXISTS (
           SELECT 1
           FROM purchase_items pi
           JOIN products p ON p.id = pi.product_id
           WHERE pi.purchase_id = pu.id
             AND ${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')}
         )
       LIMIT 1`
    ],
    [
      'A demo category contains a product without a demo SKU marker.',
      `SELECT p.id
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE (${demoCategorySql.replaceAll('name', 'c.name').replaceAll('description', 'c.description')})
         AND NOT (${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')})
       LIMIT 1`
    ],
    [
      'A demo supplier is assigned to a product without a demo SKU marker.',
      `SELECT p.id
       FROM products p
       JOIN suppliers s ON s.id = p.supplier_id
       WHERE (${demoSupplierSql.replaceAll('email', 's.email')})
         AND NOT (${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')})
       LIMIT 1`
    ]
  ];

  for (const [message, sql] of checks) {
    const [rows] = await connection.query(sql);
    if (rows.length) throw new Error(message);
  }
}

async function main() {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    await assertNoUnmarkedReferences(connection);

    const [demoSales] = await connection.query(
      `SELECT DISTINCT s.id
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE ${demoSaleSql.replaceAll('customer_name', 's.customer_name')}
          OR ${demoProductSql.replaceAll('sku', 'p.sku').replaceAll('category_id', 'p.category_id')}`
    );
    const saleIds = demoSales.map(sale => sale.id);
    const [saleItems] = saleIds.length
      ? await connection.query('DELETE FROM sale_items WHERE sale_id IN (?)', [saleIds])
      : [{ affectedRows: 0 }];
    const [sales] = saleIds.length
      ? await connection.query('DELETE FROM sales WHERE id IN (?)', [saleIds])
      : [{ affectedRows: 0 }];

    const [purchaseItems] = await connection.query(
      `DELETE FROM purchase_items
       WHERE purchase_id IN (
         SELECT pu.id
         FROM purchases pu
         JOIN suppliers s ON s.id = pu.supplier_id
         WHERE ${demoSupplierSql.replaceAll('email', 's.email')}
       )
          OR product_id IN (SELECT id FROM products WHERE ${demoProductSql})`
    );
    const [purchases] = await connection.query(
      `DELETE FROM purchases
       WHERE supplier_id IN (SELECT id FROM suppliers WHERE ${demoSupplierSql})`
    );
    const [products] = await connection.query(`DELETE FROM products WHERE ${demoProductSql}`);
    const [users] = await connection.query(`DELETE FROM users WHERE ${demoSupplierSql}`);
    const [suppliers] = await connection.query(`DELETE FROM suppliers WHERE ${demoSupplierSql}`);
    const [categories] = await connection.query(`DELETE FROM categories WHERE ${demoCategorySql}`);

    await connection.commit();
    transactionStarted = false;

    console.log('Marked demo cleanup complete:');
    console.log(`  sale items: ${saleItems.affectedRows}`);
    console.log(`  sales: ${sales.affectedRows}`);
    console.log(`  purchase items: ${purchaseItems.affectedRows}`);
    console.log(`  purchases: ${purchases.affectedRows}`);
    console.log(`  products: ${products.affectedRows}`);
    console.log(`  supplier login placeholders: ${users.affectedRows}`);
    console.log(`  suppliers: ${suppliers.affectedRows}`);
    console.log(`  categories: ${categories.affectedRows}`);
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Demo cleanup failed; no changes were committed:', error.message);
  process.exitCode = 1;
});
