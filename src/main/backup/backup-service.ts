import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION } from '../database/migrations';
import { BackupResultSchema, type BackupResult } from '../../shared/contracts/backup';

interface BackupValidation {
  storeId: string;
  counterId: string;
  schemaVersion: number;
  integrity: 'ok';
}

export function validateBackupFile(
  filePath: string,
  expected?: { storeId: string; counterId: string },
): BackupValidation {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile())
    throw new Error('Backup file does not exist.');
  const database = new DatabaseSync(resolvedPath, { enableForeignKeyConstraints: true });
  try {
    database.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;');
    const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
    if (integrity.quick_check !== 'ok')
      throw new Error(`Backup integrity check failed: ${integrity.quick_check}`);
    const migrationTable = database
      .prepare(
        "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get();
    if (!migrationTable) throw new Error('The selected file is not a NOUVO POS database backup.');
    const schema = database
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number };
    if (schema.version > CURRENT_SCHEMA_VERSION)
      throw new Error(
        'This backup was created by a newer app version. Update the POS before restoring it.',
      );
    const store = database.prepare('SELECT id FROM stores ORDER BY created_at LIMIT 1').get() as
      { id: string } | undefined;
    const counter = database
      .prepare('SELECT id FROM counters ORDER BY created_at LIMIT 1')
      .get() as { id: string } | undefined;
    if (!store || !counter) throw new Error('Backup is missing its store or counter identity.');
    if (expected && (store.id !== expected.storeId || counter.id !== expected.counterId)) {
      throw new Error(
        'This backup belongs to a different store or counter and cannot be restored here.',
      );
    }
    const foreignKeyIssues = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyIssues.length > 0)
      throw new Error('Backup contains broken foreign-key references and cannot be restored.');
    return {
      storeId: store.id,
      counterId: counter.id,
      schemaVersion: schema.version,
      integrity: 'ok',
    };
  } finally {
    database.close();
  }
}

export function replaceDatabaseFromBackup(
  sourcePath: string,
  livePath: string,
  stagedPath: string,
  expected: { storeId: string; counterId: string },
  closeCurrentDatabase: () => void,
): void {
  const source = resolve(sourcePath);
  const live = resolve(livePath);
  const staged = resolve(stagedPath);
  if (source === live)
    throw new Error('The live database cannot be used as its own restore source.');
  try {
    copyFileSync(source, staged);
    validateBackupFile(staged, expected);
    closeCurrentDatabase();
    rmSync(`${staged}-wal`, { force: true });
    rmSync(`${staged}-shm`, { force: true });
    rmSync(`${live}-wal`, { force: true });
    rmSync(`${live}-shm`, { force: true });
    rmSync(live, { force: true });
    renameSync(staged, live);
  } catch (error) {
    rmSync(staged, { force: true });
    rmSync(`${staged}-wal`, { force: true });
    rmSync(`${staged}-shm`, { force: true });
    throw error;
  }
}

export function createDatabaseBackup(
  connection: DatabaseSync,
  databasePath: string,
  filePath: string,
  expected: { storeId: string; counterId: string },
): BackupResult {
  const source = resolve(databasePath);
  const target = resolve(filePath);
  if (source === target) throw new Error('Backup destination cannot be the live database file.');
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  const checkpoint = connection.prepare('PRAGMA wal_checkpoint(FULL)').get() as { busy: number };
  if (checkpoint.busy !== 0)
    throw new Error('The database is busy. Wait a moment and retry the backup.');
  try {
    copyFileSync(source, target);
    const validation = validateBackupFile(target, expected);
    const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
    return BackupResultSchema.parse({
      filePath: target,
      sha256,
      sizeBytes: statSync(target).size,
      schemaVersion: validation.schemaVersion,
      integrity: validation.integrity,
    });
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }
}
