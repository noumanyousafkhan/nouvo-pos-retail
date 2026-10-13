import { ipcMain } from 'electron';
import {
  ProductIdPayloadSchema,
  ProductListQuerySchema,
  ProductInputSchema,
} from '../../shared/contracts/products';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { StockMovementInputSchema } from '../../shared/contracts/stock';
import { StockService } from '../inventory/stock-service';
import { ProductService } from '../inventory/product-service';

const listProductsChannel = 'inventory:list-products';
const saveProductChannel = 'inventory:save-product';
const archiveProductChannel = 'inventory:archive-product';
const recordStockMovementChannel = 'inventory:record-stock-movement';

function productService(): ProductService {
  return new ProductService(getLocalDatabaseConnection(), getLocalStoreId(), getLocalCounterId());
}

export function registerInventoryIpcHandlers(): void {
  ipcMain.removeHandler(listProductsChannel);
  ipcMain.handle(listProductsChannel, (_event, rawQuery: unknown) => {
    const query = ProductListQuerySchema.parse(rawQuery ?? {});
    return productService().list(query);
  });

  ipcMain.removeHandler(saveProductChannel);
  ipcMain.handle(saveProductChannel, (_event, rawInput: unknown) => {
    const input = ProductInputSchema.parse(rawInput);
    return productService().save(input);
  });

  ipcMain.removeHandler(recordStockMovementChannel);
  ipcMain.handle(recordStockMovementChannel, (_event, rawInput: unknown) => {
    const input = StockMovementInputSchema.parse(rawInput);
    return new StockService(
      getLocalDatabaseConnection(),
      getLocalStoreId(),
      getLocalCounterId(),
    ).record(input);
  });

  ipcMain.removeHandler(archiveProductChannel);
  ipcMain.handle(archiveProductChannel, (_event, rawPayload: unknown) => {
    const payload = ProductIdPayloadSchema.parse(rawPayload);
    const reason =
      typeof rawPayload === 'object' && rawPayload !== null && 'reason' in rawPayload
        ? (rawPayload as { reason?: unknown }).reason
        : undefined;
    productService().archive(payload, reason);
    return { archived: true };
  });
}
