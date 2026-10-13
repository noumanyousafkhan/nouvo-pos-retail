import { ipcMain } from 'electron';
import {
  PurchaseOrderInputSchema,
  ReceivePurchaseOrderSchema,
  SupplierInputSchema,
} from '../../shared/contracts/purchasing';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { requirePermission } from '../auth/auth-service';
import { PurchasingService } from '../purchasing/purchasing-service';

const channels = [
  'purchasing:list-suppliers',
  'purchasing:save-supplier',
  'purchasing:list-orders',
  'purchasing:create-order',
  'purchasing:receive-order',
  'purchasing:cancel-order',
] as const;
function service() {
  const database = getLocalDatabaseConnection();
  const actor = requirePermission(database, 'purchasing.view');
  return new PurchasingService(database, getLocalStoreId(), getLocalCounterId(), actor.userId);
}
export function registerPurchasingIpcHandlers(): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('purchasing:list-suppliers', () => service().listSuppliers());
  ipcMain.handle('purchasing:list-orders', () => service().listPurchaseOrders());
  ipcMain.handle('purchasing:save-supplier', (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.manage');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).saveSupplier(SupplierInputSchema.parse(rawInput));
  });
  ipcMain.handle('purchasing:create-order', (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.manage');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).createPurchaseOrder(PurchaseOrderInputSchema.parse(rawInput));
  });
  ipcMain.handle('purchasing:receive-order', (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.manage');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).receivePurchaseOrder(ReceivePurchaseOrderSchema.parse(rawInput));
  });
  ipcMain.handle('purchasing:cancel-order', (_event, rawId: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.manage');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).cancelPurchaseOrder(rawId);
  });
}
