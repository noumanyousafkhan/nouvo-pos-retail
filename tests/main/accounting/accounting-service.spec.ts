// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountingService } from '../../../src/main/accounting/accounting-service';
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
  const productId = randomUUID();
  const userId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name, currency_code) VALUES (?, ?, ?)')
    .run(storeId, 'Ledger Store', 'PKR');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      "INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, 'ledger.owner', 'Ledger Owner', 'test-hash', 'owner')",
    )
    .run(userId, storeId);
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, base_unit, purchase_cost_minor, selling_price_minor, tax_rate_basis_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'LEDGER-1', 'Ledger Item', 'piece', 500, 1000, 1000);
  new StockService(database.connection, storeId, counterId).record({
    productId,
    movementType: 'receipt',
    quantityMilli: 5000,
    unitCostMinor: 500,
    reason: 'Opening inventory',
  });
  return { database, storeId, counterId, productId, userId };
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});
function journalTotals(
  database: ReturnType<typeof openLocalDatabase>,
  sourceType: string,
  sourceId: string,
) {
  return database.connection
    .prepare(
      'SELECT SUM(jl.debit_minor) AS debitMinor, SUM(jl.credit_minor) AS creditMinor FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id WHERE je.source_type = ? AND je.source_id = ? GROUP BY je.id',
    )
    .get(sourceType, sourceId);
}

describe('double-entry accounting postings', () => {
  it('posts a balanced sale journal with COGS and prevents duplicate journals on retry', () => {
    const { database, storeId, counterId, productId } = setup();
    const checkout = new CheckoutService(database.connection, storeId, counterId);
    const sale = checkout.complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2200 }],
    });
    expect(journalTotals(database, 'sale', sale.id)).toEqual({
      debitMinor: 3200,
      creditMinor: 3200,
    });
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM accounts WHERE store_id = ?')
        .get(storeId),
    ).toEqual({ count: 8 });
    expect(new AccountingService(database.connection, storeId).postSale(sale.id)).toBeTypeOf(
      'string',
    );
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM journal_entries WHERE source_type = 'sale' AND source_id = ?",
        )
        .get(sale.id),
    ).toEqual({ count: 1 });
  });

  it('posts a balanced return that reverses tax and original inventory cost', () => {
    const { database, storeId, counterId, productId, userId } = setup();
    const sale = new CheckoutService(database.connection, storeId, counterId).complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2200 }],
    });
    const line = database.connection
      .prepare('SELECT id FROM sale_lines WHERE sale_id = ?')
      .get(sale.id) as { id: string };
    const result = new ReturnsService(database.connection, storeId, counterId, userId).returnSale({
      saleId: sale.id,
      reason: 'Customer return',
      items: [{ saleLineId: line.id, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    expect(result.totalMinor).toBe(1100);
    expect(journalTotals(database, 'sale_return', result.id)).toEqual({
      debitMinor: 1600,
      creditMinor: 1600,
    });
    const entries = new AccountingService(database.connection, storeId).listRecentJournals();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.debitMinor === entry.creditMinor)).toBe(true);
  });
});
