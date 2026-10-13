import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations';

export interface LocalDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;
  close(): void;
}

export function openLocalDatabase(databasePath: string): LocalDatabase {
  const resolvedPath = databasePath === ':memory:' ? ':memory:' : resolve(databasePath);
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true });

  const connection = new DatabaseSync(resolvedPath, { enableForeignKeyConstraints: true });
  try {
    connection.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      PRAGMA trusted_schema = OFF;
    `);
    applyMigrations(connection);
    const integrity = connection.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (integrity.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${integrity.quick_check}`);
    }
    return {
      connection,
      path: resolvedPath,
      close: () => connection.close(),
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function runInTransaction<T>(connection: DatabaseSync, operation: () => T): T {
  if (connection.isTransaction) {
    throw new Error(
      'Nested transactions are not supported by runInTransaction; use a savepoint explicitly.',
    );
  }
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result instanceof Promise) {
      throw new Error('runInTransaction callback must be synchronous.');
    }
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK');
    throw error;
  }
}
