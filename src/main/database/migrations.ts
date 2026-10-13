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
  {
    version: 4,
    name: 'authentication_and_role_permissions',
    sql: `
      ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('owner','manager','cashier','inventory_manager'));
      UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);

      CREATE TABLE role_permissions (
        role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','inventory_manager')),
        permission TEXT NOT NULL,
        PRIMARY KEY (role, permission)
      ) STRICT;
      INSERT INTO role_permissions (role, permission) VALUES
        ('owner','dashboard.view'),('owner','checkout.use'),('owner','inventory.view'),('owner','inventory.manage'),('owner','stock.manage'),('owner','sales.view'),('owner','reports.view'),('owner','settings.view'),('owner','settings.manage'),('owner','backup.manage'),('owner','users.manage'),('owner','purchasing.view'),
        ('manager','dashboard.view'),('manager','checkout.use'),('manager','inventory.view'),('manager','inventory.manage'),('manager','stock.manage'),('manager','sales.view'),('manager','reports.view'),('manager','settings.view'),('manager','settings.manage'),('manager','backup.manage'),('manager','purchasing.view'),
        ('cashier','dashboard.view'),('cashier','checkout.use'),('cashier','inventory.view'),('cashier','sales.view'),('cashier','settings.view'),
        ('inventory_manager','dashboard.view'),('inventory_manager','inventory.view'),('inventory_manager','inventory.manage'),('inventory_manager','stock.manage'),('inventory_manager','purchasing.view'),('inventory_manager','reports.view'),('inventory_manager','settings.view');

      CREATE TABLE user_sessions (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX user_sessions_user_idx ON user_sessions(user_id, expires_at DESC);

      CREATE TABLE auth_login_attempts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE,
        attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        succeeded INTEGER NOT NULL CHECK (succeeded IN (0,1))
      ) STRICT;
      CREATE INDEX auth_attempts_username_time_idx ON auth_login_attempts(username, attempted_at DESC);
    `,
  },
  {
    version: 5,
    name: 'supplier_purchasing_and_receiving',
    sql: `
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','purchasing.manage'),('manager','purchasing.manage'),('inventory_manager','purchasing.manage');

      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        phone TEXT,
        email TEXT,
        address TEXT,
        tax_number TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, name)
      ) STRICT;
      CREATE INDEX suppliers_store_active_idx ON suppliers(store_id, is_active, name COLLATE NOCASE);

      CREATE TABLE purchase_orders (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        order_number TEXT NOT NULL,
        supplier_invoice_number TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received','cancelled')),
        notes TEXT,
        subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
        created_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        received_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        ordered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        received_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, order_number),
        UNIQUE (store_id, supplier_invoice_number)
      ) STRICT;
      CREATE INDEX purchase_orders_store_time_idx ON purchase_orders(store_id, ordered_at DESC);
      CREATE INDEX purchase_orders_status_idx ON purchase_orders(store_id, status, ordered_at DESC);

      CREATE TABLE purchase_order_lines (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT,
        unit_snapshot TEXT NOT NULL,
        quantity_ordered_milli INTEGER NOT NULL CHECK (quantity_ordered_milli > 0),
        quantity_received_milli INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received_milli >= 0 AND quantity_received_milli <= quantity_ordered_milli),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX purchase_order_lines_order_idx ON purchase_order_lines(purchase_order_id);
      CREATE INDEX purchase_order_lines_product_idx ON purchase_order_lines(product_id);
    `,
  },
  {
    version: 6,
    name: 'sale_returns_and_voids',
    sql: `
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','sales.return'),('owner','sales.void'),
        ('manager','sales.return'),('manager','sales.void');

      CREATE TABLE sale_returns (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        return_number TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('return','void')),
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
        reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
        processed_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (counter_id, return_number)
      ) STRICT;
      CREATE INDEX sale_returns_sale_time_idx ON sale_returns(sale_id, created_at DESC);
      CREATE INDEX sale_returns_store_time_idx ON sale_returns(store_id, created_at DESC);

      CREATE TABLE sale_return_lines (
        id TEXT PRIMARY KEY,
        sale_return_id TEXT NOT NULL REFERENCES sale_returns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        original_sale_line_id TEXT NOT NULL REFERENCES sale_lines(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_name_snapshot TEXT NOT NULL,
        unit_snapshot TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        refund_subtotal_minor INTEGER NOT NULL CHECK (refund_subtotal_minor >= 0),
        refund_discount_minor INTEGER NOT NULL CHECK (refund_discount_minor >= 0),
        refund_tax_minor INTEGER NOT NULL CHECK (refund_tax_minor >= 0),
        refund_total_minor INTEGER NOT NULL CHECK (refund_total_minor >= 0),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX sale_return_lines_return_idx ON sale_return_lines(sale_return_id);
      CREATE INDEX sale_return_lines_original_idx ON sale_return_lines(original_sale_line_id);

      CREATE TABLE sale_return_payments (
        id TEXT PRIMARY KEY,
        sale_return_id TEXT NOT NULL REFERENCES sale_returns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        payment_method TEXT NOT NULL CHECK (length(trim(payment_method)) > 0),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        reference TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX sale_return_payments_return_idx ON sale_return_payments(sale_return_id);

      CREATE TABLE return_receipt_snapshots (
        id TEXT PRIMARY KEY,
        sale_return_id TEXT NOT NULL UNIQUE REFERENCES sale_returns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        business_profile_json TEXT NOT NULL CHECK (json_valid(business_profile_json)),
        receipt_config_json TEXT NOT NULL CHECK (json_valid(receipt_config_json)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
    `,
  },
  {
    version: 7,
    name: 'cashier_shifts_and_reconciliation',
    sql: `
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','cash_session.view'),('owner','cash_session.open'),('owner','cash_session.close'),('owner','cash_session.movement'),('owner','cash_session.reconcile'),
        ('manager','cash_session.view'),('manager','cash_session.open'),('manager','cash_session.close'),('manager','cash_session.movement'),('manager','cash_session.reconcile'),
        ('cashier','cash_session.view'),('cashier','cash_session.open'),('cashier','cash_session.close'),('cashier','cash_session.movement'),('cashier','sales.return');

      CREATE TABLE cashier_sessions (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        opened_by_user_id TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        closed_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        opening_float_minor INTEGER NOT NULL CHECK (opening_float_minor >= 0),
        expected_cash_minor INTEGER CHECK (expected_cash_minor >= 0),
        counted_cash_minor INTEGER CHECK (counted_cash_minor >= 0),
        variance_minor INTEGER,
        opening_note TEXT,
        closing_note TEXT,
        opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK ((status = 'open' AND closed_at IS NULL AND counted_cash_minor IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL AND counted_cash_minor IS NOT NULL AND expected_cash_minor IS NOT NULL AND variance_minor IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX one_open_session_per_counter_idx ON cashier_sessions(counter_id) WHERE status = 'open';
      CREATE INDEX cashier_sessions_store_time_idx ON cashier_sessions(store_id, opened_at DESC);
      CREATE INDEX cashier_sessions_user_time_idx ON cashier_sessions(opened_by_user_id, opened_at DESC);

      CREATE TABLE cash_movements (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        session_id TEXT NOT NULL REFERENCES cashier_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('cash_in','cash_out')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
        actor_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
      CREATE INDEX cash_movements_session_time_idx ON cash_movements(session_id, created_at);

      ALTER TABLE sales ADD COLUMN cashier_session_id TEXT REFERENCES cashier_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
      CREATE INDEX sales_cashier_session_idx ON sales(cashier_session_id, completed_at);
      ALTER TABLE sale_returns ADD COLUMN cashier_session_id TEXT REFERENCES cashier_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
      CREATE INDEX sale_returns_cashier_session_idx ON sale_returns(cashier_session_id, created_at);
    `,
  },
  {
    version: 8,
    name: 'double_entry_accounting_ledger',
    sql: `
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','accounting.view'),('owner','accounting.manage'),('manager','accounting.view');

      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        code TEXT NOT NULL CHECK (length(trim(code)) BETWEEN 3 AND 12),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
        normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit','credit')),
        is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, code),
        UNIQUE (store_id, name)
      ) STRICT;
      CREATE INDEX accounts_store_type_idx ON accounts(store_id, account_type, code);

      CREATE TABLE journal_entries (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        entry_number TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('sale','sale_return','purchase_receipt','manual','reversal')),
        source_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        description TEXT NOT NULL,
        posted_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        posted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, entry_number),
        UNIQUE (store_id, source_type, source_id)
      ) STRICT;
      CREATE INDEX journal_entries_store_time_idx ON journal_entries(store_id, posted_at DESC);
      CREATE INDEX journal_entries_source_idx ON journal_entries(source_type, source_id);

      CREATE TABLE journal_lines (
        id TEXT PRIMARY KEY,
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        line_number INTEGER NOT NULL CHECK (line_number > 0),
        debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
        credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
        memo TEXT NOT NULL DEFAULT '',
        CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
        UNIQUE (journal_entry_id, line_number)
      ) STRICT;
      CREATE INDEX journal_lines_account_idx ON journal_lines(account_id, journal_entry_id);
    `,
  },
  {
    version: 9,
    name: 'sync_status_and_outbox_diagnostics',
    sql: `
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','sync.view'),('owner','sync.retry'),('manager','sync.view'),('manager','sync.retry');

      CREATE TABLE sync_state (
        counter_id TEXT PRIMARY KEY REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','idle','syncing','connected','offline','error')),
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;
    `,
  },
  {
    version: 10,
    name: 'counter_stock_allocation_enforcement',
    sql: `
      ALTER TABLE sync_state ADD COLUMN allocation_enforced INTEGER NOT NULL DEFAULT 0 CHECK (allocation_enforced IN (0,1));
      CREATE TABLE counter_stock_allocations (
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        remaining_quantity_milli INTEGER NOT NULL CHECK (remaining_quantity_milli >= 0),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (counter_id, product_id)
      ) STRICT;
      CREATE INDEX counter_stock_allocations_product_idx ON counter_stock_allocations(product_id, counter_id);

      INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json, created_at)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
        'store.settings.updated', 'store', s.id,
        json_object('schemaVersion', 1, 'settings', json_object(
          'storeId', s.id, 'name', s.name, 'currencyCode', s.currency_code, 'timezone', s.timezone,
          'taxBehavior', s.tax_behavior, 'address', COALESCE(s.address, ''), 'phone', COALESCE(s.phone, ''),
          'businessRegistrationNumber', COALESCE(s.business_registration_number, ''),
          'receiptFooter', s.receipt_footer, 'receiptPaperWidthMm', s.receipt_paper_width_mm
        )), s.created_at
      FROM stores s
      WHERE NOT EXISTS (
        SELECT 1 FROM outbox_events o WHERE o.event_type = 'store.settings.updated' AND o.aggregate_type = 'store' AND o.aggregate_id = s.id
      );

      INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json, created_at)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
        'product.created', 'product', p.id,
        json_object('schemaVersion', 1, 'product', json_object(
          'id', p.id, 'name', p.name, 'description', COALESCE(p.description, ''),
          'categoryName', COALESCE(c.name, ''), 'sku', p.sku,
          'barcodes', json(COALESCE((SELECT json_group_array(pb.barcode) FROM product_barcodes pb WHERE pb.product_id = p.id), '[]')),
          'baseUnit', p.base_unit, 'purchaseCostMinor', p.purchase_cost_minor,
          'sellingPriceMinor', p.selling_price_minor, 'taxRateBasisPoints', p.tax_rate_basis_points,
          'isActive', json(CASE WHEN p.is_active = 1 THEN 'true' ELSE 'false' END),
          'stockOnHandMilli', 0,
          'createdAt', p.created_at, 'updatedAt', p.updated_at
        )), p.created_at
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE NOT EXISTS (
        SELECT 1 FROM outbox_events o WHERE o.event_type = 'product.created' AND o.aggregate_type = 'product' AND o.aggregate_id = p.id
      );

      INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json, created_at)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
        'stock.movement.recorded', 'stock_movement', sm.id,
        json_object('schemaVersion', 1, 'movementId', sm.id, 'storeId', sm.store_id, 'counterId', sm.counter_id, 'productId', sm.product_id, 'movementType', sm.movement_type, 'quantityDeltaMilli', sm.quantity_delta_milli, 'unitCostMinor', sm.unit_cost_minor, 'reason', sm.reason),
        sm.created_at
      FROM stock_movements sm
      WHERE sm.counter_id IS NOT NULL AND sm.movement_type NOT IN ('sale','return')
        AND COALESCE(sm.reference_type, '') <> 'sync_allocation'
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events o WHERE o.event_type = 'stock.movement.recorded' AND o.aggregate_type = 'stock_movement' AND o.aggregate_id = sm.id
        );
    `,
  },
  {
    version: 11,
    name: 'supplier_returns_and_accounting_sources',
    sql: `
      CREATE TABLE journal_entries_new (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        entry_number TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('sale','sale_return','purchase_receipt','purchase_return','supplier_payment','manual','reversal')),
        source_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        description TEXT NOT NULL,
        posted_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        posted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, entry_number),
        UNIQUE (store_id, source_type, source_id)
      ) STRICT;
      INSERT INTO journal_entries_new SELECT id,store_id,entry_number,source_type,source_id,status,currency_code,description,posted_by_user_id,posted_at FROM journal_entries;
      CREATE TABLE journal_lines_new (
        id TEXT PRIMARY KEY,
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries_new(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        line_number INTEGER NOT NULL CHECK (line_number > 0),
        debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
        credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
        memo TEXT NOT NULL DEFAULT '',
        CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
        UNIQUE (journal_entry_id, line_number)
      ) STRICT;
      INSERT INTO journal_lines_new SELECT id,journal_entry_id,account_id,line_number,debit_minor,credit_minor,memo FROM journal_lines;
      DROP TABLE journal_lines;
      DROP TABLE journal_entries;
      ALTER TABLE journal_entries_new RENAME TO journal_entries;
      ALTER TABLE journal_lines_new RENAME TO journal_lines;
      CREATE INDEX journal_entries_store_time_idx ON journal_entries(store_id, posted_at DESC);
      CREATE INDEX journal_entries_source_idx ON journal_entries(source_type, source_id);
      CREATE INDEX journal_lines_account_idx ON journal_lines(account_id, journal_entry_id);

      CREATE TABLE purchase_returns (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        return_number TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
        total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
        created_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, return_number)
      ) STRICT;
      CREATE INDEX purchase_returns_order_idx ON purchase_returns(purchase_order_id, created_at DESC);
      CREATE TABLE purchase_return_lines (
        id TEXT PRIMARY KEY,
        purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
        UNIQUE (purchase_return_id, purchase_order_line_id)
      ) STRICT;
      CREATE INDEX purchase_return_lines_order_line_idx ON purchase_return_lines(purchase_order_line_id);
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','purchasing.return'),('manager','purchasing.return'),('inventory_manager','purchasing.return');
    `,
  },
  {
    version: 12,
    name: 'supplier_payment_settlement_and_aging',
    sql: `
      CREATE TABLE supplier_payments (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        payment_number TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank','mobile','card','other')),
        reference TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, payment_number)
      ) STRICT;
      CREATE INDEX supplier_payments_order_idx ON supplier_payments(purchase_order_id, created_at DESC);
      CREATE INDEX supplier_payments_supplier_idx ON supplier_payments(supplier_id, created_at DESC);
      INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
        ('owner','purchasing.pay'),('manager','purchasing.pay');
    `,
  },
  {
    version: 13,
    name: 'partial_purchase_receiving_and_discrepancies',
    sql: `
      ALTER TABLE purchase_orders ADD COLUMN received_subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (received_subtotal_minor >= 0);
      ALTER TABLE purchase_orders ADD COLUMN receipt_discrepancy_note TEXT NOT NULL DEFAULT '';
      ALTER TABLE purchase_orders ADD COLUMN receipt_discrepancy_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(receipt_discrepancy_json));
      UPDATE purchase_orders SET received_subtotal_minor = subtotal_minor WHERE status = 'received';

      CREATE TABLE purchase_receipts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        counter_id TEXT NOT NULL REFERENCES counters(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        receipt_number TEXT NOT NULL,
        supplier_invoice_number TEXT NOT NULL DEFAULT '',
        discrepancy_note TEXT NOT NULL DEFAULT '',
        total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
        received_by_user_id TEXT REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (store_id, receipt_number)
      ) STRICT;
      CREATE INDEX purchase_receipts_order_idx ON purchase_receipts(purchase_order_id, received_at DESC);

      CREATE TABLE purchase_receipt_lines (
        id TEXT PRIMARY KEY,
        purchase_receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        purchase_order_line_id TEXT NOT NULL REFERENCES purchase_order_lines(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        quantity_ordered_milli INTEGER NOT NULL CHECK (quantity_ordered_milli > 0),
        quantity_previously_received_milli INTEGER NOT NULL CHECK (quantity_previously_received_milli >= 0),
        quantity_received_milli INTEGER NOT NULL CHECK (quantity_received_milli >= 0),
        quantity_short_milli INTEGER NOT NULL CHECK (quantity_short_milli >= 0),
        unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
        line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
      ) STRICT;
      CREATE INDEX purchase_receipt_lines_batch_idx ON purchase_receipt_lines(purchase_receipt_id);
    `,
  },
  {
    version: 14,
    name: 'supplier_invoice_reconciliation',
    sql: `
      ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_total_minor INTEGER CHECK (supplier_invoice_total_minor IS NULL OR supplier_invoice_total_minor >= 0);
      ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_variance_minor INTEGER CHECK (supplier_invoice_variance_minor IS NULL OR supplier_invoice_variance_minor >= 0);
      ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_variance_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE purchase_orders ADD COLUMN supplier_invoice_reconciliation_status TEXT NOT NULL DEFAULT 'not_entered' CHECK (supplier_invoice_reconciliation_status IN ('not_entered','matched','variance_explained'));
    `,
  },
];

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 0;

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
