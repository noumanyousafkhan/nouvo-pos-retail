import { z } from 'zod';

export const StockMovementInputSchema = z.object({
  productId: z.string().uuid(),
  movementType: z.enum(['receipt', 'adjustment', 'write_off']),
  quantityMilli: z
    .number()
    .int()
    .min(-9_000_000_000)
    .max(9_000_000_000)
    .refine((value) => value !== 0),
  unitCostMinor: z.number().int().min(0).max(9_000_000_000_000).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const StockSummarySchema = z.object({
  productId: z.string().uuid(),
  quantityMilli: z.number().int(),
  movementCount: z.number().int().nonnegative(),
});
export type StockMovementInput = z.infer<typeof StockMovementInputSchema>;
export type StockSummary = z.infer<typeof StockSummarySchema>;

export interface StockApi {
  recordStockMovement(input: StockMovementInput): Promise<StockSummary>;
}
