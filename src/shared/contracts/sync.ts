import { z } from 'zod';
import { ProductSchema } from './products';
import { BusinessSettingsSchema } from './settings';

export const SyncEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  schemaVersion: z.number().int().positive(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export const SyncRejectedEventSchema = z.object({
  eventId: z.string().uuid(),
  message: z.string().min(1).max(1000),
  retryable: z.boolean(),
});
export const SyncBatchResponseSchema = z.object({
  acceptedEventIds: z.array(z.string().uuid()),
  rejectedEvents: z.array(SyncRejectedEventSchema),
});
export const SyncEventSummarySchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  status: z.enum(['pending', 'in_flight', 'acknowledged', 'failed']),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export const SyncOverviewSchema = z.object({
  configured: z.boolean(),
  status: z.enum(['not_configured', 'idle', 'syncing', 'connected', 'offline', 'error']),
  pendingCount: z.number().int().nonnegative(),
  inFlightCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  acknowledgedCount: z.number().int().nonnegative(),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  events: z.array(SyncEventSummarySchema),
});
export const SyncSnapshotSchema = z.object({
  storeId: z.string().uuid(),
  counterId: z.string().uuid(),
  products: z.array(ProductSchema),
  allocations: z.array(
    z.object({ productId: z.string().uuid(), quantityMilli: z.number().int().nonnegative() }),
  ),
  settings: BusinessSettingsSchema.nullable(),
  generatedAt: z.string().datetime({ offset: true }),
});
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>;
export type SyncEvent = z.infer<typeof SyncEventSchema>;
export type SyncOverview = z.infer<typeof SyncOverviewSchema>;
export const SyncConfigurationSchema = z.object({
  url: z.string(),
  configured: z.boolean(),
  secureStorageAvailable: z.boolean(),
  storeId: z.string().uuid(),
  counterId: z.string().uuid(),
});
export type SyncConfiguration = z.infer<typeof SyncConfigurationSchema>;
export const SaveSyncConfigurationSchema = z
  .object({
    url: z.string().trim().min(1).max(500),
    token: z.string().max(500).default(''),
  })
  .strict();
export type SaveSyncConfiguration = z.infer<typeof SaveSyncConfigurationSchema>;
export interface SyncApi {
  getSyncOverview(): Promise<SyncOverview>;
  getSyncConfiguration(): Promise<SyncConfiguration>;
  saveSyncConfiguration(input: SaveSyncConfiguration): Promise<SyncConfiguration>;
  retryFailedSyncEvents(): Promise<number>;
  runSyncNow(): Promise<SyncOverview>;
}
