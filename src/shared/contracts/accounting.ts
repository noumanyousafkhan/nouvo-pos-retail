import { z } from 'zod';

export const AccountingAccountSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  accountType: z.string(),
  normalBalance: z.enum(['debit', 'credit']),
  isSystem: z.boolean(),
  isActive: z.boolean(),
});
export const JournalSummarySchema = z.object({
  id: z.string().uuid(),
  entryNumber: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  description: z.string(),
  currencyCode: z.string().length(3),
  postedAt: z.string(),
  status: z.enum(['posted', 'reversed']),
  debitMinor: z.number().int().nonnegative(),
  creditMinor: z.number().int().nonnegative(),
});
export const TrialBalanceRowSchema = z.object({
  accountId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  accountType: z.string(),
  debitBalanceMinor: z.number().int().nonnegative(),
  creditBalanceMinor: z.number().int().nonnegative(),
});
export const IncomeStatementSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  currencyCode: z.string().length(3),
  totalRevenueMinor: z.number().int(),
  totalExpensesMinor: z.number().int(),
  netIncomeMinor: z.number().int(),
});
export const IncomeStatementRequestSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export const BalanceSheetSchema = z.object({
  asOfDate: z.string(),
  currencyCode: z.string().length(3),
  assetsMinor: z.number().int(),
  liabilitiesMinor: z.number().int(),
  equityMinor: z.number().int(),
  balanced: z.boolean(),
});
export const CashMovementStatementSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  currencyCode: z.string().length(3),
  inflowMinor: z.number().int().nonnegative(),
  outflowMinor: z.number().int().nonnegative(),
  netChangeMinor: z.number().int(),
  bySource: z.array(
    z.object({
      sourceType: z.string(),
      inflowMinor: z.number().int().nonnegative(),
      outflowMinor: z.number().int().nonnegative(),
      netChangeMinor: z.number().int(),
    }),
  ),
});
export const ManualJournalLineSchema = z
  .object({
    accountId: z.string().uuid(),
    debitMinor: z.number().int().nonnegative(),
    creditMinor: z.number().int().nonnegative(),
    memo: z.string().trim().max(200).default(''),
  })
  .strict()
  .refine((line) => line.debitMinor > 0 !== line.creditMinor > 0, {
    message: 'Each journal line must contain either a debit or a credit, not both.',
  });
export const ManualJournalInputSchema = z
  .object({
    description: z.string().trim().min(3).max(200),
    lines: z.array(ManualJournalLineSchema).min(2).max(50),
  })
  .strict()
  .superRefine((input, context) => {
    const debit = input.lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const credit = input.lines.reduce((sum, line) => sum + line.creditMinor, 0);
    if (
      !Number.isSafeInteger(debit) ||
      !Number.isSafeInteger(credit) ||
      debit <= 0 ||
      debit !== credit
    )
      context.addIssue({
        code: 'custom',
        message: 'Manual journal debits and credits must be equal and greater than zero.',
        path: ['lines'],
      });
  });
export const ReverseManualJournalInputSchema = z
  .object({
    entryId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type AccountingAccount = z.infer<typeof AccountingAccountSchema>;
export type JournalSummary = z.infer<typeof JournalSummarySchema>;
export type TrialBalanceRow = z.infer<typeof TrialBalanceRowSchema>;
export type IncomeStatement = z.infer<typeof IncomeStatementSchema>;
export type ManualJournalInput = z.infer<typeof ManualJournalInputSchema>;
export type ReverseManualJournalInput = z.infer<typeof ReverseManualJournalInputSchema>;
export interface AccountingApi {
  listAccountingAccounts(): Promise<AccountingAccount[]>;
  listAccountingJournals(): Promise<JournalSummary[]>;
  getAccountingTrialBalance(asOfDate: string): Promise<TrialBalanceRow[]>;
  getAccountingIncomeStatement(input: {
    startDate: string;
    endDate: string;
  }): Promise<IncomeStatement>;
  getAccountingBalanceSheet(asOfDate: string): Promise<z.infer<typeof BalanceSheetSchema>>;
  getAccountingCashMovementStatement(input: {
    startDate: string;
    endDate: string;
  }): Promise<z.infer<typeof CashMovementStatementSchema>>;
  postManualAccountingJournal(input: ManualJournalInput): Promise<string>;
  reverseManualAccountingJournal(input: ReverseManualJournalInput): Promise<string>;
}
