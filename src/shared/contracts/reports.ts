import { z } from 'zod';

export const ReportQuerySchema = z
  .object({
    fromDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    toDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
    message: 'Start date must be on or before end date.',
  });

export const SalesReportSchema = z.object({
  fromDate: z.string().nullable(),
  toDate: z.string().nullable(),
  saleCount: z.number().int().nonnegative(),
  subtotalMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  daily: z.array(
    z.object({
      date: z.string(),
      saleCount: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
    }),
  ),
  byPaymentMethod: z.array(
    z.object({
      method: z.string(),
      amountMinor: z.number().int(),
      paymentCount: z.number().int().nonnegative(),
    }),
  ),
  byCategory: z.array(
    z.object({
      categoryName: z.string(),
      saleCount: z.number().int().nonnegative(),
      netSalesMinor: z.number().int().nonnegative(),
      costMinor: z.number().int().nonnegative(),
      grossMarginMinor: z.number().int(),
      costCoveragePercent: z.number().int().min(0).max(100),
    }),
  ),
  byCashier: z.array(
    z.object({
      cashierName: z.string(),
      saleCount: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
    }),
  ),
  topProducts: z.array(
    z.object({
      productName: z.string(),
      quantityMilli: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
    }),
  ),
  inventory: z.object({
    activeProducts: z.number().int().nonnegative(),
    stockedProducts: z.number().int().nonnegative(),
    quantityMilli: z.number().int().nonnegative(),
    estimatedCostValueMinor: z.number().int().nonnegative(),
  }),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
export type SalesReport = z.infer<typeof SalesReportSchema>;
export interface ReportsApi {
  getSalesReport(query?: ReportQuery): Promise<SalesReport>;
}
