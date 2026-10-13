// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, runInTransaction } from '../../../src/main/database/connection';
import {
  applyMigrations,
  migrationChecksum,
  migrations,
} from '../../../src/main/database/migrations';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nouvo-pos-db-'));
  temporaryDirectories.push(directory);
  return join(directory, 'nested', 'counter.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local SQLite database foundation', () => {
  it('supports an isolated in-memory database without creating a disk file', () => {
    const database = openLocalDatabase(':memory:');
    try {
      expect(database.path).toBe(':memory:');
      expect(database.connection.prepare('PRAGMA quick_check').get()).toEqual({
        quick_check: 'ok',
      });
    } finally {
      database.close();
    }
  });

  it('creates the schema and records migrations exactly once', () => {
    const database = openLocalDatabase(createDatabasePath());
    try {
      const versions = database.connection
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all();
      expect(versions).toEqual([
        { version: 1, name: 'initial_counter_schema' },
        { version: 2, name: 'sale_receipt_and_idempotency' },
        { version: 3, name: 'business_and_receipt_settings' },
        { version: 4, name: 'authentication_and_role_permissions' },
        { version: 5, name: 'supplier_purchasing_and_receiving' },
        { version: 6, name: 'sale_returns_and_voids' },
        { version: 7, name: 'cashier_shifts_and_reconciliation' },
        { version: 8, name: 'double_entry_accounting_ledger' },
        { version: 9, name: 'sync_status_and_outbox_diagnostics' },
        { version: 10, name: 'counter_stock_allocation_enforcement' },
        { version: 11, name: 'supplier_returns_and_accounting_sources' },
      ]);
      expect(
        database.connection
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox_events'")
          .get(),
      ).toEqual({ name: 'outbox_events' });
      applyMigrations(database.connection);
      expect(
        database.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
      ).toEqual({ count: 11 });
    } finally {
      database.close();
    }
  });

  it('preserves existing posted journals when migration 11 extends accounting source types', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ) STRICT;
      `);
      for (const migration of migrations.slice(0, 10)) {
        database.exec('BEGIN IMMEDIATE');
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO schema_migrations (version,name,checksum) VALUES (?,?,?)')
          .run(migration.version, migration.name, migrationChecksum(migration));
        database.exec('COMMIT');
      }
      const storeId = '10000000-0000-4000-8000-000000000001';
      const counterId = '20000000-0000-4000-8000-000000000001';
      const userId = '30000000-0000-4000-8000-000000000001';
      const cashId = '40000000-0000-4000-8000-000000000001';
      const revenueId = '50000000-0000-4000-8000-000000000001';
      const journalId = '60000000-0000-4000-8000-000000000001';
      database.prepare('INSERT INTO stores (id,name) VALUES (?,?)').run(storeId, 'Migration Store');
      database
        .prepare('INSERT INTO counters (id,store_id,name) VALUES (?,?,?)')
        .run(counterId, storeId, 'Counter');
      database
        .prepare(
          "INSERT INTO users (id,store_id,username,display_name,password_hash,role) VALUES (?,?,'owner','Owner','test-hash','owner')",
        )
        .run(userId, storeId);
      database
        .prepare(
          'INSERT INTO accounts (id,store_id,code,name,account_type,normal_balance) VALUES (?,?,?,?,?,?)',
        )
        .run(cashId, storeId, '1000', 'Cash', 'asset', 'debit');
      database
        .prepare(
          'INSERT INTO accounts (id,store_id,code,name,account_type,normal_balance) VALUES (?,?,?,?,?,?)',
        )
        .run(revenueId, storeId, '4000', 'Revenue', 'income', 'credit');
      database
        .prepare(
          "INSERT INTO journal_entries (id,store_id,entry_number,source_type,source_id,status,currency_code,description,posted_by_user_id) VALUES (?,?,?,'manual',?,'posted','PKR','Preserve me',?)",
        )
        .run(journalId, storeId, 'JE-20261013-0001', journalId, userId);
      database
        .prepare(
          'INSERT INTO journal_lines (id,journal_entry_id,account_id,line_number,debit_minor,credit_minor) VALUES (?,?,?,?,?,?)',
        )
        .run('70000000-0000-4000-8000-000000000001', journalId, cashId, 1, 100, 0);
      database
        .prepare(
          'INSERT INTO journal_lines (id,journal_entry_id,account_id,line_number,debit_minor,credit_minor) VALUES (?,?,?,?,?,?)',
        )
        .run('80000000-0000-4000-8000-000000000001', journalId, revenueId, 2, 0, 100);
      applyMigrations(database);
      expect(
        database
          .prepare('SELECT description,source_type AS sourceType FROM journal_entries WHERE id=?')
          .get(journalId),
      ).toEqual({ description: 'Preserve me', sourceType: 'manual' });
      expect(
        database
          .prepare('SELECT COUNT(*) AS count FROM journal_lines WHERE journal_entry_id=?')
          .get(journalId),
      ).toEqual({ count: 2 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('backfills legacy products, stock movements and store settings into the sync outbox', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ) STRICT;
      `);
      for (const migration of migrations.slice(0, 9)) {
        database.exec(migration.sql);
        database
          .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, migrationChecksum(migration));
      }
      const storeId = '10000000-0000-4000-8000-000000000001';
      const counterId = '20000000-0000-4000-8000-000000000001';
      const productId = '30000000-0000-4000-8000-000000000001';
      const movementId = '40000000-0000-4000-8000-000000000001';
      database
        .prepare('INSERT INTO stores (id, name, currency_code) VALUES (?, ?, ?)')
        .run(storeId, 'Legacy Store', 'PKR');
      database
        .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
        .run(counterId, storeId, 'Counter 1');
      database
        .prepare(
          'INSERT INTO products (id, store_id, name, base_unit, purchase_cost_minor, selling_price_minor) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(productId, storeId, 'Legacy Rice', 'piece', 100, 200);
      database
        .prepare('INSERT INTO product_barcodes (id, product_id, barcode) VALUES (?, ?, ?)')
        .run('50000000-0000-4000-8000-000000000001', productId, '1234567890123');
      database
        .prepare(
          "INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, reference_type, reference_id, reason) VALUES (?, ?, ?, ?, 'receipt', 1000, 'purchase_order', 'PO-1', 'Legacy receipt')",
        )
        .run(movementId, storeId, counterId, productId);
      applyMigrations(database);
      const events = database
        .prepare(
          'SELECT id, event_type AS eventType, aggregate_id AS aggregateId, payload_json AS payloadJson FROM outbox_events ORDER BY rowid',
        )
        .all() as { id: string; eventType: string; aggregateId: string; payloadJson: string }[];
      expect(events).toHaveLength(3);
      expect(events.map((event) => event.eventType)).toEqual([
        'store.settings.updated',
        'product.created',
        'stock.movement.recorded',
      ]);
      for (const event of events)
        expect(event.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      expect(JSON.parse(events[0].payloadJson).settings).toMatchObject({
        storeId,
        name: 'Legacy Store',
        currencyCode: 'PKR',
      });
      expect(JSON.parse(events[1].payloadJson).product).toMatchObject({
        id: productId,
        name: 'Legacy Rice',
        barcodes: ['1234567890123'],
      });
      expect(JSON.parse(events[2].payloadJson)).toMatchObject({
        movementId,
        productId,
        quantityDeltaMilli: 1000,
      });
    } finally {
      database.close();
    }
  });

  it('persists committed data after close and reopen', () => {
    const path = createDatabasePath();
    const first = openLocalDatabase(path);
    first.connection
      .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
      .run('store-1', 'Test Store');
    first.close();

    const second = openLocalDatabase(path);
    try {
      expect(second.connection.prepare('SELECT id, name, currency_code FROM stores').get()).toEqual(
        {
          id: 'store-1',
          name: 'Test Store',
          currency_code: 'PKR',
        },
      );
      expect(second.connection.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    } finally {
      second.close();
    }
  });

  it('rolls back all writes when a transaction fails', () => {
    const database = openLocalDatabase(createDatabasePath());
    try {
      expect(() =>
        runInTransaction(database.connection, () => {
          database.connection
            .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
            .run('store-rollback', 'Rollback Store');
          throw new Error('simulated failure');
        }),
      ).toThrow('simulated failure');
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM stores').get()).toEqual({
        count: 0,
      });
      expect(database.connection.isTransaction).toBe(false);
    } finally {
      database.close();
    }
  });

  it('enforces foreign keys and unique product barcodes', () => {
    const database = openLocalDatabase(createDatabasePath());
    try {
      database.connection
        .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
        .run('store-1', 'Test Store');
      database.connection
        .prepare('INSERT INTO categories (id, store_id, name) VALUES (?, ?, ?)')
        .run('cat-1', 'store-1', 'Grocery');
      database.connection
        .prepare(
          'INSERT INTO products (id, store_id, category_id, name, selling_price_minor) VALUES (?, ?, ?, ?, ?)',
        )
        .run('product-1', 'store-1', 'cat-1', 'Rice', 25000);
      database.connection
        .prepare('INSERT INTO product_barcodes (id, product_id, barcode) VALUES (?, ?, ?)')
        .run('barcode-1', 'product-1', '1234567890');
      expect(() =>
        database.connection
          .prepare('INSERT INTO product_barcodes (id, product_id, barcode) VALUES (?, ?, ?)')
          .run('barcode-2', 'product-1', '1234567890'),
      ).toThrow();
      expect(() =>
        database.connection
          .prepare(
            'INSERT INTO products (id, store_id, name, selling_price_minor) VALUES (?, ?, ?, ?)',
          )
          .run('orphan', 'missing-store', 'Invalid', 100),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('refuses to apply modified SQL for an already-applied migration', () => {
    const database = openLocalDatabase(createDatabasePath());
    try {
      database.connection
        .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
        .run('tampered');
      expect(() => applyMigrations(database.connection)).toThrow(/checksum mismatch/i);
    } finally {
      database.close();
    }
  });
});
