// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { StockService } from '../../../src/main/inventory/stock-service';
import { PurchasingService } from '../../../src/main/purchasing/purchasing-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      "INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, 'owner.test', 'Owner Test', 'test-hash', 'owner')",
    )
    .run(actorId, storeId);
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, base_unit, purchase_cost_minor, selling_price_minor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'RICE-1', 'Rice 1kg', 'piece', 500, 1000);
  const service = new PurchasingService(database.connection, storeId, counterId, actorId);
  return { database, storeId, counterId, actorId, productId, service };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('purchasing service', () => {
  it('creates a supplier and draft order without changing stock until receiving', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods', phone: '03001234567' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      notes: 'Deliver in the morning',
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    expect(order).toMatchObject({
      supplierName: 'Wholesale Foods',
      status: 'draft',
      lineCount: 1,
      subtotalMinor: 1600,
    });
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    expect(service.listPurchaseOrders()).toHaveLength(1);
  });

  it('receives goods atomically, updates stock and moving weighted-average cost, and prevents double receiving', () => {
    const { database, storeId, counterId, productId, service } = setup();
    new StockService(database.connection, storeId, counterId).record({
      productId,
      movementType: 'receipt',
      quantityMilli: 5000,
      unitCostMinor: 500,
      reason: 'Opening stock',
    });
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    const received = service.receivePurchaseOrder({
      id: order.id,
      supplierInvoiceNumber: 'INV-2026-001',
    });
    expect(received).toMatchObject({ status: 'received', supplierInvoiceNumber: 'INV-2026-001' });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 7000 });
    expect(
      database.connection
        .prepare('SELECT purchase_cost_minor FROM products WHERE id = ?')
        .get(productId),
    ).toEqual({ purchase_cost_minor: 586 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'purchase_order.received'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'purchase_order.received'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(() => service.receivePurchaseOrder({ id: order.id })).toThrow(/only draft/i);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'purchase_order'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('cancels only draft orders and does not create stock movements', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 1000, unitCostMinor: 500 }],
    });
    service.cancelPurchaseOrder(order.id);
    expect(service.listPurchaseOrders()[0].status).toBe('cancelled');
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    expect(() => service.cancelPurchaseOrder(order.id)).toThrow(/only draft/i);
  });
});
