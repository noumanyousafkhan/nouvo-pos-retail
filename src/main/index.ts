import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { logger } from './services/logger';
import { registerAppIpcHandlers } from './ipc/register-app-handlers';
import { closeLocalDatabase, getLocalDatabaseStatus, initializeLocalDatabase } from './database';
import { registerInventoryIpcHandlers } from './ipc/register-inventory-handlers';
import { registerCheckoutIpcHandlers } from './ipc/register-checkout-handlers';
import { registerSalesIpcHandlers } from './ipc/register-sales-handlers';
import { registerSettingsIpcHandlers } from './ipc/register-settings-handlers';
import { registerBackupIpcHandlers } from './ipc/register-backup-handlers';
import { registerAuthIpcHandlers } from './ipc/register-auth-handlers';
import { registerReportsIpcHandlers } from './ipc/register-reports-handlers';
import { registerPurchasingIpcHandlers } from './ipc/register-purchasing-handlers';
import { registerCashSessionIpcHandlers } from './ipc/register-cash-session-handlers';
import { registerAccountingIpcHandlers } from './ipc/register-accounting-handlers';
import { registerSyncIpcHandlers } from './ipc/register-sync-handlers';
import { registerPrinterIpcHandlers } from './ipc/register-printer-ipc-handlers';
import { SyncConfigStore } from './sync/sync-config-store';
import { SyncService } from './sync/sync-service';
import { SyncWorker } from './sync/sync-worker';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from './database';

let mainWindow: BrowserWindow | null = null;
let syncWorker: SyncWorker | null = null;

function configureContentSecurityPolicy(): void {
  const developmentConnectSources = process.env.ELECTRON_RENDERER_URL
    ? ' ws://localhost:* http://localhost:*'
    : '';

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'${developmentConnectSources}`,
        ],
      },
    });
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f7fb',
    icon: join(__dirname, '../../build/icon.png'),
    title: 'NOUVO POS Cash & Carry',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error({ reason: details.reason, exitCode: details.exitCode }, 'Renderer process exited');
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app
  .whenReady()
  .then(async () => {
    configureContentSecurityPolicy();
    try {
      initializeLocalDatabase();
    } catch {
      // Keep the shell available so the UI can report the database failure and recovery guidance.
    }
    registerAppIpcHandlers();
    registerPrinterIpcHandlers();
    if (getLocalDatabaseStatus() === 'ready') {
      const syncService = new SyncService(
        getLocalDatabaseConnection(),
        getLocalStoreId(),
        getLocalCounterId(),
      );
      const syncConfigStore = new SyncConfigStore(
        join(app.getPath('userData'), 'sync-config.json'),
      );
      let syncEnvironment: NodeJS.ProcessEnv = process.env;
      try {
        const savedConfig = await syncConfigStore.load();
        if (savedConfig)
          syncEnvironment = {
            ...process.env,
            NOUVO_SYNC_URL: savedConfig.url,
            NOUVO_SYNC_TOKEN: savedConfig.token,
          };
      } catch (error) {
        logger.error(
          { err: error },
          'Saved sync configuration could not be loaded; using environment configuration',
        );
      }
      syncWorker = new SyncWorker(syncService, syncEnvironment);
      syncWorker.start();
      registerSyncIpcHandlers(syncService, syncWorker, syncConfigStore);
      registerAppIpcHandlers(() => {
        const overview = syncService.getOverview(syncWorker?.configured ?? false);
        if (overview.status === 'connected') return 'connected';
        if (
          overview.status === 'offline' ||
          overview.status === 'syncing' ||
          overview.status === 'idle'
        )
          return 'offline';
        if (overview.status === 'error') return 'error';
        return 'not-configured';
      });
      registerAuthIpcHandlers();
      registerInventoryIpcHandlers();
      registerCheckoutIpcHandlers();
      registerSalesIpcHandlers();
      registerSettingsIpcHandlers();
      registerBackupIpcHandlers();
      registerReportsIpcHandlers();
      registerPurchasingIpcHandlers();
      registerCashSessionIpcHandlers();
      registerAccountingIpcHandlers();
    }
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Application startup failed');
    app.quit();
  });

app.on('before-quit', () => {
  syncWorker?.stop();
  closeLocalDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
