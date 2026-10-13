import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

type AccountCode = '1000' | '1010' | '1200' | '2000' | '2100' | '4000' | '4050' | '5000';
type JournalLineInput = {
  accountCode: AccountCode;
  debitMinor?: number;
  creditMinor?: number;
  memo: string;
};
const DEFAULT_ACCOUNTS: {
  code: AccountCode;
  name: string;
  type: string;
  normal: 'debit' | 'credit';
}[] = [
  { code: '1000', name: 'Cash on Hand', type: 'asset', normal: 'debit' },
  { code: '1010', name: 'Non-cash Payment Clearing', type: 'asset', normal: 'debit' },
  { code: '1200', name: 'Inventory', type: 'asset', normal: 'debit' },
  { code: '2000', name: 'Accounts Payable', type: 'liability', normal: 'credit' },
  { code: '2100', name: 'Sales Tax Payable', type: 'liability', normal: 'credit' },
  { code: '4000', name: 'Sales Revenue', type: 'income', normal: 'credit' },
  { code: '4050', name: 'Sales Returns and Allowances', type: 'income', normal: 'debit' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normal: 'debit' },
];

export class AccountingService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly actorUserId: string | null = null,
  ) {}

  ensureChartOfAccounts(): void {
    const insert = this.database.prepare(
      'INSERT OR IGNORE INTO accounts (id, store_id, code, name, account_type, normal_balance, is_system) VALUES (?, ?, ?, ?, ?, ?, 1)',
    );
    for (const account of DEFAULT_ACCOUNTS)
      insert.run(
        randomUUID(),
        this.storeId,
        account.code,
        account.name,
        account.type,
        account.normal,
      );
  }

  postSale(saleId: string): string {
    this.ensureChartOfAccounts();
    const prior = this.findExisting('sale', saleId);
    if (prior) return prior;
    const sale = this.database
      .prepare(
        'SELECT id, currency_code, subtotal_minor, tax_minor, receipt_number FROM sales WHERE id = ? AND store_id = ?',
      )
      .get(saleId, this.storeId) as
      | {
          id: string;
          currency_code: string;
          subtotal_minor: number;
          tax_minor: number;
          receipt_number: string;
        }
      | undefined;
    if (!sale) throw new Error('Cannot post accounting: sale was not found.');
    const payments = this.database
      .prepare(
        'SELECT payment_method, SUM(amount_minor) AS amount_minor FROM sale_payments WHERE sale_id = ? GROUP BY payment_method',
      )
      .all(saleId) as { payment_method: string; amount_minor: number }[];
    const lines: JournalLineInput[] = payments.map((payment) => ({
      accountCode: payment.payment_method.toLowerCase() === 'cash' ? '1000' : '1010',
      debitMinor: payment.amount_minor,
      memo: `${payment.payment_method} payment for receipt ${sale.receipt_number}`,
    }));
    if (sale.subtotal_minor > 0)
      lines.push({
        accountCode: '4000',
        creditMinor: sale.subtotal_minor,
        memo: `Net sales revenue ${sale.receipt_number}`,
      });
    if (sale.tax_minor > 0)
      lines.push({
        accountCode: '2100',
        creditMinor: sale.tax_minor,
        memo: `Sales tax ${sale.receipt_number}`,
      });
    const cost = this.saleCost(saleId);
    if (cost > 0)
      lines.push(
        {
          accountCode: '5000',
          debitMinor: cost,
          memo: `Cost of goods sold ${sale.receipt_number}`,
        },
        {
          accountCode: '1200',
          creditMinor: cost,
          memo: `Inventory relieved ${sale.receipt_number}`,
        },
      );
    return this.postBalanced({
      sourceType: 'sale',
      sourceId: saleId,
      currencyCode: sale.currency_code,
      description: `Sale receipt ${sale.receipt_number}`,
      lines,
    });
  }

  postSaleReturn(returnId: string): string {
    this.ensureChartOfAccounts();
    const prior = this.findExisting('sale_return', returnId);
    if (prior) return prior;
    const ret = this.database
      .prepare(
        'SELECT sr.id, sr.sale_id, sr.currency_code, sr.total_minor, sr.return_number, sr.operation, s.receipt_number FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id WHERE sr.id = ? AND sr.store_id = ?',
      )
      .get(returnId, this.storeId) as
      | {
          id: string;
          sale_id: string;
          currency_code: string;
          total_minor: number;
          return_number: string;
          operation: string;
          receipt_number: string;
        }
      | undefined;
    if (!ret) throw new Error('Cannot post accounting: return was not found.');
    const tax = this.database
      .prepare(
        'SELECT COALESCE(SUM(refund_tax_minor),0) AS amount FROM sale_return_lines WHERE sale_return_id = ?',
      )
      .get(returnId) as { amount: number };
    const netRefund = ret.total_minor - tax.amount;
    const payments = this.database
      .prepare(
        'SELECT payment_method, SUM(amount_minor) AS amount_minor FROM sale_return_payments WHERE sale_return_id = ? GROUP BY payment_method',
      )
      .all(returnId) as { payment_method: string; amount_minor: number }[];
    const lines: JournalLineInput[] = [];
    if (netRefund > 0)
      lines.push({
        accountCode: '4050',
        debitMinor: netRefund,
        memo: `${ret.operation} net refund ${ret.return_number}`,
      });
    if (tax.amount > 0)
      lines.push({
        accountCode: '2100',
        debitMinor: tax.amount,
        memo: `Reverse sales tax ${ret.return_number}`,
      });
    for (const payment of payments)
      lines.push({
        accountCode: payment.payment_method.toLowerCase() === 'cash' ? '1000' : '1010',
        creditMinor: payment.amount_minor,
        memo: `${payment.payment_method} refund ${ret.return_number}`,
      });
    const cost = this.returnedCost(returnId, ret.sale_id);
    if (cost > 0)
      lines.push(
        { accountCode: '1200', debitMinor: cost, memo: `Inventory restored ${ret.return_number}` },
        {
          accountCode: '5000',
          creditMinor: cost,
          memo: `Reverse cost of goods sold ${ret.return_number}`,
        },
      );
    return this.postBalanced({
      sourceType: 'sale_return',
      sourceId: returnId,
      currencyCode: ret.currency_code,
      description: `${ret.operation === 'void' ? 'Void' : 'Return'} of receipt ${ret.receipt_number}`,
      lines,
    });
  }

  postPurchaseReceipt(orderId: string): string {
    this.ensureChartOfAccounts();
    const prior = this.findExisting('purchase_receipt', orderId);
    if (prior) return prior;
    const order = this.database
      .prepare(
        "SELECT id, order_number, subtotal_minor FROM purchase_orders WHERE id = ? AND store_id = ? AND status = 'received'",
      )
      .get(orderId, this.storeId) as
      { id: string; order_number: string; subtotal_minor: number } | undefined;
    if (!order) throw new Error('Cannot post accounting: received purchase order was not found.');
    if (order.subtotal_minor <= 0)
      throw new Error('Cannot post accounting for a zero-value purchase receipt.');
    const currency = this.database
      .prepare('SELECT currency_code FROM stores WHERE id = ?')
      .get(this.storeId) as { currency_code: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    return this.postBalanced({
      sourceType: 'purchase_receipt',
      sourceId: orderId,
      currencyCode: currency.currency_code,
      description: `Goods received ${order.order_number}`,
      lines: [
        {
          accountCode: '1200',
          debitMinor: order.subtotal_minor,
          memo: `Inventory received ${order.order_number}`,
        },
        {
          accountCode: '2000',
          creditMinor: order.subtotal_minor,
          memo: `Supplier payable ${order.order_number}`,
        },
      ],
    });
  }

  listAccounts(): {
    id: string;
    code: string;
    name: string;
    accountType: string;
    normalBalance: string;
    isSystem: boolean;
    isActive: boolean;
  }[] {
    this.ensureChartOfAccounts();
    const rows = this.database
      .prepare(
        'SELECT id, code, name, account_type AS accountType, normal_balance AS normalBalance, is_system AS isSystem, is_active AS isActive FROM accounts WHERE store_id = ? ORDER BY code',
      )
      .all(this.storeId) as {
      id: string;
      code: string;
      name: string;
      accountType: string;
      normalBalance: string;
      isSystem: number;
      isActive: number;
    }[];
    return rows.map((row) => ({
      ...row,
      isSystem: row.isSystem === 1,
      isActive: row.isActive === 1,
    }));
  }

  listRecentJournals(limit = 100): {
    id: string;
    entryNumber: string;
    sourceType: string;
    sourceId: string;
    description: string;
    currencyCode: string;
    postedAt: string;
    debitMinor: number;
    creditMinor: number;
  }[] {
    this.ensureChartOfAccounts();
    const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
    return this.database
      .prepare(
        'SELECT je.id, je.entry_number AS entryNumber, je.source_type AS sourceType, je.source_id AS sourceId, je.description, je.currency_code AS currencyCode, je.posted_at AS postedAt, COALESCE(SUM(jl.debit_minor),0) AS debitMinor, COALESCE(SUM(jl.credit_minor),0) AS creditMinor FROM journal_entries je LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id WHERE je.store_id = ? GROUP BY je.id ORDER BY je.posted_at DESC LIMIT ?',
      )
      .all(this.storeId, safeLimit) as {
      id: string;
      entryNumber: string;
      sourceType: string;
      sourceId: string;
      description: string;
      currencyCode: string;
      postedAt: string;
      debitMinor: number;
      creditMinor: number;
    }[];
  }

  private saleCost(saleId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(SUM(ROUND((-quantity_delta_milli * unit_cost_minor) / 1000.0)),0) AS amount FROM stock_movements WHERE reference_type = 'sale' AND reference_id = ? AND movement_type = 'sale'",
      )
      .get(saleId) as { amount: number };
    return row.amount;
  }

  private returnedCost(returnId: string, saleId: string): number {
    const row = this.database
      .prepare(
        "SELECT COALESCE(SUM(ROUND((rl.quantity_milli * COALESCE((SELECT sm.unit_cost_minor FROM stock_movements sm WHERE sm.reference_type = 'sale' AND sm.reference_id = ? AND sm.product_id = rl.product_id ORDER BY sm.created_at LIMIT 1),0)) / 1000.0)),0) AS amount FROM sale_return_lines rl WHERE rl.sale_return_id = ? AND rl.product_id IS NOT NULL",
      )
      .get(saleId, returnId) as { amount: number };
    return row.amount;
  }

  private findExisting(sourceType: string, sourceId: string): string | null {
    const row = this.database
      .prepare(
        'SELECT id FROM journal_entries WHERE store_id = ? AND source_type = ? AND source_id = ?',
      )
      .get(this.storeId, sourceType, sourceId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private postBalanced(input: {
    sourceType: 'sale' | 'sale_return' | 'purchase_receipt';
    sourceId: string;
    currencyCode: string;
    description: string;
    lines: JournalLineInput[];
  }): string {
    const lines = input.lines.filter(
      (line) => (line.debitMinor ?? 0) > 0 || (line.creditMinor ?? 0) > 0,
    );
    const debit = lines.reduce((sum, line) => sum + (line.debitMinor ?? 0), 0);
    const credit = lines.reduce((sum, line) => sum + (line.creditMinor ?? 0), 0);
    if (!lines.length || debit !== credit)
      throw new Error(`Accounting journal is not balanced (debit ${debit}, credit ${credit}).`);
    for (const line of lines)
      if ((line.debitMinor ?? 0) > 0 && (line.creditMinor ?? 0) > 0)
        throw new Error('Journal line cannot contain both debit and credit.');
    const accountIds = new Map<string, string>();
    for (const account of this.database
      .prepare('SELECT id, code FROM accounts WHERE store_id = ? AND is_active = 1')
      .all(this.storeId) as { id: string; code: string }[])
      accountIds.set(account.code, account.id);
    for (const line of lines)
      if (!accountIds.has(line.accountCode))
        throw new Error(`Accounting account ${line.accountCode} is missing.`);
    this.database.exec('SAVEPOINT accounting_post');
    try {
      const id = randomUUID();
      const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const prefix = `JE-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM journal_entries WHERE store_id = ? AND entry_number LIKE ?',
        )
        .get(this.storeId, `${prefix}%`) as { count: number };
      const entryNumber = `${prefix}${String(sequence.count + 1).padStart(4, '0')}`;
      this.database
        .prepare(
          "INSERT INTO journal_entries (id, store_id, entry_number, source_type, source_id, status, currency_code, description, posted_by_user_id) VALUES (?, ?, ?, ?, ?, 'posted', ?, ?, ?)",
        )
        .run(
          id,
          this.storeId,
          entryNumber,
          input.sourceType,
          input.sourceId,
          input.currencyCode,
          input.description,
          this.actorUserId,
        );
      const insertLine = this.database.prepare(
        'INSERT INTO journal_lines (id, journal_entry_id, account_id, line_number, debit_minor, credit_minor, memo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      lines.forEach((line, index) =>
        insertLine.run(
          randomUUID(),
          id,
          accountIds.get(line.accountCode)!,
          index + 1,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          line.memo,
        ),
      );
      this.database.exec('RELEASE SAVEPOINT accounting_post');
      return id;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT accounting_post');
      this.database.exec('RELEASE SAVEPOINT accounting_post');
      throw error;
    }
  }
}
