import { ipcMain } from 'electron';
import { requirePermission } from '../auth/auth-service';
import { getLocalDatabaseConnection } from '../database';
import { SyncService } from '../sync/sync-service';
import { SyncWorker } from '../sync/sync-worker';

const channels = ['sync:get-overview', 'sync:retry-failed', 'sync:run-now'] as const;
export function registerSyncIpcHandlers(service: SyncService, worker: SyncWorker): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('sync:get-overview', () => {
    requirePermission(getLocalDatabaseConnection(), 'sync.view');
    return service.getOverview(worker.configured);
  });
  ipcMain.handle('sync:retry-failed', () => {
    requirePermission(getLocalDatabaseConnection(), 'sync.retry');
    const retried = service.retryFailed();
    if (worker.configured) void worker.syncOnce();
    return retried;
  });
  ipcMain.handle('sync:run-now', async () => {
    requirePermission(getLocalDatabaseConnection(), 'sync.retry');
    await worker.syncOnce();
    return service.getOverview(worker.configured);
  });
}
