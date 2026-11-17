#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/inventory-management-system/mysql"
SOCKET_PATH="$DATA_DIR/mysql.sock"
APP_ENV="$ROOT_DIR/.env.local"

for command_name in mysqld mysql mysqladmin openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$DATA_DIR")"

if [[ ! -d "$DATA_DIR/mysql" ]]; then
  if [[ -d "$DATA_DIR" ]]; then
    if [[ -n "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      printf 'The uninitialized data directory is not empty: %s\n' "$DATA_DIR" >&2
      exit 1
    fi
    rmdir "$DATA_DIR"
  fi
  mysqld --no-defaults --initialize-insecure --user="$(id -un)" --datadir="$DATA_DIR"
fi

if ! mysqladmin --no-defaults --protocol=SOCKET --socket="$SOCKET_PATH" -uroot ping >/dev/null 2>&1; then
  mysqld --no-defaults \
    --user="$(id -un)" \
    --datadir="$DATA_DIR" \
    --socket="$SOCKET_PATH" \
    --pid-file="$DATA_DIR/mysql.pid" \
    --log-error="$DATA_DIR/mysql.log" \
    --port=0 \
    --skip-networking \
    --daemonize

  for attempt in {1..30}; do
    if mysqladmin --no-defaults --protocol=SOCKET --socket="$SOCKET_PATH" -uroot ping >/dev/null 2>&1; then
      break
    fi
    if [[ "$attempt" == 30 ]]; then
      printf 'The private MySQL instance did not start. See %s/mysql.log\n' "$DATA_DIR" >&2
      exit 1
    fi
    sleep 1
  done
fi

if [[ ! -f "$APP_ENV" ]]; then
  DB_PASSWORD="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  umask 077
  cat > "$APP_ENV" <<EOF
DB_HOST=localhost
DB_SOCKET_PATH=$SOCKET_PATH
DB_USER=inventory_app
DB_PASSWORD=$DB_PASSWORD
DB_NAME=inventory_supplier_db
SESSION_SECRET=$SESSION_SECRET
EOF
fi

DB_PASSWORD="$(sed -n 's/^DB_PASSWORD=//p' "$APP_ENV")"
if [[ ! "$DB_PASSWORD" =~ ^[a-f0-9]{64}$ ]]; then
  printf 'Invalid DB_PASSWORD in %s; remove that file and rerun to generate a new local config.\n' "$APP_ENV" >&2
  exit 1
fi

mysql --no-defaults --protocol=SOCKET --socket="$SOCKET_PATH" -uroot <<SQL
CREATE DATABASE IF NOT EXISTS inventory_supplier_db;
CREATE USER IF NOT EXISTS 'inventory_app'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER 'inventory_app'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON inventory_supplier_db.* TO 'inventory_app'@'localhost';
SQL

mysql --no-defaults --protocol=SOCKET --socket="$SOCKET_PATH" -uroot < "$ROOT_DIR/schema.sql"

printf 'Using isolated database at %s\n' "$DATA_DIR"
ENV_FILE="$APP_ENV" exec node "$ROOT_DIR/server.js"
