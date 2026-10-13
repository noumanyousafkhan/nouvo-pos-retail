import { ipcMain } from 'electron';
import { SaveSyncConfigurationSchema } from '../../shared/contracts/sync';
import { requirePermission } from '../auth/auth-service';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { SyncConfigStore } from '../sync/sync-config-store';
import { SyncService } from '../sync/sync-service';
import { SyncWorker } from '../sync/sync-worker';

const channels = [
  'sync:get-overview',
  'sync:retry-failed',
  'sync:run-now',
  'sync:get-configuration',
  'sync:save-configuration',
] as const;

export function registerSyncIpcHandlers(
  service: SyncService,
  worker: SyncWorker,
  configStore: SyncConfigStore,
): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('sync:get-overview', () => {
    requirePermission(getLocalDatabaseConnection(), 'sync.view');
    return service.getOverview(worker.configured);
  });
  ipcMain.handle('sync:get-configuration', () => {
    requirePermission(getLocalDatabaseConnection(), 'settings.view');
    return {
      ...worker.getPublicConfiguration(),
      secureStorageAvailable: configStore.secureStorageAvailable,
      storeId: getLocalStoreId(),
      counterId: getLocalCounterId(),
    };
  });
  ipcMain.handle('sync:save-configuration', async (_event, input: unknown) => {
    requirePermission(getLocalDatabaseConnection(), 'settings.manage');
    const parsed = SaveSyncConfigurationSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(
        'Sync configuration is invalid: ' +
          parsed.error.issues.map((issue) => issue.message).join('; '),
      );
    const credentials = await configStore.save(parsed.data.url, parsed.data.token);
    worker.configure(credentials.url, credentials.token);
    return {
      ...worker.getPublicConfiguration(),
      secureStorageAvailable: configStore.secureStorageAvailable,
      storeId: getLocalStoreId(),
      counterId: getLocalCounterId(),
    };
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
