import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { app } from 'electron';
import { logger } from '../services/logger';
import {
  closeLocalDatabase,
  getLocalCounterId,
  getLocalDatabaseConnection,
  getLocalDatabasePath,
  getLocalStoreId,
  initializeLocalDatabase,
} from '../database';
import { RestoreResultSchema, type RestoreResult } from '../../shared/contracts/backup';
import {
  createDatabaseBackup,
  replaceDatabaseFromBackup,
  validateBackupFile,
} from './backup-service';

export function restoreLocalBackup(sourcePath: string): RestoreResult {
  const source = resolve(sourcePath);
  const livePath = getLocalDatabasePath();
  if (source === resolve(livePath))
    throw new Error('The live database cannot be used as its own restore source.');
  const storeId = getLocalStoreId();
  const counterId = getLocalCounterId();
  validateBackupFile(source, { storeId, counterId });

  const backupDirectory = join(app.getPath('userData'), 'backups');
  mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const automaticBackupPath = join(backupDirectory, `before-restore-${stamp}.sqlite`);
  createDatabaseBackup(getLocalDatabaseConnection(), livePath, automaticBackupPath, {
    storeId,
    counterId,
  });

  const stagedPath = `${livePath}.restore-${randomUUID()}`;
  try {
    replaceDatabaseFromBackup(
      source,
      livePath,
      stagedPath,
      { storeId, counterId },
      closeLocalDatabase,
    );
    initializeLocalDatabase();
    const restored = validateBackupFile(livePath, { storeId, counterId });
    logger.warn(
      { source: basename(source), schemaVersion: restored.schemaVersion },
      'Local database restored from backup',
    );
    return RestoreResultSchema.parse({
      restoredFrom: source,
      automaticBackupPath,
      schemaVersion: restored.schemaVersion,
      integrity: restored.integrity,
    });
  } catch (error) {
    rmSync(stagedPath, { force: true });
    try {
      closeLocalDatabase();
      rmSync(`${livePath}-wal`, { force: true });
      rmSync(`${livePath}-shm`, { force: true });
      copyFileSync(automaticBackupPath, livePath);
      initializeLocalDatabase();
    } catch (recoveryError) {
      logger.fatal(
        { err: recoveryError, automaticBackupPath },
        'Automatic database recovery after failed restore also failed',
      );
      throw new Error(
        `Restore failed and automatic recovery failed. Preserve this backup file: ${automaticBackupPath}`,
        { cause: recoveryError },
      );
    }
    throw new Error(
      `Restore failed; the original database was restored from the automatic safety copy. ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  }
}
