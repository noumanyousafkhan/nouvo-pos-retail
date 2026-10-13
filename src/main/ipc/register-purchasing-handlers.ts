import { ipcMain } from 'electron';
import {
  PurchaseOrderInputSchema,
  PurchaseReturnInputSchema,
  SupplierPaymentInputSchema,
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
  'purchasing:list-receiving-lines',
  'purchasing:receive-order',
  'purchasing:cancel-order',
  'purchasing:list-returnable-lines',
  'purchasing:create-return',
  'purchasing:list-returns',
  'purchasing:list-balances',
  'purchasing:create-payment',
  'purchasing:list-payments',
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
  ipcMain.handle('purchasing:list-receiving-lines', (_event, rawId: unknown) =>
    service().listPurchaseOrderReceivingLines(rawId),
  );
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
  ipcMain.handle('purchasing:list-returnable-lines', (_event, rawId: unknown) =>
    service().listReturnablePurchaseOrderLines(rawId),
  );
  ipcMain.handle('purchasing:list-returns', () => service().listPurchaseReturns());
  ipcMain.handle('purchasing:create-return', (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.return');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).createPurchaseReturn(PurchaseReturnInputSchema.parse(rawInput));
  });
  ipcMain.handle('purchasing:list-balances', () => service().listSupplierBalances());
  ipcMain.handle('purchasing:list-payments', () => service().listSupplierPayments());
  ipcMain.handle('purchasing:create-payment', (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'purchasing.pay');
    return new PurchasingService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).createSupplierPayment(SupplierPaymentInputSchema.parse(rawInput));
  });
}
