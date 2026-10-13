// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { StockService } from '../../../src/main/inventory/stock-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  const productId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare('INSERT INTO products (id, store_id, name, selling_price_minor) VALUES (?, ?, ?, ?)')
    .run(productId, storeId, 'Test Product', 1000);
  return {
    database,
    storeId,
    counterId,
    productId,
    service: new StockService(database.connection, storeId, counterId),
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('stock ledger service', () => {
  it('records receipts atomically with audit and sync-outbox events', () => {
    const { database, productId, service } = setup();
    const result = service.record({
      productId,
      movementType: 'receipt',
      quantityMilli: 2500,
      unitCostMinor: 700,
      reason: 'Supplier delivery GRN-1',
    });
    expect(result).toEqual({ productId, quantityMilli: 2500, movementCount: 1 });
    expect(
      database.connection
        .prepare("SELECT action FROM audit_events WHERE entity_type = 'stock'")
        .get(),
    ).toEqual({ action: 'stock.receipt' });
    expect(
      database.connection
        .prepare("SELECT event_type FROM outbox_events WHERE aggregate_type = 'stock_movement'")
        .get(),
    ).toEqual({ event_type: 'stock.movement.recorded' });
  });

  it('applies adjustments and write-offs without allowing negative stock', () => {
    const { productId, service } = setup();
    service.record({
      productId,
      movementType: 'receipt',
      quantityMilli: 3000,
      unitCostMinor: 500,
      reason: 'Opening receipt',
    });
    expect(
      service.record({
        productId,
        movementType: 'adjustment',
        quantityMilli: -500,
        reason: 'Physical count correction',
      }).quantityMilli,
    ).toBe(2500);
    expect(
      service.record({
        productId,
        movementType: 'write_off',
        quantityMilli: 500,
        reason: 'Damaged goods',
      }).quantityMilli,
    ).toBe(2000);
    expect(() =>
      service.record({
        productId,
        movementType: 'write_off',
        quantityMilli: 3000,
        reason: 'Overdraw attempt',
      }),
    ).toThrow(/stock negative/i);
  });

  it('rejects zero quantities and movements against archived products', () => {
    const { database, productId, storeId, service } = setup();
    expect(() =>
      service.record({
        productId,
        movementType: 'receipt',
        quantityMilli: 0,
        reason: 'Invalid zero',
      }),
    ).toThrow();
    database.connection
      .prepare('UPDATE products SET is_active = 0 WHERE id = ? AND store_id = ?')
      .run(productId, storeId);
    expect(() =>
      service.record({
        productId,
        movementType: 'receipt',
        quantityMilli: 1000,
        reason: 'Archived product',
      }),
    ).toThrow(/active product not found/i);
  });
});
