import { z } from 'zod';
import type { SaleResult } from './checkout';

export const SalesListQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export const SaleListItemSchema = z.object({
  id: z.string().uuid(),
  receiptNumber: z.string(),
  businessName: z.string(),
  currencyCode: z.string(),
  totalMinor: z.number().int(),
  status: z.enum(['draft', 'completed', 'voided', 'partially_returned', 'returned']),
  completedAt: z.string(),
  itemCount: z.number().int().nonnegative(),
  paymentMethods: z.array(z.string()),
});
export const SaleListSchema = z.array(SaleListItemSchema);
export type SalesListQuery = z.infer<typeof SalesListQuerySchema>;
export type SaleListItem = z.infer<typeof SaleListItemSchema>;

export interface SalesApi {
  listSales(query?: Partial<SalesListQuery>): Promise<SaleListItem[]>;
  getSale(id: string): Promise<SaleResult>;
}
