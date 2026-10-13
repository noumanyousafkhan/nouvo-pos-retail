import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import {
  getLocalCounterId,
  getLocalDatabaseConnection,
  getLocalDatabasePath,
  getLocalStoreId,
} from '../database';
import { createDatabaseBackup } from '../backup/backup-service';
import { restoreLocalBackup } from '../backup/restore-service';

const createBackupChannel = 'backup:create';
const restoreBackupChannel = 'backup:restore';

export function registerBackupIpcHandlers(): void {
  ipcMain.removeHandler(createBackupChannel);
  ipcMain.handle(createBackupChannel, async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog({
      title: 'Create verified NOUVO POS backup',
      defaultPath: join(app.getPath('documents'), `nouvo-pos-backup-${timestamp}.sqlite`),
      buttonLabel: 'Create backup',
      filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return createDatabaseBackup(
      getLocalDatabaseConnection(),
      getLocalDatabasePath(),
      result.filePath,
      {
        storeId: getLocalStoreId(),
        counterId: getLocalCounterId(),
      },
    );
  });

  ipcMain.removeHandler(restoreBackupChannel);
  ipcMain.handle(restoreBackupChannel, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Restore NOUVO POS database backup',
      buttonLabel: 'Validate and restore',
      properties: ['openFile'],
      filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return restoreLocalBackup(result.filePaths[0]);
  });
}
