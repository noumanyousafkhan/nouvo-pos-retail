// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { SyncService } from '../../../src/main/sync/sync-service';

const databases: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  databases.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Sync Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  const service = new SyncService(database.connection, storeId, counterId);
  return { database, service };
}
function insertEvent(database: ReturnType<typeof openLocalDatabase>) {
  const id = randomUUID();
  database.connection
    .prepare(
      'INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, 'sale.completed', 'sale', randomUUID(), JSON.stringify({ totalMinor: 1200 }));
  return id;
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('sync outbox service', () => {
  it('reports unconfigured mode and preserves local outbox events', () => {
    const { database, service } = setup();
    insertEvent(database);
    service.initialize(false);
    const overview = service.getOverview(false);
    expect(overview.status).toBe('not_configured');
    expect(overview.configured).toBe(false);
    expect(overview.pendingCount).toBe(1);
  });

  it('claims events once and marks them acknowledged after remote acceptance', () => {
    const { database, service } = setup();
    const id = insertEvent(database);
    service.initialize(true);
    const batch = service.claimBatch(50);
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({
      id,
      eventType: 'sale.completed',
      attempts: 1,
      payload: { totalMinor: 1200 },
    });
    expect(service.claimBatch(50)).toHaveLength(0);
    service.acknowledge([id]);
    expect(service.getOverview(true)).toMatchObject({
      inFlightCount: 0,
      pendingCount: 0,
      acknowledgedCount: 1,
    });
  });

  it('marks permanent rejections failed and permits an explicit retry', () => {
    const { database, service } = setup();
    const id = insertEvent(database);
    service.initialize(true);
    expect(service.claimBatch()).toHaveLength(1);
    service.reject(id, 'Invalid event payload', false);
    expect(service.getOverview(true).failedCount).toBe(1);
    expect(service.retryFailed()).toBe(1);
    expect(service.getOverview(true)).toMatchObject({ failedCount: 0, pendingCount: 1 });
  });

  it('recovers events left in flight by an interrupted process', () => {
    const { database, service } = setup();
    const id = insertEvent(database);
    service.initialize(true);
    service.claimBatch();
    expect(service.getOverview(true).inFlightCount).toBe(1);
    service.initialize(true);
    expect(service.getOverview(true)).toMatchObject({ inFlightCount: 0, pendingCount: 1 });
    expect(
      database.connection.prepare('SELECT status FROM outbox_events WHERE id = ?').get(id),
    ).toEqual({ status: 'pending' });
  });
});
