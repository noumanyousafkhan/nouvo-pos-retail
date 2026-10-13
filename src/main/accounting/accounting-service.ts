import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ManualJournalInput,
  ReverseManualJournalInput,
} from '../../shared/contracts/accounting';

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
        "SELECT id, order_number, received_subtotal_minor AS subtotal_minor FROM purchase_orders WHERE id = ? AND store_id = ? AND status = 'received'",
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

  postPurchaseReturn(returnId: string): string {
    this.ensureChartOfAccounts();
    const prior = this.findExisting('purchase_return', returnId);
    if (prior) return prior;
    const purchaseReturn = this.database
      .prepare(
        'SELECT id, return_number, total_minor FROM purchase_returns WHERE id=? AND store_id=?',
      )
      .get(returnId, this.storeId) as
      { id: string; return_number: string; total_minor: number } | undefined;
    if (!purchaseReturn) throw new Error('Cannot post accounting: supplier return was not found.');
    if (purchaseReturn.total_minor <= 0)
      throw new Error('Zero-value supplier returns do not require a financial journal.');
    const currency = this.database
      .prepare('SELECT currency_code FROM stores WHERE id=?')
      .get(this.storeId) as { currency_code: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    return this.postBalanced({
      sourceType: 'purchase_return',
      sourceId: returnId,
      currencyCode: currency.currency_code,
      description: `Supplier return ${purchaseReturn.return_number}`,
      lines: [
        {
          accountCode: '2000',
          debitMinor: purchaseReturn.total_minor,
          memo: `Reduce supplier payable ${purchaseReturn.return_number}`,
        },
        {
          accountCode: '1200',
          creditMinor: purchaseReturn.total_minor,
          memo: `Inventory returned to supplier ${purchaseReturn.return_number}`,
        },
      ],
    });
  }

  postSupplierPayment(paymentId: string): string {
    this.ensureChartOfAccounts();
    const prior = this.findExisting('supplier_payment', paymentId);
    if (prior) return prior;
    const payment = this.database
      .prepare(
        'SELECT id,payment_number,amount_minor,payment_method FROM supplier_payments WHERE id=? AND store_id=?',
      )
      .get(paymentId, this.storeId) as
      | { id: string; payment_number: string; amount_minor: number; payment_method: string }
      | undefined;
    if (!payment) throw new Error('Cannot post accounting: supplier payment was not found.');
    const currency = this.database
      .prepare('SELECT currency_code FROM stores WHERE id=?')
      .get(this.storeId) as { currency_code: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    const creditAccount = payment.payment_method === 'cash' ? '1000' : '1010';
    return this.postBalanced({
      sourceType: 'supplier_payment',
      sourceId: paymentId,
      currencyCode: currency.currency_code,
      description: `Supplier payment ${payment.payment_number}`,
      lines: [
        {
          accountCode: '2000',
          debitMinor: payment.amount_minor,
          memo: `Settle supplier payable ${payment.payment_number}`,
        },
        {
          accountCode: creditAccount,
          creditMinor: payment.amount_minor,
          memo: `Supplier payment via ${payment.payment_method}`,
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
    status: 'posted' | 'reversed';
    debitMinor: number;
    creditMinor: number;
  }[] {
    this.ensureChartOfAccounts();
    const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
    return this.database
      .prepare(
        'SELECT je.id, je.entry_number AS entryNumber, je.source_type AS sourceType, je.source_id AS sourceId, je.description, je.currency_code AS currencyCode, je.posted_at AS postedAt, je.status AS status, COALESCE(SUM(jl.debit_minor),0) AS debitMinor, COALESCE(SUM(jl.credit_minor),0) AS creditMinor FROM journal_entries je LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id WHERE je.store_id = ? GROUP BY je.id ORDER BY je.posted_at DESC LIMIT ?',
      )
      .all(this.storeId, safeLimit) as {
      id: string;
      entryNumber: string;
      sourceType: string;
      sourceId: string;
      description: string;
      currencyCode: string;
      postedAt: string;
      status: 'posted' | 'reversed';
      debitMinor: number;
      creditMinor: number;
    }[];
  }

  listTrialBalance(asOfDate: string): {
    accountId: string;
    code: string;
    name: string;
    accountType: string;
    debitBalanceMinor: number;
    creditBalanceMinor: number;
  }[] {
    if (!this.isValidDate(asOfDate))
      throw new Error('Trial balance date must be a valid YYYY-MM-DD date.');
    this.ensureChartOfAccounts();
    const rows = this.database
      .prepare(
        'SELECT a.id AS accountId,a.code,a.name,a.account_type AS accountType,COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_minor ELSE 0 END),0) AS debitTotal,COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_minor ELSE 0 END),0) AS creditTotal FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.store_id=a.store_id AND substr(je.posted_at,1,10)<=? WHERE a.store_id=? GROUP BY a.id ORDER BY a.code',
      )
      .all(asOfDate, this.storeId) as {
      accountId: string;
      code: string;
      name: string;
      accountType: string;
      debitTotal: number;
      creditTotal: number;
    }[];
    return rows.map((row) => {
      const net = row.debitTotal - row.creditTotal;
      return {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        accountType: row.accountType,
        debitBalanceMinor: Math.max(0, net),
        creditBalanceMinor: Math.max(0, -net),
      };
    });
  }

  getIncomeStatement(
    startDate: string,
    endDate: string,
  ): {
    startDate: string;
    endDate: string;
    currencyCode: string;
    totalRevenueMinor: number;
    totalExpensesMinor: number;
    netIncomeMinor: number;
  } {
    if (!this.isValidDate(startDate) || !this.isValidDate(endDate) || startDate > endDate)
      throw new Error(
        'Income statement requires valid dates with start date on or before end date.',
      );
    const currency = this.database
      .prepare('SELECT currency_code AS currencyCode FROM stores WHERE id=?')
      .get(this.storeId) as { currencyCode: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    const rows = this.database
      .prepare(
        "SELECT a.account_type AS accountType,a.normal_balance AS normalBalance,COALESCE(SUM(jl.debit_minor),0) AS debitTotal,COALESCE(SUM(jl.credit_minor),0) AS creditTotal FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON je.id=jl.journal_entry_id WHERE a.store_id=? AND je.store_id=? AND substr(je.posted_at,1,10) BETWEEN ? AND ? AND a.account_type IN ('income','expense') GROUP BY a.id",
      )
      .all(this.storeId, this.storeId, startDate, endDate) as {
      accountType: string;
      normalBalance: string;
      debitTotal: number;
      creditTotal: number;
    }[];
    let totalRevenueMinor = 0;
    let totalExpensesMinor = 0;
    for (const row of rows) {
      if (row.accountType === 'income') totalRevenueMinor += row.creditTotal - row.debitTotal;
      if (row.accountType === 'expense')
        totalExpensesMinor +=
          row.normalBalance === 'debit'
            ? row.debitTotal - row.creditTotal
            : row.creditTotal - row.debitTotal;
    }
    return {
      startDate,
      endDate,
      currencyCode: currency.currencyCode,
      totalRevenueMinor,
      totalExpensesMinor,
      netIncomeMinor: totalRevenueMinor - totalExpensesMinor,
    };
  }

  getBalanceSheet(asOfDate: string) {
    if (!this.isValidDate(asOfDate))
      throw new Error('Balance sheet date must be a valid YYYY-MM-DD date.');
    this.ensureChartOfAccounts();
    const currency = this.database
      .prepare('SELECT currency_code AS currencyCode FROM stores WHERE id=?')
      .get(this.storeId) as { currencyCode: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    const rows = this.database
      .prepare(
        'SELECT a.account_type AS accountType, COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_minor ELSE 0 END),0) AS debits, COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_minor ELSE 0 END),0) AS credits FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.store_id=a.store_id AND substr(je.posted_at,1,10)<=? WHERE a.store_id=? GROUP BY a.id',
      )
      .all(asOfDate, this.storeId) as { accountType: string; debits: number; credits: number }[];
    let assetsMinor = 0,
      liabilitiesMinor = 0,
      equityMinor = 0;
    for (const row of rows) {
      const net = row.debits - row.credits;
      if (row.accountType === 'asset') assetsMinor += net;
      else if (row.accountType === 'liability') liabilitiesMinor -= net;
      else if (row.accountType === 'equity') equityMinor -= net;
      else if (row.accountType === 'income') equityMinor += row.credits - row.debits;
      else if (row.accountType === 'expense') equityMinor -= net;
    }
    return {
      asOfDate,
      currencyCode: currency.currencyCode,
      assetsMinor,
      liabilitiesMinor,
      equityMinor,
      balanced: assetsMinor === liabilitiesMinor + equityMinor,
    };
  }

  getCashMovementStatement(startDate: string, endDate: string) {
    if (!this.isValidDate(startDate) || !this.isValidDate(endDate) || startDate > endDate)
      throw new Error(
        'Cash movement statement requires valid dates with start date on or before end date.',
      );
    const currency = this.database
      .prepare('SELECT currency_code AS currencyCode FROM stores WHERE id=?')
      .get(this.storeId) as { currencyCode: string } | undefined;
    if (!currency) throw new Error('Store currency is not configured.');
    const rows = this.database
      .prepare(
        "SELECT je.source_type AS sourceType, COALESCE(SUM(jl.debit_minor),0) AS inflow, COALESCE(SUM(jl.credit_minor),0) AS outflow FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id JOIN accounts a ON a.id=jl.account_id WHERE je.store_id=? AND a.store_id=? AND a.code IN ('1000','1010') AND substr(je.posted_at,1,10) BETWEEN ? AND ? GROUP BY je.source_type ORDER BY je.source_type",
      )
      .all(this.storeId, this.storeId, startDate, endDate) as {
      sourceType: string;
      inflow: number;
      outflow: number;
    }[];
    const bySource = rows.map((row) => ({
      sourceType: row.sourceType,
      inflowMinor: row.inflow,
      outflowMinor: row.outflow,
      netChangeMinor: row.inflow - row.outflow,
    }));
    const inflowMinor = bySource.reduce((sum, row) => sum + row.inflowMinor, 0);
    const outflowMinor = bySource.reduce((sum, row) => sum + row.outflowMinor, 0);
    return {
      startDate,
      endDate,
      currencyCode: currency.currencyCode,
      inflowMinor,
      outflowMinor,
      netChangeMinor: inflowMinor - outflowMinor,
      bySource,
    };
  }

  postManualJournal(input: ManualJournalInput): string {
    this.ensureChartOfAccounts();
    if (input.lines.length < 2 || input.lines.length > 50)
      throw new Error('A manual journal must contain between 2 and 50 lines.');
    const debit = input.lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = input.lines.reduce((sum, line) => sum + line.creditMinor, 0);
    if (!Number.isSafeInteger(debit) || debit <= 0 || debit !== credit)
      throw new Error('Manual journal debits and credits must balance to a positive amount.');
    for (const line of input.lines) {
      if (
        !Number.isSafeInteger(line.debitMinor) ||
        !Number.isSafeInteger(line.creditMinor) ||
        line.debitMinor < 0 ||
        line.creditMinor < 0
      )
        throw new Error(
          'Manual journal amounts must be non-negative safe integers in minor currency units.',
        );
      if (line.debitMinor > 0 === line.creditMinor > 0)
        throw new Error(
          'Each manual journal line must contain exactly one positive debit or credit.',
        );
      const account = this.database
        .prepare('SELECT id FROM accounts WHERE id=? AND store_id=? AND is_active=1')
        .get(line.accountId, this.storeId);
      if (!account)
        throw new Error('A journal line references an inactive or foreign-store account.');
    }
    const store = this.database
      .prepare('SELECT currency_code AS currencyCode FROM stores WHERE id=?')
      .get(this.storeId) as { currencyCode: string } | undefined;
    if (!store) throw new Error('Store currency is not configured.');
    this.database.exec('SAVEPOINT accounting_manual');
    try {
      const id = randomUUID();
      const entryNumber = this.nextEntryNumber();
      this.database
        .prepare(
          "INSERT INTO journal_entries (id,store_id,entry_number,source_type,source_id,status,currency_code,description,posted_by_user_id) VALUES (?,?,?,'manual',?,'posted',?,?,?)",
        )
        .run(
          id,
          this.storeId,
          entryNumber,
          id,
          store.currencyCode,
          input.description.trim(),
          this.actorUserId,
        );
      const insertLine = this.database.prepare(
        'INSERT INTO journal_lines (id,journal_entry_id,account_id,line_number,debit_minor,credit_minor,memo) VALUES (?,?,?,?,?,?,?)',
      );
      input.lines.forEach((line, index) =>
        insertLine.run(
          randomUUID(),
          id,
          line.accountId,
          index + 1,
          line.debitMinor,
          line.creditMinor,
          line.memo.trim(),
        ),
      );
      this.database.exec('RELEASE SAVEPOINT accounting_manual');
      return id;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT accounting_manual');
      this.database.exec('RELEASE SAVEPOINT accounting_manual');
      throw error;
    }
  }

  reverseManualJournal(input: ReverseManualJournalInput): string {
    const prior = this.findExisting('reversal', input.entryId);
    if (prior) return prior;
    const original = this.database
      .prepare(
        "SELECT id,entry_number,currency_code,description,status FROM journal_entries WHERE id=? AND store_id=? AND source_type='manual'",
      )
      .get(input.entryId, this.storeId) as
      | {
          id: string;
          entry_number: string;
          currency_code: string;
          description: string;
          status: string;
        }
      | undefined;
    if (!original)
      throw new Error('Only a manual journal belonging to this store can be reversed.');
    if (original.status !== 'posted') throw new Error('This manual journal is already reversed.');
    const lines = this.database
      .prepare(
        'SELECT account_id AS accountId,debit_minor AS debitMinor,credit_minor AS creditMinor,memo FROM journal_lines WHERE journal_entry_id=? ORDER BY line_number',
      )
      .all(original.id) as {
      accountId: string;
      debitMinor: number;
      creditMinor: number;
      memo: string;
    }[];
    if (lines.length < 2) throw new Error('The original journal has no valid lines to reverse.');
    this.database.exec('SAVEPOINT accounting_reverse');
    try {
      const reversalId = randomUUID();
      const entryNumber = this.nextEntryNumber();
      this.database
        .prepare(
          "INSERT INTO journal_entries (id,store_id,entry_number,source_type,source_id,status,currency_code,description,posted_by_user_id) VALUES (?,?,?,'reversal',?,'posted',?,?,?)",
        )
        .run(
          reversalId,
          this.storeId,
          entryNumber,
          original.id,
          original.currency_code,
          'Reversal of ' + original.entry_number + ': ' + input.reason.trim(),
          this.actorUserId,
        );
      const insertLine = this.database.prepare(
        'INSERT INTO journal_lines (id,journal_entry_id,account_id,line_number,debit_minor,credit_minor,memo) VALUES (?,?,?,?,?,?,?)',
      );
      lines.forEach((line, index) =>
        insertLine.run(
          randomUUID(),
          reversalId,
          line.accountId,
          index + 1,
          line.creditMinor,
          line.debitMinor,
          'Reversal: ' + (line.memo || original.description) + ' — ' + input.reason.trim(),
        ),
      );
      this.database
        .prepare(
          "UPDATE journal_entries SET status='reversed' WHERE id=? AND store_id=? AND status='posted'",
        )
        .run(original.id, this.storeId);
      this.database.exec('RELEASE SAVEPOINT accounting_reverse');
      return reversalId;
    } catch (error) {
      this.database.exec('ROLLBACK TO SAVEPOINT accounting_reverse');
      this.database.exec('RELEASE SAVEPOINT accounting_reverse');
      throw error;
    }
  }

  private nextEntryNumber(): string {
    const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const prefix = 'JE-' + datePart + '-';
    const sequence = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM journal_entries WHERE store_id=? AND entry_number LIKE ?',
      )
      .get(this.storeId, prefix + '%') as { count: number };
    return prefix + String(sequence.count + 1).padStart(4, '0');
  }

  private isValidDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    sourceType:
      'sale' | 'sale_return' | 'purchase_receipt' | 'purchase_return' | 'supplier_payment';
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
