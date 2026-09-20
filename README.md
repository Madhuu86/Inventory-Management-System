# Inventory Desk

A DBMS inventory management system built with Node.js, Express, MySQL, EJS, HTML, and CSS.

## Features

- Session-based administrator login
- Product, category, and supplier management
- Purchase recording with automatic stock increase
- Sales recording with insufficient-stock protection
- Dashboard with inventory statistics and low-stock alerts
- Reports for top products, category stock, and monthly revenue
- Relational MySQL schema with primary keys, foreign keys, and transactions

## Requirements

- Node.js 18 or newer
- MySQL 8 or newer

## Setup

1. Start the MySQL service.
2. Import the schema:

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

The administrator account is created automatically when the application starts.
