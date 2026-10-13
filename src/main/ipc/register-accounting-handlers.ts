import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  IncomeStatementRequestSchema,
  ManualJournalInputSchema,
  ReverseManualJournalInputSchema,
} from '../../shared/contracts/accounting';
import { AccountingService } from '../accounting/accounting-service';
import { getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { requirePermission } from '../auth/auth-service';

const channels = [
  'accounting:list-accounts',
  'accounting:list-journals',
  'accounting:get-trial-balance',
  'accounting:get-income-statement',
  'accounting:get-balance-sheet',
  'accounting:get-cash-movement-statement',
  'accounting:get-indirect-cash-flow-statement',
  'accounting:post-manual-journal',
  'accounting:reverse-manual-journal',
] as const;
function service(): AccountingService {
  const database = getLocalDatabaseConnection();
  const actor = requirePermission(database, 'accounting.view');
  return new AccountingService(database, getLocalStoreId(), actor.userId);
}
export function registerAccountingIpcHandlers(): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('accounting:list-accounts', () => service().listAccounts());
  ipcMain.handle('accounting:list-journals', () => service().listRecentJournals(100));
  ipcMain.handle('accounting:get-trial-balance', (_event, input: unknown) => {
    const parsed = z.string().safeParse(input);
    if (!parsed.success) throw new Error('Trial balance date is invalid.');
    return service().listTrialBalance(parsed.data);
  });
  ipcMain.handle('accounting:get-income-statement', (_event, input: unknown) => {
    const parsed = IncomeStatementRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('Income statement date range is invalid.');
    return service().getIncomeStatement(parsed.data.startDate, parsed.data.endDate);
  });
  ipcMain.handle('accounting:get-balance-sheet', (_event, input: unknown) => {
    const parsed = z.string().safeParse(input);
    if (!parsed.success) throw new Error('Balance sheet date is invalid.');
    return service().getBalanceSheet(parsed.data);
  });
  ipcMain.handle('accounting:get-indirect-cash-flow-statement', (_event, input: unknown) => {
    const parsed = IncomeStatementRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('Indirect cash flow statement date range is invalid.');
    return service().getIndirectCashFlowStatement(parsed.data.startDate, parsed.data.endDate);
  });
  ipcMain.handle('accounting:get-cash-movement-statement', (_event, input: unknown) => {
    const parsed = IncomeStatementRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('Cash movement statement date range is invalid.');
    return service().getCashMovementStatement(parsed.data.startDate, parsed.data.endDate);
  });
  ipcMain.handle('accounting:post-manual-journal', (_event, input: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'accounting.manage');
    const parsed = ManualJournalInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(
        'Manual journal is invalid: ' +
          parsed.error.issues.map((issue) => issue.message).join('; '),
      );
    return new AccountingService(database, getLocalStoreId(), actor.userId).postManualJournal(
      parsed.data,
    );
  });
  ipcMain.handle('accounting:reverse-manual-journal', (_event, input: unknown) => {
    const database = getLocalDatabaseConnection();
    const actor = requirePermission(database, 'accounting.manage');
    const parsed = ReverseManualJournalInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Error(
        'Manual journal reversal is invalid: ' +
          parsed.error.issues.map((issue) => issue.message).join('; '),
      );
    return new AccountingService(database, getLocalStoreId(), actor.userId).reverseManualJournal(
      parsed.data,
    );
  });
}
