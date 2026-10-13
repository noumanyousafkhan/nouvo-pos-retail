import { contextBridge, ipcRenderer } from 'electron';
import type { NouvoApi } from '../shared/contracts/app';
import type { ProductInput, ProductListQuery } from '../shared/contracts/products';

const api: NouvoApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info', {}),
  getRuntimeStatus: () => ipcRenderer.invoke('app:get-runtime-status', {}),
  listProducts: (query?: Partial<ProductListQuery>) =>
    ipcRenderer.invoke('inventory:list-products', query ?? {}),
  saveProduct: (input: ProductInput) => ipcRenderer.invoke('inventory:save-product', input),
  archiveProduct: (id: string, reason?: string) =>
    ipcRenderer.invoke('inventory:archive-product', { id, reason }),
});

contextBridge.exposeInMainWorld('nouvo', api);
