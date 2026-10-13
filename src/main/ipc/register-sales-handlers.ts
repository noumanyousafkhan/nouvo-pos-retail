import { ipcMain } from 'electron';
import { SalesListQuerySchema } from '../../shared/contracts/sales';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { SalesService } from '../checkout/sales-service';

const listSalesChannel = 'sales:list';
const getSaleChannel = 'sales:get';
function salesService(): SalesService {
  return new SalesService(getLocalDatabaseConnection(), getLocalStoreId(), getLocalCounterId());
}

export function registerSalesIpcHandlers(): void {
  ipcMain.removeHandler(listSalesChannel);
  ipcMain.handle(listSalesChannel, (_event, rawQuery: unknown) => {
    const query = SalesListQuerySchema.parse(rawQuery ?? {});
    return salesService().list(query);
  });
  ipcMain.removeHandler(getSaleChannel);
  ipcMain.handle(getSaleChannel, (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') throw new Error('Sale ID must be a string.');
    return salesService().getById(rawId);
  });
}
