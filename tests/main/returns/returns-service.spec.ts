// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckoutService } from '../../../src/main/checkout/checkout-service';
import { ReturnsService } from '../../../src/main/checkout/returns-service';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { StockService } from '../../../src/main/inventory/stock-service';

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
    .run(productId, storeId, 'TEA-1', 'Tea 1kg', 'piece', 500, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    unitCostMinor: 500,
    reason: 'Opening stock',
  });
  const checkout = new CheckoutService(database.connection, storeId, counterId);
  const returns = new ReturnsService(database.connection, storeId, counterId, actorId);
  function sell(quantityMilli = 2000) {
    return checkout.complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli }],
      paymentLines: [
        {
          paymentMethod: 'cash',
          amountMinor: quantityMilli,
          amountTenderedMinor: quantityMilli + 500,
        },
      ],
    });
  }
  return { database, storeId, counterId, actorId, productId, returns, sell };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('sale returns and voids', () => {
  it('supports multiple partial returns without exceeding sold quantity and closes the sale when fully returned', () => {
    const { database, storeId, counterId, productId, returns, sell } = setup();
    database.connection
      .prepare(
        "INSERT INTO sync_state (counter_id, status, allocation_enforced) VALUES (?, 'connected', 1)",
      )
      .run(counterId);
    database.connection
      .prepare(
        'INSERT INTO counter_stock_allocations (counter_id, product_id, remaining_quantity_milli) VALUES (?, ?, ?)',
      )
      .run(counterId, productId, 5000);
    const sale = sell(2000);
    expect(
      database.connection
        .prepare(
          'SELECT remaining_quantity_milli AS quantity FROM counter_stock_allocations WHERE counter_id=? AND product_id=?',
        )
        .get(counterId, productId),
    ).toEqual({ quantity: 3000 });
    const lineId = (
      database.connection.prepare('SELECT id FROM sale_lines WHERE sale_id = ?').get(sale.id) as {
        id: string;
      }
    ).id;
    expect(returns.getReturnableItems(sale.id)).toMatchObject([
      {
        soldQuantityMilli: 2000,
        returnedQuantityMilli: 0,
        remainingQuantityMilli: 2000,
        remainingRefundMinor: 2000,
      },
    ]);
    const first = returns.returnSale({
      saleId: sale.id,
      reason: 'Customer returned one item',
      items: [{ saleLineId: lineId, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    expect(first).toMatchObject({
      operation: 'return',
      totalMinor: 1000,
      originalReceiptNumber: sale.receiptNumber,
    });
    expect(
      database.connection.prepare('SELECT status FROM sales WHERE id = ?').get(sale.id),
    ).toEqual({ status: 'partially_returned' });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 4000 });
    expect(
      database.connection
        .prepare(
          'SELECT remaining_quantity_milli AS quantity FROM counter_stock_allocations WHERE counter_id=? AND product_id=?',
        )
        .get(counterId, productId),
    ).toEqual({ quantity: 4000 });
    expect(returns.getReturnableItems(sale.id)).toMatchObject([
      {
        soldQuantityMilli: 2000,
        returnedQuantityMilli: 1000,
        remainingQuantityMilli: 1000,
        remainingRefundMinor: 1000,
      },
    ]);
    const second = returns.returnSale({
      saleId: sale.id,
      reason: 'Return remaining item',
      items: [{ saleLineId: lineId, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    expect(second.totalMinor).toBe(1000);
    expect(
      database.connection.prepare('SELECT status FROM sales WHERE id = ?').get(sale.id),
    ).toEqual({ status: 'returned' });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 5000 });
    expect(
      database.connection
        .prepare(
          'SELECT remaining_quantity_milli AS quantity FROM counter_stock_allocations WHERE counter_id=? AND product_id=?',
        )
        .get(counterId, productId),
    ).toEqual({ quantity: 5000 });
    expect(() =>
      returns.returnSale({
        saleId: sale.id,
        reason: 'Too many returns',
        items: [{ saleLineId: lineId, quantityMilli: 1000 }],
        refundPaymentMethod: 'cash',
      }),
    ).toThrow(/only completed or partially returned/i);
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM return_receipt_snapshots').get(),
    ).toEqual({ count: 2 });
  });

  it('restores only the returned single units as pack-equivalent stock', () => {
    const { database, counterId, productId, returns } = setup();
    database.connection
      .prepare(
        "UPDATE products SET base_unit='pack', pack_size=20, single_unit_name='cigarette', single_selling_price_minor=150, selling_price_minor=25000, tax_rate_basis_points=0 WHERE id=?",
      )
      .run(productId);
    const sale = new CheckoutService(
      database.connection,
      database.connection.prepare('SELECT store_id FROM products WHERE id=?').get(productId)
        .store_id,
      counterId,
    ).complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000, saleUnit: 'single' }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 300, amountTenderedMinor: 500 }],
    });
    expect(sale.totalMinor).toBe(300);
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id=? AND counter_id=?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 4900 });
    const saleLineId = database.connection
      .prepare('SELECT id FROM sale_lines WHERE sale_id=?')
      .get(sale.id).id;
    const returned = returns.returnSale({
      saleId: sale.id,
      reason: 'One cigarette returned',
      items: [{ saleLineId, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    expect(returned.totalMinor).toBe(150);
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id=? AND counter_id=?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 4950 });
    const returnEvent = database.connection
      .prepare(
        "SELECT payload_json AS payload FROM outbox_events WHERE event_type='sale.return.completed' AND aggregate_id=?",
      )
      .get(returned.id);
    expect(JSON.parse(returnEvent.payload).lines[0]).toMatchObject({
      quantityMilli: 1000,
      stockQuantityMilli: 50,
    });
  });

  it('voids a sale only once, refunds the full total and restores stock', () => {
    const { database, storeId, counterId, productId, returns, sell } = setup();
    const sale = sell(2000);
    const result = returns.voidSale({
      saleId: sale.id,
      reason: 'Duplicate transaction',
      refundPaymentMethod: 'cash',
      refundReference: 'CASH-REFUND',
    });
    expect(result).toMatchObject({
      operation: 'void',
      totalMinor: sale.totalMinor,
      originalReceiptNumber: sale.receiptNumber,
    });
    expect(result.payments).toEqual([
      { paymentMethod: 'cash', amountMinor: sale.totalMinor, reference: 'CASH-REFUND' },
    ]);
    expect(
      database.connection.prepare('SELECT status FROM sales WHERE id = ?').get(sale.id),
    ).toEqual({ status: 'voided' });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 5000 });
    expect(() =>
      returns.voidSale({ saleId: sale.id, reason: 'Void again', refundPaymentMethod: 'cash' }),
    ).toThrow(/only a sale with no previous returns/i);
  });
});
