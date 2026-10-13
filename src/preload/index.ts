import { contextBridge, ipcRenderer } from 'electron';
import type { NouvoApi } from '../shared/contracts/app';
import type { ProductInput, ProductListQuery } from '../shared/contracts/products';
import type { StockMovementInput } from '../shared/contracts/stock';
import type { CheckoutInput } from '../shared/contracts/checkout';
import type { SalesListQuery } from '../shared/contracts/sales';
import type { SaveBusinessSettings } from '../shared/contracts/settings';
import type { BackupResult, RestoreResult } from '../shared/contracts/backup';
import type { ReportQuery } from '../shared/contracts/reports';
import type { ReturnSaleInput, VoidSaleInput } from '../shared/contracts/returns';
import type {
  OpenCashierSessionInput,
  CashMovementInput,
  CloseCashierSessionInput,
} from '../shared/contracts/cash-sessions';
import type {
  PurchaseOrderInput,
  PurchaseReturnInput,
  SupplierPaymentInput,
  ReceivePurchaseOrderInput,
  SupplierInput,
} from '../shared/contracts/purchasing';
import type {
  AuthCredentials,
  CreateUserInput,
  ResetUserPasswordInput,
  SetupOwnerInput,
} from '../shared/contracts/auth';

const api: NouvoApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('app:get-info', {}),
  getRuntimeStatus: () => ipcRenderer.invoke('app:get-runtime-status', {}),
  getSalesReport: (query?: ReportQuery) =>
    ipcRenderer.invoke('reports:get-sales-report', query ?? {}),
  listSuppliers: () => ipcRenderer.invoke('purchasing:list-suppliers'),
  saveSupplier: (input: SupplierInput) => ipcRenderer.invoke('purchasing:save-supplier', input),
  listPurchaseOrders: () => ipcRenderer.invoke('purchasing:list-orders'),
  createPurchaseOrder: (input: PurchaseOrderInput) =>
    ipcRenderer.invoke('purchasing:create-order', input),
  receivePurchaseOrder: (input: ReceivePurchaseOrderInput) =>
    ipcRenderer.invoke('purchasing:receive-order', input),
  cancelPurchaseOrder: (id: string) => ipcRenderer.invoke('purchasing:cancel-order', id),
  listReturnablePurchaseOrderLines: (id: string) =>
    ipcRenderer.invoke('purchasing:list-returnable-lines', id),
  createPurchaseReturn: (input: PurchaseReturnInput) =>
    ipcRenderer.invoke('purchasing:create-return', input),
  listPurchaseReturns: () => ipcRenderer.invoke('purchasing:list-returns'),
  listSupplierBalances: () => ipcRenderer.invoke('purchasing:list-balances'),
  createSupplierPayment: (input: SupplierPaymentInput) =>
    ipcRenderer.invoke('purchasing:create-payment', input),
  listSupplierPayments: () => ipcRenderer.invoke('purchasing:list-payments'),
  getActiveCashierSession: () => ipcRenderer.invoke('cash-session:get-active'),
  listCashierSessions: () => ipcRenderer.invoke('cash-session:list-history'),
  listAccountingAccounts: () => ipcRenderer.invoke('accounting:list-accounts'),
  listAccountingJournals: () => ipcRenderer.invoke('accounting:list-journals'),
  getAccountingTrialBalance: (asOfDate: string) =>
    ipcRenderer.invoke('accounting:get-trial-balance', asOfDate),
  getAccountingIncomeStatement: (input: { startDate: string; endDate: string }) =>
    ipcRenderer.invoke('accounting:get-income-statement', input),
  postManualAccountingJournal: (input: Parameters<NouvoApi['postManualAccountingJournal']>[0]) =>
    ipcRenderer.invoke('accounting:post-manual-journal', input),
  reverseManualAccountingJournal: (
    input: Parameters<NouvoApi['reverseManualAccountingJournal']>[0],
  ) => ipcRenderer.invoke('accounting:reverse-manual-journal', input),
  getSyncOverview: () => ipcRenderer.invoke('sync:get-overview'),
  getSyncConfiguration: () => ipcRenderer.invoke('sync:get-configuration'),
  saveSyncConfiguration: (input: unknown) => ipcRenderer.invoke('sync:save-configuration', input),
  retryFailedSyncEvents: () => ipcRenderer.invoke('sync:retry-failed'),
  runSyncNow: () => ipcRenderer.invoke('sync:run-now'),
  openCashierSession: (input: OpenCashierSessionInput) =>
    ipcRenderer.invoke('cash-session:open', input),
  recordCashMovement: (input: CashMovementInput) =>
    ipcRenderer.invoke('cash-session:record-movement', input),
  closeCashierSession: (input: CloseCashierSessionInput) =>
    ipcRenderer.invoke('cash-session:close', input),
  listProducts: (query?: Partial<ProductListQuery>) =>
    ipcRenderer.invoke('inventory:list-products', query ?? {}),
  saveProduct: (input: ProductInput) => ipcRenderer.invoke('inventory:save-product', input),
  archiveProduct: (id: string, reason?: string) =>
    ipcRenderer.invoke('inventory:archive-product', { id, reason }),
  recordStockMovement: (input: StockMovementInput) =>
    ipcRenderer.invoke('inventory:record-stock-movement', input),
  completeSale: (input: CheckoutInput) => ipcRenderer.invoke('checkout:complete-sale', input),
  listSales: (query?: Partial<SalesListQuery>) => ipcRenderer.invoke('sales:list', query ?? {}),
  getSale: (id: string) => ipcRenderer.invoke('sales:get', id),
  getReturnableItems: (saleId: string) => ipcRenderer.invoke('sales:returnable-items', saleId),
  returnSale: (input: ReturnSaleInput) => ipcRenderer.invoke('sales:return', input),
  voidSale: (input: VoidSaleInput) => ipcRenderer.invoke('sales:void', input),
  getBusinessSettings: () => ipcRenderer.invoke('settings:get-business'),
  saveBusinessSettings: (input: SaveBusinessSettings) =>
    ipcRenderer.invoke('settings:save-business', input),
  createBackup: (): Promise<BackupResult | null> => ipcRenderer.invoke('backup:create'),
  restoreBackup: (): Promise<RestoreResult | null> => ipcRenderer.invoke('backup:restore'),
  getAuthState: () => ipcRenderer.invoke('auth:get-state'),
  setupOwner: (input: SetupOwnerInput) => ipcRenderer.invoke('auth:setup-owner', input),
  login: (input: AuthCredentials) => ipcRenderer.invoke('auth:login', input),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listUsers: () => ipcRenderer.invoke('auth:list-users'),
  createUser: (input: CreateUserInput) => ipcRenderer.invoke('auth:create-user', input),
  disableUser: (id: string) => ipcRenderer.invoke('auth:disable-user', id),
  resetUserPassword: (input: ResetUserPasswordInput) =>
    ipcRenderer.invoke('auth:reset-user-password', input),
});

contextBridge.exposeInMainWorld('nouvo', api);
