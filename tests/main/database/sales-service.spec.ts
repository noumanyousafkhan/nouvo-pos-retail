// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckoutService } from '../../../src/main/checkout/checkout-service';
import { SalesService } from '../../../src/main/checkout/sales-service';
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
    .prepare('INSERT INTO stores (id, name, currency_code) VALUES (?, ?, ?)')
    .run(storeId, 'History Test Store', 'PKR');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, name, selling_price_minor, tax_rate_basis_points) VALUES (?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'History Product', 1000, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    reason: 'Initial delivery',
  });
  return {
    database,
    storeId,
    counterId,
    productId,
    checkout: new CheckoutService(database.connection, storeId, counterId),
    sales: new SalesService(database.connection, storeId, counterId),
  };
}
function makeSale(productId: string) {
  return {
    idempotencyKey: randomUUID(),
    items: [{ productId, quantityMilli: 1000 }],
    paymentLines: [{ paymentMethod: 'cash', amountMinor: 1100 }],
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('sales history service', () => {
  it('lists receipts, totals, line counts and payment methods with search filters', () => {
    const { checkout, productId, sales } = setup();
    checkout.complete(makeSale(productId));
    checkout.complete(makeSale(productId));
    const all = sales.list();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      receiptNumber: '000002',
      businessName: 'History Test Store',
      totalMinor: 1100,
      itemCount: 1,
      paymentMethods: ['cash'],
    });
    expect(sales.list({ search: '000001' })).toHaveLength(1);
    expect(sales.list({ search: 'History Product' })).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(sales.list({ fromDate: today, toDate: today })).toHaveLength(2);
  });

  it('returns a saved receipt and prevents cross-counter receipt access', () => {
    const { checkout, database, storeId, counterId, productId, sales } = setup();
    const sale = checkout.complete(makeSale(productId));
    expect(sales.getById(sale.id)).toMatchObject({
      id: sale.id,
      receiptNumber: '000001',
      lines: [{ productName: 'History Product' }],
    });
    const otherCounter = randomUUID();
    database.connection
      .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
      .run(otherCounter, storeId, 'Counter 2');
    expect(() =>
      new SalesService(database.connection, storeId, otherCounter).getById(sale.id),
    ).toThrow(/not found on this counter/i);
    expect(counterId).not.toBe(otherCounter);
  });
});
