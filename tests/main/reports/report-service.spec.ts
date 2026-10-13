// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { CheckoutService } from '../../../src/main/checkout/checkout-service';
import { StockService } from '../../../src/main/inventory/stock-service';
import { ReportService } from '../../../src/main/reports/report-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  const productId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Shop');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, purchase_cost_minor, selling_price_minor) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'RICE-1', 'Rice 1kg', 500, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    unitCostMinor: 500,
    reason: 'Opening receipt',
  });
  return {
    database,
    storeId,
    counterId,
    productId,
    reports: new ReportService(database.connection, storeId, counterId),
  };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('report service', () => {
  it('summarizes completed sales, payment methods, top products and counter stock value', () => {
    const { database, storeId, counterId, productId, reports } = setup();
    const sale = new CheckoutService(database.connection, storeId, counterId).complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2000, amountTenderedMinor: 2500 }],
    });
    const report = reports.sales({
      fromDate: sale.completedAt.slice(0, 10),
      toDate: sale.completedAt.slice(0, 10),
    });
    expect(report).toMatchObject({
      saleCount: 1,
      subtotalMinor: 2000,
      totalMinor: 2000,
      inventory: {
        activeProducts: 1,
        stockedProducts: 1,
        quantityMilli: 3000,
        estimatedCostValueMinor: 1500,
      },
    });
    expect(report.byPaymentMethod).toEqual([
      { method: 'cash', amountMinor: 2000, paymentCount: 1 },
    ]);
    expect(report.topProducts).toEqual([
      { productName: 'Rice 1kg', quantityMilli: 2000, totalMinor: 2000 },
    ]);
    expect(report.daily).toHaveLength(1);
  });

  it('validates date range order and returns zero totals for empty periods', () => {
    const { reports } = setup();
    expect(() => reports.sales({ fromDate: '2026-10-20', toDate: '2026-10-01' })).toThrow(
      /start date/i,
    );
    expect(reports.sales({ fromDate: '2020-01-01', toDate: '2020-01-02' })).toMatchObject({
      saleCount: 0,
      totalMinor: 0,
      daily: [],
      topProducts: [],
      byPaymentMethod: [],
    });
  });
});
