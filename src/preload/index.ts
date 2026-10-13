import { contextBridge, ipcRenderer } from 'electron';
import type { NouvoApi } from '../shared/contracts/app';
import type { ProductInput, ProductListQuery } from '../shared/contracts/products';
import type { StockMovementInput } from '../shared/contracts/stock';
import type { CheckoutInput } from '../shared/contracts/checkout';

const api: NouvoApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info', {}),
  getRuntimeStatus: () => ipcRenderer.invoke('app:get-runtime-status', {}),
  listProducts: (query?: Partial<ProductListQuery>) =>
    ipcRenderer.invoke('inventory:list-products', query ?? {}),
  saveProduct: (input: ProductInput) => ipcRenderer.invoke('inventory:save-product', input),
  archiveProduct: (id: string, reason?: string) =>
    ipcRenderer.invoke('inventory:archive-product', { id, reason }),
  recordStockMovement: (input: StockMovementInput) =>
    ipcRenderer.invoke('inventory:record-stock-movement', input),
  completeSale: (input: CheckoutInput) => ipcRenderer.invoke('checkout:complete-sale', input),
});

contextBridge.exposeInMainWorld('nouvo', api);
