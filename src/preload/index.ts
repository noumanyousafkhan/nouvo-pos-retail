import { contextBridge, ipcRenderer } from 'electron';
import type { NouvoApi } from '../shared/contracts/app';

const api: NouvoApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info', {}),
  getRuntimeStatus: () => ipcRenderer.invoke('app:get-runtime-status', {}),
});

contextBridge.exposeInMainWorld('nouvo', api);
