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
  database.connection
    .prepare(
      "INSERT INTO stock_movements (id,store_id,counter_id,product_id,movement_type,quantity_delta_milli,unit_cost_minor,reference_type,reference_id,reason) VALUES (?,?,?,?,'opening',5000,500,'test_seed',?,'Opening inventory')",
    )
    .run(randomUUID(), storeId, counterId, productId, randomUUID());
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
    ).toEqual({ count: 15 });
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

  it('posts each non-cash payment method to its own clearing account', () => {
    const { database, storeId, counterId, productId } = setup();
    const checkout = new CheckoutService(database.connection, storeId, counterId);
    const sale = checkout.complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 1000 }],
      paymentLines: [{ paymentMethod: 'card', amountMinor: 1100 }],
    });
    const account = database.connection
      .prepare(
        "SELECT a.code, a.name FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.source_type='sale' AND je.source_id=? AND jl.debit_minor>0",
      )
      .get(sale.id);
    expect(account).toMatchObject({ code: '1011', name: 'Card Payment Clearing' });

    for (const [paymentMethod, expectedCode] of [
      ['bank_transfer', '1012'],
      ['mobile_wallet', '1013'],
      ['other', '1019'],
    ] as const) {
      const next = checkout.complete({
        idempotencyKey: randomUUID(),
        items: [{ productId, quantityMilli: 1000 }],
        paymentLines: [{ paymentMethod, amountMinor: 1100 }],
      });
      const mapped = database.connection
        .prepare(
          "SELECT a.code FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id WHERE je.source_type='sale' AND je.source_id=? AND jl.debit_minor>0",
        )
        .get(next.id) as { code: string };
      expect(mapped.code).toBe(expectedCode);
      expect(journalTotals(database, 'sale', next.id)).toEqual({
        debitMinor: 1600,
        creditMinor: 1600,
      });
    }
    expect(journalTotals(database, 'sale', sale.id)).toEqual({
      debitMinor: 1600,
      creditMinor: 1600,
    });
    expect(
      new AccountingService(database.connection, storeId)
        .listAccounts()
        .some((a) => a.code === '1010' && a.name === 'Legacy Non-cash Payment Clearing'),
    ).toBe(true);
  });

  it('returns a balanced trial balance and period income statement', () => {
    const { database, storeId, counterId, productId, userId } = setup();
    const sale = new CheckoutService(database.connection, storeId, counterId).complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2200 }],
    });
    expect(sale.totalMinor).toBe(2200);
    const line = database.connection
      .prepare('SELECT id FROM sale_lines WHERE sale_id = ?')
      .get(sale.id) as { id: string };
    new ReturnsService(database.connection, storeId, counterId, userId).returnSale({
      saleId: sale.id,
      reason: 'Statement test return',
      items: [{ saleLineId: line.id, quantityMilli: 1000 }],
      refundPaymentMethod: 'cash',
    });
    const service = new AccountingService(database.connection, storeId);
    const today = new Date().toISOString().slice(0, 10);
    const trialBalance = service.listTrialBalance(today);
    expect(trialBalance.length).toBeGreaterThan(0);
    expect(trialBalance.reduce((sum, row) => sum + row.debitBalanceMinor, 0)).toBe(
      trialBalance.reduce((sum, row) => sum + row.creditBalanceMinor, 0),
    );
    expect(service.getIncomeStatement(today, today)).toMatchObject({
      startDate: today,
      endDate: today,
      currencyCode: 'PKR',
      totalRevenueMinor: 1000,
      totalExpensesMinor: 500,
      netIncomeMinor: 500,
    });
    const sheet = service.getBalanceSheet(today);
    expect(sheet.currencyCode).toBe('PKR');
    expect(sheet.balanced).toBe(true);
    expect(sheet.assetsMinor).toBe(sheet.liabilitiesMinor + sheet.equityMinor);
    const cashMovement = service.getCashMovementStatement(today, today);
    expect(cashMovement.inflowMinor).toBeGreaterThan(0);
    expect(cashMovement.netChangeMinor).toBe(cashMovement.inflowMinor - cashMovement.outflowMinor);
    expect(cashMovement.bySource.some((row) => row.sourceType === 'sale')).toBe(true);
    expect(() => service.listTrialBalance('2026-02-31')).toThrow(/valid YYYY-MM-DD/);
    expect(() => service.getIncomeStatement(today, '2020-01-01')).toThrow(
      /start date on or before end date/,
    );
  });

  it('posts and reverses an owner manual journal without changing the final ledger balance', () => {
    const { database, storeId, userId } = setup();
    const service = new AccountingService(database.connection, storeId, userId);
    const accounts = service.listAccounts();
    const cash = accounts.find((account) => account.code === '1000')!;
    const revenue = accounts.find((account) => account.code === '4000')!;
    const entryId = service.postManualJournal({
      description: 'Manual opening correction',
      lines: [
        { accountId: cash.id, debitMinor: 5000, creditMinor: 0, memo: 'Correction debit' },
        { accountId: revenue.id, debitMinor: 0, creditMinor: 5000, memo: 'Correction credit' },
      ],
    });
    expect(journalTotals(database, 'manual', entryId)).toEqual({
      debitMinor: 5000,
      creditMinor: 5000,
    });
    const reversalId = service.reverseManualJournal({
      entryId,
      reason: 'Entered against the wrong source',
    });
    expect(service.reverseManualJournal({ entryId, reason: 'Retry same reversal' })).toBe(
      reversalId,
    );
    expect(journalTotals(database, 'reversal', entryId)).toEqual({
      debitMinor: 5000,
      creditMinor: 5000,
    });
    expect(
      database.connection.prepare('SELECT status FROM journal_entries WHERE id=?').get(entryId),
    ).toEqual({ status: 'reversed' });
    const today = new Date().toISOString().slice(0, 10);
    const trialBalance = service.listTrialBalance(today);
    expect(trialBalance.reduce((sum, row) => sum + row.debitBalanceMinor, 0)).toBe(0);
    expect(trialBalance.reduce((sum, row) => sum + row.creditBalanceMinor, 0)).toBe(0);
    expect(service.getIncomeStatement(today, today)).toMatchObject({
      totalRevenueMinor: 0,
      totalExpensesMinor: 0,
      netIncomeMinor: 0,
    });
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

  it('reconciles indirect operating cash flow to actual cash movement for a taxable sale', () => {
    const { database, storeId, counterId, productId } = setup();
    new CheckoutService(database.connection, storeId, counterId).complete({
      idempotencyKey: randomUUID(),
      items: [{ productId, quantityMilli: 2000 }],
      paymentLines: [{ paymentMethod: 'cash', amountMinor: 2200 }],
    });
    const today = new Date().toISOString().slice(0, 10);
    const statement = new AccountingService(
      database.connection,
      storeId,
    ).getIndirectCashFlowStatement(today, today);
    expect(statement.netIncomeMinor).toBe(1000);
    expect(statement.inventoryChangeMinor).toBe(-1000);
    expect(statement.salesTaxPayableChangeMinor).toBe(200);
    expect(statement.operatingCashFlowMinor).toBe(2200);
    expect(statement.investingCashFlowMinor).toBe(0);
    expect(statement.financingCashFlowMinor).toBe(0);
    expect(statement.cashChangeMinor).toBe(2200);
    expect(statement.reconciliationDifferenceMinor).toBe(0);
  });
});

it('classifies manual cash contributions as financing and reconciles the cash-flow statement', () => {
  const { database, storeId } = setup();
  const service = new AccountingService(database.connection, storeId);
  const accounts = service.listAccounts();
  const cash = accounts.find((account) => account.code === '1000')!;
  const capital = accounts.find((account) => account.code === '3000')!;
  service.postManualJournal({
    description: 'Owner capital contribution',
    lines: [
      { accountId: cash.id, debitMinor: 5000, creditMinor: 0, memo: 'Capital received' },
      { accountId: capital.id, debitMinor: 0, creditMinor: 5000, memo: 'Owner capital' },
    ],
  });
  const today = new Date().toISOString().slice(0, 10);
  const statement = service.getIndirectCashFlowStatement(today, today);
  expect(statement.operatingCashFlowMinor).toBe(0);
  expect(statement.investingCashFlowMinor).toBe(0);
  expect(statement.financingCashFlowMinor).toBe(5000);
  expect(statement.cashChangeMinor).toBe(5000);
  expect(statement.openingStockEquityChangeMinor).toBe(0);
  expect(statement.reconciliationDifferenceMinor).toBe(0);
});
