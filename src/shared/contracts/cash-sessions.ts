import { z } from 'zod';

export const OpenCashierSessionSchema = z.object({
  openingFloatMinor: z.number().int().min(0).max(9_000_000_000_000),
  openingNote: z.string().trim().max(500).default(''),
});
export const CashMovementInputSchema = z.object({
  movementType: z.enum(['cash_in', 'cash_out']),
  amountMinor: z.number().int().min(1).max(9_000_000_000_000),
  reason: z.string().trim().min(3).max(500),
});
export const CloseCashierSessionSchema = z.object({
  countedCashMinor: z.number().int().min(0).max(9_000_000_000_000),
  closingNote: z.string().trim().max(500).default(''),
});
export const CashSessionSchema = z.object({
  id: z.string().uuid(),
  counterId: z.string().uuid(),
  openedByUserId: z.string().uuid(),
  openedByName: z.string(),
  status: z.enum(['open', 'closed']),
  openingFloatMinor: z.number().int().nonnegative(),
  expectedCashMinor: z.number().int(),
  countedCashMinor: z.number().int().nonnegative().nullable(),
  varianceMinor: z.number().int().nullable(),
  cashSalesMinor: z.number().int(),
  cashRefundsMinor: z.number().int(),
  cashInMinor: z.number().int(),
  cashOutMinor: z.number().int(),
  openingNote: z.string(),
  closingNote: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type OpenCashierSessionInput = z.infer<typeof OpenCashierSessionSchema>;
export type CashMovementInput = z.infer<typeof CashMovementInputSchema>;
export type CloseCashierSessionInput = z.infer<typeof CloseCashierSessionSchema>;
export type CashSession = z.infer<typeof CashSessionSchema>;
export interface CashSessionsApi {
  getActiveCashierSession(): Promise<CashSession | null>;
  openCashierSession(input: OpenCashierSessionInput): Promise<CashSession>;
  recordCashMovement(input: CashMovementInput): Promise<CashSession>;
  closeCashierSession(input: CloseCashierSessionInput): Promise<CashSession>;
  listCashierSessions(): Promise<CashSession[]>;
}
