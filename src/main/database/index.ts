import { app } from 'electron';
import { join } from 'node:path';
import { logger } from '../services/logger';
import { openLocalDatabase, type LocalDatabase } from './connection';

let localDatabase: LocalDatabase | null = null;
let initializationError: string | null = null;

export function initializeLocalDatabase(): void {
  if (localDatabase) return;
  const databasePath = join(app.getPath('userData'), 'data', 'counter.sqlite');
  try {
    localDatabase = openLocalDatabase(databasePath);
    initializationError = null;
    logger.info({ databasePath: localDatabase.path }, 'Local SQLite database initialized');
  } catch (error) {
    initializationError =
      error instanceof Error ? error.message : 'Unknown local database initialization error';
    logger.error({ err: error }, 'Local SQLite database initialization failed');
    throw error;
  }
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
