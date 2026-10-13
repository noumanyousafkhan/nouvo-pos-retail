// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabaseBackup,
  replaceDatabaseFromBackup,
  validateBackupFile,
} from '../../../src/main/backup/backup-service';
import { openLocalDatabase } from '../../../src/main/database/connection';

const directories: string[] = [];
const databases: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'nouvo-pos-backup-'));
  directories.push(directory);
  const database = openLocalDatabase(join(directory, 'counter.sqlite'));
  databases.push(database);
  const storeId = 'bb28df5c-7b4e-4cf3-b82e-26e442f3a2f1';
  const counterId = 'e197df7b-3eab-44ca-8a15-1240e62b1b3a';
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Backup Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  return { directory, database, storeId, counterId };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('database backup validation', () => {
  it('creates a consistent backup with integrity metadata and a checksum', () => {
    const { directory, database, storeId, counterId } = setup();
    const backupPath = join(directory, 'backups', 'verified.sqlite');
    const result = createDatabaseBackup(database.connection, database.path, backupPath, {
      storeId,
      counterId,
    });
    expect(result).toMatchObject({ filePath: backupPath, schemaVersion: 3, integrity: 'ok' });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
    database.connection
      .prepare("UPDATE stores SET name = 'Changed after backup' WHERE id = ?")
      .run(storeId);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      expect(backup.prepare('SELECT name FROM stores WHERE id = ?').get(storeId)).toEqual({
        name: 'Backup Store',
      });
    } finally {
      backup.close();
    }
  });

  it('replaces the live database from a validated backup and restores its saved contents', () => {
    const { directory, database, storeId, counterId } = setup();
    const backupPath = join(directory, 'verified.sqlite');
    createDatabaseBackup(database.connection, database.path, backupPath, { storeId, counterId });
    database.connection
      .prepare("UPDATE stores SET name = 'Unsaved later change' WHERE id = ?")
      .run(storeId);
    const databasePath = database.path;
    const index = databases.indexOf(database);
    if (index >= 0) databases.splice(index, 1);
    replaceDatabaseFromBackup(
      backupPath,
      databasePath,
      `${databasePath}.staging`,
      { storeId, counterId },
      () => database.close(),
    );
    const restored = openLocalDatabase(databasePath);
    databases.push(restored);
    expect(
      restored.connection.prepare('SELECT name FROM stores WHERE id = ?').get(storeId),
    ).toEqual({ name: 'Backup Store' });
    expect(restored.connection.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
  });

  it('rejects backups from a different store or counter', () => {
    const { directory, database, storeId, counterId } = setup();
    const backupPath = join(directory, 'verified.sqlite');
    createDatabaseBackup(database.connection, database.path, backupPath, { storeId, counterId });
    expect(() =>
      validateBackupFile(backupPath, {
        storeId: '6b1df68b-c6b5-477b-bb77-8a090a3f07c1',
        counterId,
      }),
    ).toThrow(/different store or counter/i);
  });

  it('rejects an arbitrary non-SQLite file', () => {
    const { directory } = setup();
    const invalidPath = join(directory, 'not-a-backup.sqlite');
    writeFileSync(invalidPath, 'not sqlite');
    expect(() => validateBackupFile(invalidPath)).toThrow();
  });
});
