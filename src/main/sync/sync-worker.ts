import { SyncBatchResponseSchema, SyncSnapshotSchema } from '../../shared/contracts/sync';
import { normalizeSyncUrl } from './sync-config-store';
import { SyncService } from './sync-service';

export class SyncWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private baseUrl: string | null = null;
  private token: string | null = null;

  constructor(
    private readonly service: SyncService,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.setCredentials(env.NOUVO_SYNC_URL ?? '', env.NOUVO_SYNC_TOKEN ?? '');
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  getPublicConfiguration(): { url: string; configured: boolean } {
    return { url: this.baseUrl ?? '', configured: this.configured };
  }

  configure(url: string, token: string): void {
    const normalizedUrl = normalizeSyncUrl(url);
    const normalizedToken = token.trim();
    if (normalizedToken.length < 32)
      throw new Error('Counter token must contain at least 32 characters.');
    this.stop();
    this.baseUrl = normalizedUrl;
    this.token = normalizedToken;
    this.service.initialize(true);
    this.startTimer();
  }

  private setCredentials(urlInput: string, tokenInput: string): void {
    try {
      this.baseUrl = normalizeSyncUrl(urlInput);
    } catch {
      this.baseUrl = null;
    }
    this.token = tokenInput.trim().length >= 32 ? tokenInput.trim() : null;
  }

  private startTimer(): void {
    if (!this.configured || this.timer) return;
    void this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, 30_000);
  }

  start(): void {
    this.service.initialize(this.configured);
    this.startTimer();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pullSnapshot(): Promise<void> {
    if (!this.baseUrl || !this.token) return;
    const overview = this.service.getOverview(true);
    if (overview.pendingCount > 0 || overview.inFlightCount > 0 || overview.failedCount > 0) return;
    const response = await fetch(new URL('/api/v1/sync/snapshot', this.baseUrl), {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}`, 'x-counter-id': this.service.counterId },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Sync snapshot request returned HTTP ${response.status}.`);
    const parsed = SyncSnapshotSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error('Sync snapshot does not match the expected product/allocation contract.');
    this.service.applySnapshot(parsed.data);
    this.service.setStatus('connected', null, true, true);
  }

  async syncOnce(): Promise<void> {
    if (!this.configured || this.running || !this.baseUrl || !this.token) return;
    this.running = true;
    this.service.setStatus('syncing', null, true);
    let batch: ReturnType<SyncService['claimBatch']> = [];
    try {
      batch = this.service.claimBatch(50);
      if (!batch.length) {
        await this.pullSnapshot();
        const current = this.service.getOverview(true);
        if (current.failedCount > 0)
          this.service.setStatus('error', current.lastError ?? 'Some sync events need review.');
        else if (current.pendingCount > 0)
          this.service.setStatus(
            'offline',
            current.lastError ?? 'Sync retry is waiting for its backoff window.',
          );
        else this.service.setStatus(current.lastSuccessAt ? 'connected' : 'idle');
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
      await this.pullSnapshot();
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
