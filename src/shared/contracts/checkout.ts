import { z } from 'zod';

export const CheckoutInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityMilli: z.number().int().min(1).max(9_000_000_000),
      }),
    )
    .min(1)
    .max(500),
  paymentLines: z
    .array(
      z.object({
        paymentMethod: z.enum(['cash', 'card', 'bank_transfer', 'mobile_wallet', 'other']),
        amountMinor: z.number().int().min(1).max(9_000_000_000_000),
        amountTenderedMinor: z.number().int().min(0).max(9_000_000_000_000).optional(),
        reference: z.string().trim().max(200).default(''),
      }),
    )
    .min(1)
    .max(10),
});

export const SaleLineResultSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string(),
  productCode: z.string().nullable(),
  unit: z.string(),
  quantityMilli: z.number().int(),
  unitPriceMinor: z.number().int(),
  taxMinor: z.number().int(),
  lineTotalMinor: z.number().int(),
});
export const SalePaymentResultSchema = z.object({
  paymentMethod: z.string(),
  amountMinor: z.number().int(),
  amountTenderedMinor: z.number().int(),
  changeDueMinor: z.number().int(),
  reference: z.string(),
});
export const SaleResultSchema = z.object({
  id: z.string().uuid(),
  receiptNumber: z.string(),
  businessName: z.string(),
  currencyCode: z.string(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  changeDueMinor: z.number().int(),
  completedAt: z.string(),
  lines: z.array(SaleLineResultSchema),
  payments: z.array(SalePaymentResultSchema),
});
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;
export type SaleResult = z.infer<typeof SaleResultSchema>;

export interface CheckoutApi {
  completeSale(input: CheckoutInput): Promise<SaleResult>;
}
