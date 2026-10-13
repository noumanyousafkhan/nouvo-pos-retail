// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { SyncService } from '../../../src/main/sync/sync-service';
import { SyncWorker } from '../../../src/main/sync/sync-worker';

const databases: ReturnType<typeof openLocalDatabase>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const database of databases.splice(0)) database.close();
});

describe('sync worker HTTP delivery', () => {
  it('sends an authenticated event batch and persists server acknowledgement', async () => {
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
    const eventId = randomUUID();
    const snapshotProductId = randomUUID();
    const snapshotTime = new Date().toISOString();
    database.connection
      .prepare(
        'INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(eventId, 'sale.completed', 'sale', randomUUID(), JSON.stringify({ totalMinor: 2500 }));
    const server = createServer(async (request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.method === 'GET' && request.url === '/api/v1/sync/snapshot') {
        expect(request.headers.authorization).toBe(
          'Bearer test-counter-token-0123456789-abcdefghij',
        );
        expect(request.headers['x-counter-id']).toBe(counterId);
        response.end(
          JSON.stringify({
            storeId,
            counterId,
            settings: null,
            products: [
              {
                id: snapshotProductId,
                name: 'Synchronized Product',
                description: '',
                categoryName: 'Grocery',
                sku: 'SYNC-1',
                barcodes: ['1234567890'],
                baseUnit: 'piece',
                purchaseCostMinor: 100,
                sellingPriceMinor: 200,
                taxRateBasisPoints: 0,
                isActive: true,
                stockOnHandMilli: 0,
                createdAt: snapshotTime,
                updatedAt: snapshotTime,
              },
            ],
            allocations: [{ productId: snapshotProductId, quantityMilli: 3000 }],
            generatedAt: snapshotTime,
          }),
        );
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += chunk.toString();
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/api/v1/sync/events');
      expect(request.headers.authorization).toBe('Bearer test-counter-token-0123456789-abcdefghij');
      const body = JSON.parse(raw) as {
        schemaVersion: number;
        storeId: string;
        counterId: string;
        events: Array<{ id: string; payload: { totalMinor: number } }>;
      };
      expect(body.schemaVersion).toBe(1);
      expect(body.storeId).toBe(storeId);
      expect(body.counterId).toBe(counterId);
      expect(body.events[0]).toMatchObject({ id: eventId, payload: { totalMinor: 2500 } });
      response.end(JSON.stringify({ acceptedEventIds: [eventId], rejectedEvents: [] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Test server did not bind to a TCP port.');
    const service = new SyncService(database.connection, storeId, counterId);
    const worker = new SyncWorker(service, {
      NOUVO_SYNC_URL: 'http://127.0.0.1:' + address.port,
      NOUVO_SYNC_TOKEN: 'test-counter-token-0123456789-abcdefghij',
    });
    service.initialize(worker.configured);
    expect(worker.configured).toBe(true);
    await worker.syncOnce();
    expect(service.getOverview(true)).toMatchObject({
      status: 'connected',
      pendingCount: 0,
      inFlightCount: 0,
      acknowledgedCount: 1,
    });
    expect(
      database.connection.prepare('SELECT name FROM products WHERE id=?').get(snapshotProductId),
    ).toEqual({ name: 'Synchronized Product' });
    expect(
      database.connection
        .prepare(
          'SELECT remaining_quantity_milli AS quantity FROM counter_stock_allocations WHERE counter_id=? AND product_id=?',
        )
        .get(counterId, snapshotProductId),
    ).toEqual({ quantity: 3000 });
    expect(
      database.connection
        .prepare(
          'SELECT COALESCE(SUM(quantity_delta_milli),0) AS quantity FROM stock_movements WHERE counter_id=? AND product_id=?',
        )
        .get(counterId, snapshotProductId),
    ).toEqual({ quantity: 3000 });
    worker.stop();
  });
});
