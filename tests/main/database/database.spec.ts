// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase, runInTransaction } from '../../../src/main/database/connection';
import { applyMigrations } from '../../../src/main/database/migrations';

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
      ]);
      expect(
        database.connection
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox_events'")
          .get(),
      ).toEqual({ name: 'outbox_events' });
      applyMigrations(database.connection);
      expect(
        database.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
      ).toEqual({ count: 7 });
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
