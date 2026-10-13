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
  debitMinor: z.number().int().nonnegative(),
  creditMinor: z.number().int().nonnegative(),
});
export type AccountingAccount = z.infer<typeof AccountingAccountSchema>;
export type JournalSummary = z.infer<typeof JournalSummarySchema>;
export interface AccountingApi {
  listAccountingAccounts(): Promise<AccountingAccount[]>;
  listAccountingJournals(): Promise<JournalSummary[]>;
}
