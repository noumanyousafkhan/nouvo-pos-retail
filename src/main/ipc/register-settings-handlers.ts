import { ipcMain } from 'electron';
import { SaveBusinessSettingsSchema } from '../../shared/contracts/settings';
import { getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { SettingsService } from '../settings/settings-service';

const getSettingsChannel = 'settings:get-business';
const saveSettingsChannel = 'settings:save-business';
function settingsService(): SettingsService {
  return new SettingsService(getLocalDatabaseConnection(), getLocalStoreId());
}

export function registerSettingsIpcHandlers(): void {
  ipcMain.removeHandler(getSettingsChannel);
  ipcMain.handle(getSettingsChannel, () => settingsService().get());
  ipcMain.removeHandler(saveSettingsChannel);
  ipcMain.handle(saveSettingsChannel, (_event, rawInput: unknown) => {
    const input = SaveBusinessSettingsSchema.parse(rawInput);
    return settingsService().save(input);
  });
}
