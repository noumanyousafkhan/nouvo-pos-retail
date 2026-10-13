// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { CheckoutService } from '../../../src/main/checkout/checkout-service';
import { StockService } from '../../../src/main/inventory/stock-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  const productId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name, currency_code) VALUES (?, ?, ?)')
    .run(storeId, 'Test Store', 'PKR');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, base_unit, purchase_cost_minor, selling_price_minor, tax_rate_basis_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'TEST-1', 'Test Item', 'piece', 500, 1000, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    unitCostMinor: 500,
    reason: 'Opening stock receipt',
  });
  return {
    database,
    storeId,
    counterId,
    productId,
    service: new CheckoutService(database.connection, storeId, counterId),
  };
}
function request(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    items: [{ productId, quantityMilli: 1500 }],
    paymentLines: [{ paymentMethod: 'cash', amountMinor: 1650, amountTenderedMinor: 2000 }],
    ...overrides,
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('checkout service', () => {
  it('persists sale, snapshots, payment, stock movement, audit and outbox atomically', () => {
    const { database, productId, counterId, service } = setup();
    const sale = service.complete(request(productId));
    expect(sale.receiptNumber).toBe('000001');
    expect(sale.subtotalMinor).toBe(1500);
    expect(sale.taxMinor).toBe(150);
    expect(sale.totalMinor).toBe(1650);
    expect(sale.changeDueMinor).toBe(350);
    expect(sale.lines[0]).toMatchObject({
      productName: 'Test Item',
      quantityMilli: 1500,
      unitPriceMinor: 1000,
      lineTotalMinor: 1650,
    });
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM receipt_snapshots WHERE sale_id = ?')
        .get(sale.id),
    ).toEqual({ count: 1 });
    expect(
      database.connection
        .prepare("SELECT action FROM audit_events WHERE entity_type = 'sale' AND entity_id = ?")
        .get(sale.id),
    ).toEqual({ action: 'sale.completed' });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'sale.completed' AND aggregate_id = ?",
        )
        .get(sale.id),
    ).toEqual({ count: 1 });
    expect(
      database.connection
        .prepare(
          'SELECT COALESCE(SUM(quantity_delta_milli), 0) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 3500 });
  });

  it('supports split payments and computes cash change', () => {
    const { productId, service } = setup();
    const sale = service.complete(
      request(productId, {
        paymentLines: [
          { paymentMethod: 'cash', amountMinor: 500, amountTenderedMinor: 700 },
          { paymentMethod: 'card', amountMinor: 1150, reference: 'AUTH-42' },
        ],
      }),
    );
    expect(sale.totalMinor).toBe(1650);
    expect(sale.changeDueMinor).toBe(200);
    expect(sale.payments).toHaveLength(2);
  });

  it('is idempotent for a retry with the same key and payload', () => {
    const { database, productId, service } = setup();
    const payload = request(productId);
    const first = service.complete(payload);
    const retry = service.complete(payload);
    expect(retry.id).toBe(first.id);
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM sales').get()).toEqual({
      count: 1,
    });
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'sale.completed'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it('rejects reuse of an idempotency key with a different payload', () => {
    const { productId, service } = setup();
    const payload = request(productId);
    service.complete(payload);
    expect(() =>
      service.complete({ ...payload, items: [{ productId, quantityMilli: 1000 }] }),
    ).toThrow(/already used for a different sale/i);
  });

  it('rejects insufficient stock and mismatched payments without creating a sale', () => {
    const { database, productId, service } = setup();
    expect(() =>
      service.complete(request(productId, { items: [{ productId, quantityMilli: 6000 }] })),
    ).toThrow(/insufficient stock/i);
    expect(() =>
      service.complete(
        request(productId, { paymentLines: [{ paymentMethod: 'cash', amountMinor: 1000 }] }),
      ),
    ).toThrow(/payment amounts must equal/i);
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM sales').get()).toEqual({
      count: 0,
    });
  });
});
