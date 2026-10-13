import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { logger } from '../services/logger';
import { openLocalDatabase, runInTransaction, type LocalDatabase } from './connection';

let localDatabase: LocalDatabase | null = null;
let initializationError: string | null = null;

export function initializeLocalDatabase(): void {
  if (localDatabase) return;
  const databasePath = join(app.getPath('userData'), 'data', 'counter.sqlite');
  try {
    localDatabase = openLocalDatabase(databasePath);
    runInTransaction(localDatabase.connection, () => {
      const existingStore = localDatabase?.connection
        .prepare('SELECT id FROM stores LIMIT 1')
        .get() as { id: string } | undefined;
      if (!existingStore) {
        const storeId = randomUUID();
        localDatabase?.connection
          .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
          .run(storeId, 'My Store');
        localDatabase?.connection
          .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
          .run(randomUUID(), storeId, 'Counter 1');
      }
    });
    initializationError = null;
    logger.info({ databasePath: localDatabase.path }, 'Local SQLite database initialized');
  } catch (error) {
    initializationError =
      error instanceof Error ? error.message : 'Unknown local database initialization error';
    logger.error({ err: error }, 'Local SQLite database initialization failed');
    throw error;
  }
}

export function getLocalDatabaseConnection() {
  if (!localDatabase)
    throw new Error(
      'Local database is not available. Restart the application or inspect the application log.',
    );
  return localDatabase.connection;
}

export function getLocalStoreId(): string {
  const store = getLocalDatabaseConnection()
    .prepare('SELECT id FROM stores ORDER BY created_at LIMIT 1')
    .get() as { id: string } | undefined;
  if (!store)
    throw new Error(
      'Local store setup is missing. Reopen the application to initialize the store.',
    );
  return store.id;
}

export function getLocalCounterId(): string {
  const counter = getLocalDatabaseConnection()
    .prepare('SELECT id FROM counters ORDER BY created_at LIMIT 1')
    .get() as { id: string } | undefined;
  if (!counter)
    throw new Error(
      'Local counter setup is missing. Reopen the application to initialize the counter.',
    );
  return counter.id;
}

export function getLocalDatabaseStatus(): 'ready' | 'error' | 'not-configured' {
  if (localDatabase) return 'ready';
  return initializationError ? 'error' : 'not-configured';
}

export function closeLocalDatabase(): void {
  if (!localDatabase) return;
  try {
    localDatabase.close();
    logger.info('Local SQLite database closed');
  } finally {
    localDatabase = null;
  }
}
