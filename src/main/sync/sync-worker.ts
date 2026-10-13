import { SyncBatchResponseSchema } from '../../shared/contracts/sync';
import { SyncService } from './sync-service';

export class SyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  readonly configured: boolean;
  private readonly baseUrl: string | null;
  private readonly token: string | null;

  constructor(
    private readonly service: SyncService,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const rawUrl = env.NOUVO_SYNC_URL?.trim() ?? '';
    this.token = env.NOUVO_SYNC_TOKEN?.trim() || null;
    try {
      const url = new URL(rawUrl);
      const secure =
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
      this.baseUrl = secure ? url.toString() : null;
    } catch {
      this.baseUrl = null;
    }
    this.configured = Boolean(this.baseUrl && this.token);
  }

  start(): void {
    this.service.initialize(this.configured);
    if (!this.configured || this.timer) return;
    void this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async syncOnce(): Promise<void> {
    if (!this.configured || this.running || !this.baseUrl || !this.token) return;
    this.running = true;
    this.service.setStatus('syncing', null, true);
    let batch: ReturnType<SyncService['claimBatch']> = [];
    try {
      batch = this.service.claimBatch(50);
      if (!batch.length) {
        const current = this.service.getOverview(true);
        this.service.setStatus(current.lastSuccessAt ? 'connected' : 'idle');
        return;
      }
      const endpoint = new URL('/api/v1/sync/events', this.baseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          schemaVersion: 1,
          storeId: this.service.storeId,
          counterId: this.service.counterId,
          events: batch.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            schemaVersion: event.schemaVersion,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            createdAt: event.createdAt,
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const message = `Sync server returned HTTP ${response.status}.`;
        this.service.failTransient(
          batch.map((event) => event.id),
          message,
          retryable,
        );
        this.service.setStatus(retryable ? 'offline' : 'error', message, true);
        return;
      }
      const parsed = SyncBatchResponseSchema.safeParse(await response.json());
      if (!parsed.success)
        throw new Error(
          'Sync server response did not match the expected acknowledgement contract.',
        );
      const batchIds = new Set(batch.map((event) => event.id));
      const accepted = [...new Set(parsed.data.acceptedEventIds)].filter((id) => batchIds.has(id));
      const rejected = new Map(
        parsed.data.rejectedEvents
          .filter((event) => batchIds.has(event.eventId))
          .map((event) => [event.eventId, event]),
      );
      this.service.acknowledge(accepted);
      for (const [eventId, rejection] of rejected)
        this.service.reject(eventId, rejection.message, rejection.retryable);
      const accountedFor = new Set([...accepted, ...rejected.keys()]);
      const unacknowledged = batch.map((event) => event.id).filter((id) => !accountedFor.has(id));
      for (const id of unacknowledged)
        this.service.reject(id, 'Sync server did not acknowledge this event.', true);
      const permanentRejection = [...rejected.values()].some((event) => !event.retryable);
      this.service.setStatus(
        permanentRejection ? 'error' : 'connected',
        permanentRejection ? 'Some events were rejected and need review.' : null,
        true,
        !permanentRejection,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync failure.';
      if (batch.length)
        this.service.failTransient(
          batch.map((event) => event.id),
          message,
          true,
        );
      this.service.setStatus('offline', message, true);
    } finally {
      this.running = false;
    }
  }
}
