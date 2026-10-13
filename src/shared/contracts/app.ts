import { z } from 'zod';
import type { ProductApi } from './products';
import type { AuthApi } from './auth';
import type { ReportsApi } from './reports';
import type { PurchasingApi } from './purchasing';
import type { CashSessionsApi } from './cash-sessions';
import type { AccountingApi } from './accounting';

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

export type AppInfo = z.infer<typeof AppInfoSchema>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export interface NouvoApi
  extends ProductApi, AuthApi, ReportsApi, PurchasingApi, CashSessionsApi, AccountingApi {
  getAppInfo(): Promise<AppInfo>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
}
