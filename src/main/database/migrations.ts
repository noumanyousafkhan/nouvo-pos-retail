import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_counter_schema',
    sql: `
      CREATE TABLE stores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        currency_code TEXT NOT NULL DEFAULT 'PKR' CHECK (length(currency_code) = 3),
        timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;

      CREATE TABLE counters (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        username TEXT NOT NULL COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, username)
      ) STRICT;

      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, name)
      ) STRICT;

      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        category_id TEXT REFERENCES categories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        sku TEXT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description TEXT,
        base_unit TEXT NOT NULL DEFAULT 'piece' CHECK (length(trim(base_unit)) > 0),
        purchase_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (purchase_cost_minor >= 0),
        selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
        tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        archived_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX products_store_sku_unique ON products(store_id, sku) WHERE sku IS NOT NULL AND trim(sku) <> '';
      CREATE INDEX products_store_name_idx ON products(store_id, name COLLATE NOCASE);
      CREATE INDEX products_category_idx ON products(category_id);

      CREATE TABLE product_barcodes (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        barcode TEXT NOT NULL CHECK (length(trim(barcode)) > 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (barcode)
      ) STRICT;
      CREATE INDEX product_barcodes_product_idx ON product_barcodes(product_id);

      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','receipt','sale','return','adjustment','write_off','allocation','release')),
        quantity_delta_milli INTEGER NOT NULL CHECK (quantity_delta_milli <> 0),
        unit_cost_minor INTEGER CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
        reference_type TEXT,
        reference_id TEXT,
        reason TEXT,
        actor_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX stock_movements_product_time_idx ON stock_movements(product_id, created_at DESC);
      CREATE INDEX stock_movements_reference_idx ON stock_movements(reference_type, reference_id);

      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        cashier_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        receipt_number TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft','completed','voided','partially_returned','returned')),
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
        discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
        tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
        total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (counter_id, receipt_number)
      ) STRICT;
      CREATE INDEX sales_store_completed_idx ON sales(store_id, completed_at DESC);

      CREATE TABLE sale_lines (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        product_code_snapshot TEXT,
        unit_snapshot TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
        tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX sale_lines_sale_idx ON sale_lines(sale_id);

      CREATE TABLE sale_payments (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        payment_method TEXT NOT NULL CHECK (length(trim(payment_method)) > 0),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        reference TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX sale_payments_sale_idx ON sale_payments(sale_id);

      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_flight','acknowledged','failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        acknowledged_at TEXT
      ) STRICT;
      CREATE INDEX outbox_pending_idx ON outbox_events(status, next_attempt_at, created_at);

      CREATE TABLE business_branding_profiles (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
        updated_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, revision)
      ) STRICT;

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        actor_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
        after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX audit_entity_time_idx ON audit_events(entity_type, entity_id, created_at DESC);
    `,
  },
  {
    version: 2,
    name: 'sale_receipt_and_idempotency',
    sql: `
      ALTER TABLE sales ADD COLUMN idempotency_key TEXT;
      ALTER TABLE sales ADD COLUMN request_hash TEXT;
      ALTER TABLE sales ADD COLUMN change_due_minor INTEGER NOT NULL DEFAULT 0 CHECK (change_due_minor >= 0);
      CREATE UNIQUE INDEX sales_idempotency_key_unique ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;

      ALTER TABLE sale_payments ADD COLUMN amount_tendered_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_tendered_minor >= 0);
      ALTER TABLE sale_payments ADD COLUMN change_due_minor INTEGER NOT NULL DEFAULT 0 CHECK (change_due_minor >= 0);

      CREATE TABLE receipt_snapshots (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        business_profile_json TEXT NOT NULL CHECK (json_valid(business_profile_json)),
        receipt_config_json TEXT NOT NULL CHECK (json_valid(receipt_config_json)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'business_and_receipt_settings',
    sql: `
      ALTER TABLE stores ADD COLUMN tax_behavior TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_behavior IN ('exclusive','inclusive'));
      ALTER TABLE stores ADD COLUMN address TEXT;
      ALTER TABLE stores ADD COLUMN phone TEXT;
      ALTER TABLE stores ADD COLUMN business_registration_number TEXT;
      ALTER TABLE stores ADD COLUMN receipt_footer TEXT NOT NULL DEFAULT '';
      ALTER TABLE stores ADD COLUMN receipt_paper_width_mm INTEGER NOT NULL DEFAULT 80 CHECK (receipt_paper_width_mm IN (58,80));
    `,
  },
];

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex');
}

export function applyMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT;
  `);

  const applied = database
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as {
    version: number;
    checksum: string;
  }[];
  const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));

  for (const migration of migrations) {
    const checksum = migrationChecksum(migration);
    const existingChecksum = appliedByVersion.get(migration.version);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== checksum) {
        throw new Error(
          `Migration ${migration.version} checksum mismatch; refusing to start with changed historical migration.`,
        );
      }
      continue;
    }

    const latestApplied = Math.max(0, ...appliedByVersion.keys());
    if (migration.version <= latestApplied) {
      throw new Error(`Migration ${migration.version} is missing from applied migration history.`);
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, checksum);
      database.exec('COMMIT');
      appliedByVersion.set(migration.version, checksum);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
