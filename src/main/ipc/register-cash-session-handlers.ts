import { ipcMain } from 'electron';
import {
  CashMovementInputSchema,
  CloseCashierSessionSchema,
  OpenCashierSessionSchema,
} from '../../shared/contracts/cash-sessions';
import { requirePermission } from '../auth/auth-service';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { CashSessionService } from '../checkout/cash-session-service';

const channels = [
  'cash-session:get-active',
  'cash-session:list-history',
  'cash-session:open',
  'cash-session:record-movement',
  'cash-session:close',
] as const;
function service(permission: string) {
  const database = getLocalDatabaseConnection();
  const actor = requirePermission(database, permission);
  return new CashSessionService(
    database,
    getLocalStoreId(),
    getLocalCounterId(),
    actor.userId,
    actor.role,
  );
}
export function registerCashSessionIpcHandlers(): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('cash-session:get-active', () => service('cash_session.view').getActive());
  ipcMain.handle('cash-session:list-history', () => service('cash_session.view').listHistory());
  ipcMain.handle('cash-session:open', (_event, rawInput: unknown) =>
    service('cash_session.open').open(OpenCashierSessionSchema.parse(rawInput)),
  );
  ipcMain.handle('cash-session:record-movement', (_event, rawInput: unknown) =>
    service('cash_session.movement').recordMovement(CashMovementInputSchema.parse(rawInput)),
  );
  ipcMain.handle('cash-session:close', (_event, rawInput: unknown) =>
    service('cash_session.close').close(CloseCashierSessionSchema.parse(rawInput)),
  );
}
