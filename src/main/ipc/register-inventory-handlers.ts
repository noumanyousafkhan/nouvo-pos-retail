import { ipcMain } from 'electron';
import {
  ProductIdPayloadSchema,
  ProductListQuerySchema,
  ProductInputSchema,
} from '../../shared/contracts/products';
import { getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { ProductService } from '../inventory/product-service';

const listProductsChannel = 'inventory:list-products';
const saveProductChannel = 'inventory:save-product';
const archiveProductChannel = 'inventory:archive-product';

function productService(): ProductService {
  return new ProductService(getLocalDatabaseConnection(), getLocalStoreId());
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
