import { ipcMain } from 'electron';
import { SaveBusinessSettingsSchema } from '../../shared/contracts/settings';
import { getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { SettingsService } from '../settings/settings-service';
import { requirePermission } from '../auth/auth-service';

const getSettingsChannel = 'settings:get-business';
const saveSettingsChannel = 'settings:save-business';
function settingsService(): SettingsService {
  return new SettingsService(getLocalDatabaseConnection(), getLocalStoreId());
}

export function registerSettingsIpcHandlers(): void {
  ipcMain.removeHandler(getSettingsChannel);
  ipcMain.handle(getSettingsChannel, () => {
    requirePermission(getLocalDatabaseConnection(), 'settings.view');
    return settingsService().get();
  });
  ipcMain.removeHandler(saveSettingsChannel);
  ipcMain.handle(saveSettingsChannel, (_event, rawInput: unknown) => {
    requirePermission(getLocalDatabaseConnection(), 'settings.manage');
    const input = SaveBusinessSettingsSchema.parse(rawInput);
    return settingsService().save(input);
  });
}
