import { ipcMain } from 'electron';
import { AccountingService } from '../accounting/accounting-service';
import { getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { requirePermission } from '../auth/auth-service';

const channels = ['accounting:list-accounts', 'accounting:list-journals'] as const;
function service(): AccountingService {
  const database = getLocalDatabaseConnection();
  const actor = requirePermission(database, 'accounting.view');
  return new AccountingService(database, getLocalStoreId(), actor.userId);
}
export function registerAccountingIpcHandlers(): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('accounting:list-accounts', () => service().listAccounts());
  ipcMain.handle('accounting:list-journals', () => service().listRecentJournals(100));
}
