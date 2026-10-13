import { app, ipcMain } from 'electron';
import { AppInfoSchema, EmptyPayloadSchema, RuntimeStatusSchema } from '../../shared/contracts/app';
import { getLocalDatabaseStatus } from '../database';

const appInfoChannel = 'app:get-info';
const runtimeStatusChannel = 'app:get-runtime-status';

export function registerAppIpcHandlers(): void {
  ipcMain.removeHandler(appInfoChannel);
  ipcMain.handle(appInfoChannel, (_event, rawPayload: unknown) => {
    EmptyPayloadSchema.parse(rawPayload ?? {});
    return AppInfoSchema.parse({
      name: 'NOUVO POS Cash & Carry',
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged,
    });
  });

  ipcMain.removeHandler(runtimeStatusChannel);
  ipcMain.handle(runtimeStatusChannel, (_event, rawPayload: unknown) => {
    EmptyPayloadSchema.parse(rawPayload ?? {});
    return RuntimeStatusSchema.parse({
      application: 'ready',
      localDatabase: getLocalDatabaseStatus(),
      synchronization: 'not-configured',
    });
  });
}
