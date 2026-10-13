// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CashSessionService } from '../../../src/main/checkout/cash-session-service';
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
    .run(storeId, 'Cash Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      "INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, 'cash.owner', 'Cash Owner', 'test-hash', 'owner')",
    )
    .run(actorId, storeId);
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, base_unit, purchase_cost_minor, selling_price_minor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'RICE-1', 'Rice 1kg', 'piece', 500, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    unitCostMinor: 500,
    reason: 'Opening stock',
  });
  const sessions = new CashSessionService(
    database.connection,
    storeId,
    counterId,
    actorId,
    'owner',
  );
  return { database, storeId, counterId, actorId, productId, sessions };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('cashier shifts and cash reconciliation', () => {
  it('tracks sale cash, refunds, cash movements and closing variance atomically', () => {
    const { database, storeId, counterId, actorId, productId, sessions } = setup();
    const openedShift = sessions.open({ openingFloatMinor: 10000, openingNote: 'Morning float' });
    expect(openedShift).toMatchObject({
      status: 'open',
      openingFloatMinor: 10000,
      expectedCashMinor: 10000,
    });
    const checkout = new CheckoutService(database.connection, storeId, counterId);
    const sale = checkout.complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2000, amountTenderedMinor: 2500 }],
    });
    expect(
      database.connection
        .prepare('SELECT cashier_session_id, cashier_user_id FROM sales WHERE id = ?')
        .get(sale.id),
    ).toEqual({ cashier_session_id: openedShift.id, cashier_user_id: actorId });
    expect(sessions.getActive()).toMatchObject({ cashSalesMinor: 2000, expectedCashMinor: 12000 });
    const lineId = (
      database.connection.prepare('SELECT id FROM sale_lines WHERE sale_id = ?').get(sale.id) as {
        id: string;
      }
    ).id;
    new ReturnsService(database.connection, storeId, counterId, actorId).returnSale({
      saleId: sale.id,
      reason: 'Cash refund',
      items: [{ saleLineId: lineId, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    expect(sessions.getActive()).toMatchObject({
      cashSalesMinor: 2000,
      cashRefundsMinor: 1000,
      expectedCashMinor: 11000,
    });
    sessions.recordMovement({
      movementType: 'cash_in',
      amountMinor: 500,
      reason: 'Petty cash returned',
    });
    sessions.recordMovement({
      movementType: 'cash_out',
      amountMinor: 1000,
      reason: 'Delivery expenses',
    });
    expect(sessions.getActive()).toMatchObject({
      cashInMinor: 500,
      cashOutMinor: 1000,
      expectedCashMinor: 10500,
    });
    const closed = sessions.close({
      countedCashMinor: 10400,
      closingNote: 'Drawer short by 1 rupee',
    });
    expect(closed).toMatchObject({
      status: 'closed',
      expectedCashMinor: 10500,
      countedCashMinor: 10400,
      varianceMinor: -100,
    });
    expect(sessions.getActive()).toBeNull();
    expect(sessions.listHistory()).toMatchObject([
      {
        id: openedShift.id,
        status: 'closed',
        cashSalesMinor: 2000,
        cashRefundsMinor: 1000,
        cashInMinor: 500,
        cashOutMinor: 1000,
        varianceMinor: -100,
      },
    ]);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE store_id = ? AND action LIKE 'cash_session.%'",
        )
        .get(storeId),
    ).toEqual({ count: 4 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type LIKE 'cash_session.%'",
        )
        .get(),
    ).toEqual({ count: 4 });
  });

  it('prevents a second open shift and cash-out beyond expected drawer cash', () => {
    const { sessions } = setup();
    sessions.open({ openingFloatMinor: 1000 });
    expect(() => sessions.open({ openingFloatMinor: 500 })).toThrow(
      'already has an open cashier shift',
    );
    expect(() =>
      sessions.recordMovement({
        movementType: 'cash_out',
        amountMinor: 1001,
        reason: 'Too much cash out',
      }),
    ).toThrow('exceeds the expected cash');
  });

  it('requires a shift before cash movement or closing', () => {
    const { sessions } = setup();
    expect(() =>
      sessions.recordMovement({
        movementType: 'cash_in',
        amountMinor: 100,
        reason: 'Test cash in',
      }),
    ).toThrow('Open a cashier shift');
    expect(() => sessions.close({ countedCashMinor: 0 })).toThrow('no open cashier shift');
  });
});
