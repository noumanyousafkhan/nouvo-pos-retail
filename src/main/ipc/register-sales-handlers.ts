import { ipcMain } from 'electron';
import { SalesListQuerySchema } from '../../shared/contracts/sales';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { SalesService } from '../checkout/sales-service';
import { requirePermission } from '../auth/auth-service';
import { ReturnSaleInputSchema, VoidSaleInputSchema } from '../../shared/contracts/returns';
import { ReturnsService } from '../checkout/returns-service';

const listSalesChannel = 'sales:list';
const getSaleChannel = 'sales:get';
const returnableItemsChannel = 'sales:returnable-items';
const returnSaleChannel = 'sales:return';
const voidSaleChannel = 'sales:void';
function salesService(): SalesService {
  return new SalesService(getLocalDatabaseConnection(), getLocalStoreId(), getLocalCounterId());
}

export function registerSalesIpcHandlers(): void {
  ipcMain.removeHandler(listSalesChannel);
  ipcMain.handle(listSalesChannel, (_event, rawQuery: unknown) => {
    requirePermission(getLocalDatabaseConnection(), 'sales.view');
    const query = SalesListQuerySchema.parse(rawQuery ?? {});
    return salesService().list(query);
  });
  ipcMain.removeHandler(returnableItemsChannel);
  ipcMain.handle(returnableItemsChannel, (_event, rawSaleId: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'sales.return');
    return new ReturnsService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).getReturnableItems(rawSaleId);
  });
  ipcMain.removeHandler(returnSaleChannel);
  ipcMain.handle(returnSaleChannel, (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'sales.return');
    return new ReturnsService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).returnSale(ReturnSaleInputSchema.parse(rawInput));
  });
  ipcMain.removeHandler(voidSaleChannel);
  ipcMain.handle(voidSaleChannel, (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'sales.void');
    return new ReturnsService(
      database,
      getLocalStoreId(),
      getLocalCounterId(),
      actor.userId,
    ).voidSale(VoidSaleInputSchema.parse(rawInput));
  });

  ipcMain.removeHandler(getSaleChannel);
  ipcMain.handle(getSaleChannel, (_event, rawId: unknown) => {
    requirePermission(getLocalDatabaseConnection(), 'sales.view');
    if (typeof rawId !== 'string') throw new Error('Sale ID must be a string.');
    return salesService().getById(rawId);
  });
}
