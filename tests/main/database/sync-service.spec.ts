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

  it('applies a validated catalogue and allocation snapshot atomically', () => {
    const { database, service } = setup();
    service.initialize(true);
    const productId = randomUUID();
    const timestamp = new Date().toISOString();
    service.applySnapshot({
      storeId: service.storeId,
      counterId: service.counterId,
      generatedAt: timestamp,
      settings: {
        storeId: service.storeId,
        name: 'Updated Sync Store',
        currencyCode: 'PKR',
        timezone: 'Asia/Karachi',
        taxBehavior: 'inclusive',
        address: 'Market Road',
        phone: '03001234567',
        businessRegistrationNumber: 'REG-1',
        receiptFooter: 'Thank you',
        receiptPaperWidthMm: 58,
      },
      products: [
        {
          id: productId,
          name: 'Rice 1kg',
          description: 'Basmati rice',
          categoryName: 'Grocery',
          sku: 'RICE-1',
          barcodes: ['1234567890123'],
          baseUnit: 'piece',
          purchaseCostMinor: 10000,
          sellingPriceMinor: 15000,
          taxRateBasisPoints: 0,
          isActive: true,
          stockOnHandMilli: 1000,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      allocations: [{ productId, quantityMilli: 2500 }],
    });
    expect(
      database.connection
        .prepare('SELECT name, selling_price_minor AS price FROM products WHERE id=?')
        .get(productId),
    ).toEqual({ name: 'Rice 1kg', price: 15000 });
    expect(
      database.connection
        .prepare('SELECT barcode FROM product_barcodes WHERE product_id=?')
        .get(productId),
    ).toEqual({ barcode: '1234567890123' });
    expect(
      database.connection
        .prepare(
          'SELECT remaining_quantity_milli AS quantity FROM counter_stock_allocations WHERE counter_id=? AND product_id=?',
        )
        .get(service.counterId, productId),
    ).toEqual({ quantity: 2500 });
    expect(
      database.connection
        .prepare('SELECT allocation_enforced AS enforced FROM sync_state WHERE counter_id=?')
        .get(service.counterId),
    ).toEqual({ enforced: 1 });
    expect(
      database.connection
        .prepare(
          'SELECT name, currency_code AS currencyCode, tax_behavior AS taxBehavior, receipt_paper_width_mm AS paperWidth FROM stores WHERE id=?',
        )
        .get(service.storeId),
    ).toEqual({
      name: 'Updated Sync Store',
      currencyCode: 'PKR',
      taxBehavior: 'inclusive',
      paperWidth: 58,
    });
    expect(
      database.connection
        .prepare(
          'SELECT COALESCE(SUM(quantity_delta_milli), 0) AS quantity FROM stock_movements WHERE counter_id=? AND product_id=?',
        )
        .get(service.counterId, productId),
    ).toEqual({ quantity: 2500 });
  });

  it('does not replace allocation snapshots while local events are unresolved', () => {
    const { database, service } = setup();
    service.initialize(true);
    insertEvent(database);
    expect(() =>
      service.applySnapshot({
        storeId: service.storeId,
        counterId: service.counterId,
        generatedAt: new Date().toISOString(),
        settings: null,
        products: [],
        allocations: [],
      }),
    ).toThrow(/pending or failed/i);
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
