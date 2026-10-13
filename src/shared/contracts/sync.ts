import { z } from 'zod';

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
export type SyncEvent = z.infer<typeof SyncEventSchema>;
export type SyncOverview = z.infer<typeof SyncOverviewSchema>;
export interface SyncApi {
  getSyncOverview(): Promise<SyncOverview>;
  retryFailedSyncEvents(): Promise<number>;
  runSyncNow(): Promise<SyncOverview>;
}
