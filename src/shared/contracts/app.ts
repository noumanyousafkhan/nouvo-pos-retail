import { z } from 'zod';
import type { ProductApi } from './products';
import type { AuthApi } from './auth';
import type { ReportsApi } from './reports';
import type { PurchasingApi } from './purchasing';
import type { CashSessionsApi } from './cash-sessions';
import type { AccountingApi } from './accounting';
import type { SyncApi } from './sync';

export const EmptyPayloadSchema = z.object({}).strict();
export const AppInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.enum(['win32', 'linux', 'darwin', 'other']),
  isPackaged: z.boolean(),
});
export const RuntimeStatusSchema = z.object({
  application: z.enum(['starting', 'ready']),
  localDatabase: z.enum(['not-configured', 'ready', 'error']),
  synchronization: z.enum(['not-configured', 'connected', 'offline', 'error']),
});
export const ThermalReceiptSchema = z.object({
  lines: z.array(z.string().max(200)).min(1).max(200),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
});
export type ThermalReceiptInput = z.infer<typeof ThermalReceiptSchema>;
export type ThermalReceiptResult = { success: boolean; message: string };
export type AppInfo = z.infer<typeof AppInfoSchema>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export interface NouvoApi
  extends ProductApi, AuthApi, ReportsApi, PurchasingApi, CashSessionsApi, AccountingApi, SyncApi {
  getAppInfo(): Promise<AppInfo>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  printThermalReceipt(input: ThermalReceiptInput): Promise<ThermalReceiptResult>;
}
