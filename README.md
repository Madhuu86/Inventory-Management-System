# Inventory Desk

A DBMS inventory management system built with Node.js, Express, MySQL, EJS, HTML, and CSS.

## Features

- Session-based administrator and supplier logins
- Product, category, and supplier management
- Supplier-owned catalog costs and availability, with admin-controlled retail pricing
- Purchase requests with supplier availability replies and admin stock receipt
- Sales recording with insufficient-stock protection
- Dashboard with a live date, inventory statistics, low-stock alerts, and best sellers
- Sales summaries and charts for daily, weekly, monthly, and yearly periods
- Reports for top products, monthly revenue trends, and category stock
- Relational MySQL schema with primary keys, foreign keys, and transactions

## Requirements

- Node.js 18 or newer
- MySQL 8 or newer

## Setup

### Ubuntu local setup (separate database)

Run the app with a user-owned MySQL instance and a fresh `inventory_supplier_db` database:

```bash
npm run start:local
```

This initializes the database under `~/.local/share/inventory-management-system/mysql`, binds it to a local Unix socket (not a network port), imports `schema.sql`, and starts the app. It does not touch the system MySQL instance or the old `inventory_db`. A local `.env.local` is generated for the app and ignored by Git. Stop the app with Ctrl+C; the local database files remain for the next run.

The fresh database contains the schema's three categories and the admin account created by the app. Supplier, product, purchase, and sales records remain empty until you add them or run the optional example seed. Admin login is `admin@inventory.local` / `admin123`.

### Existing MySQL server

1. Start the MySQL service.
2. Import the schema into the separate `inventory_supplier_db` database:

```bash
mysql -u root -p < schema.sql
```

3. Create the environment file:

```bash
cp .env.example .env
```

Update `DB_PASSWORD` and any other values in `.env` if needed.

4. Install dependencies and run:

```bash
npm install
npm start
```

5. Open http://localhost:3000

## Demo login

- Email: `admin@inventory.local`
- Password: `admin123`

The administrator account is created automatically when the application starts. Supplier accounts are created from the admin Suppliers page. Existing supplier directory records can be given a login from that page.

## Removing previously generated demo rows

If you ran the old synthetic seed scripts, remove only their marked rows with:

```bash
npm run cleanup:demo
```

This uses `.env`, the same default environment file as `npm start`. If the app was started with a different existing environment file, pass that exact path with `ENV_FILE=/path/to/file npm run cleanup:demo`. The cleanup runs in a transaction, recognizes legacy demo rows and the current illustrative seed, and aborts if seeded transactions also reference unmarked products. It does not drop the database, schema, admin account, or unmarked records. To replace the current illustrative dataset, use the seed command below.

The retired bulk seed scripts are not used by the current example seed. Public historical sales data cannot restore this business's real inventory or current sales.

## Replacing business records with a populated example

After starting the app once so it can initialize the administrator account, stop it and run:

```bash
npm run seed:inventory-demo -- --replace
```

The script requires `DB_NAME=inventory_supplier_db` and an explicit `--replace` flag. It replaces business records while preserving the database schema and administrator login. For the private local database created by `npm run start:local`, use `ENV_FILE=.env.local npm run seed:inventory-demo -- --replace`.

This permanently removes current sales, purchases, products, suppliers, supplier accounts, and categories in that database. Export a backup first if any of those records need to be kept.

The resulting illustrative scenario contains 5 categories, 6 suppliers and supplier logins, 45 products, 300 purchases, and 300 sales with linked line items. Purchase and sale dates are distributed across roughly four years, with one sale on each of the latest seven days. Sale baskets vary in size and value, including occasional orders above ₹1 lakh; purchase quantities, received stock, sale lines, and ending inventory are kept consistent. Prices and reports use Indian rupees (INR), formatted with Indian digit grouping. These records are generated examples, not verified real-world transactions, supplier details, or actual stock. A notice in the UI identifies the illustrative dataset. Supplier logins use reserved `.example` email addresses and the shared password `SupplierDemo123!`; change or remove these accounts before exposing the app outside a local demo.

## Supplier workflow

1. Sign in as the administrator and create a supplier account from Suppliers. The supplier receives a login email and temporary password.
2. The supplier signs in at the same login page, adds products to their catalog, and maintains their unit cost and available quantity.
3. The administrator sets each product's retail price and sends a purchase request.
4. The supplier confirms availability or reports insufficient stock. Confirmed quantities are reserved from supplier availability.
5. The administrator records receipt when stock arrives; only then is store inventory increased.

The application uses `inventory_supplier_db` so the original `inventory_db` remains unchanged.
