import { z } from 'zod';

const PaymentMethodSchema = z.enum(['cash', 'card', 'bank_transfer', 'mobile_wallet', 'other']);
export const ReturnSaleInputSchema = z
  .object({
    saleId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    items: z
      .array(
        z.object({
          saleLineId: z.string().uuid(),
          quantityMilli: z.number().int().min(1).max(9_000_000_000),
        }),
      )
      .min(1)
      .max(500),
    refundPaymentMethod: PaymentMethodSchema,
    refundReference: z.string().trim().max(200).default(''),
  })
  .refine(
    (input) => new Set(input.items.map((line) => line.saleLineId)).size === input.items.length,
    { message: 'A sale line can appear only once per return.' },
  );
export const VoidSaleInputSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  refundPaymentMethod: PaymentMethodSchema,
  refundReference: z.string().trim().max(200).default(''),
});
export const ReturnableSaleLineSchema = z.object({
  saleLineId: z.string().uuid(),
  productName: z.string(),
  unit: z.string(),
  soldQuantityMilli: z.number().int().positive(),
  returnedQuantityMilli: z.number().int().nonnegative(),
  remainingQuantityMilli: z.number().int().nonnegative(),
  remainingRefundMinor: z.number().int().nonnegative(),
});
export const SaleReturnResultSchema = z.object({
  id: z.string().uuid(),
  returnNumber: z.string(),
  saleId: z.string().uuid(),
  originalReceiptNumber: z.string(),
  operation: z.enum(['return', 'void']),
  reason: z.string(),
  currencyCode: z.string(),
  totalMinor: z.number().int().nonnegative(),
  createdAt: z.string(),
  businessName: z.string(),
  businessAddress: z.string(),
  businessPhone: z.string(),
  businessRegistrationNumber: z.string(),
  receiptFooter: z.string(),
  receiptPaperWidthMm: z.union([z.literal(58), z.literal(80)]),
  lines: z.array(
    z.object({
      productName: z.string(),
      unit: z.string(),
      quantityMilli: z.number().int().positive(),
      refundTotalMinor: z.number().int().nonnegative(),
    }),
  ),
  payments: z.array(
    z.object({
      paymentMethod: z.string(),
      amountMinor: z.number().int().positive(),
      reference: z.string(),
    }),
  ),
});
export type ReturnSaleInput = z.infer<typeof ReturnSaleInputSchema>;
export type VoidSaleInput = z.infer<typeof VoidSaleInputSchema>;
export type SaleReturnResult = z.infer<typeof SaleReturnResultSchema>;
export type ReturnableSaleLine = z.infer<typeof ReturnableSaleLineSchema>;
export interface ReturnsApi {
  getReturnableItems(saleId: string): Promise<ReturnableSaleLine[]>;
  returnSale(input: ReturnSaleInput): Promise<SaleReturnResult>;
  voidSale(input: VoidSaleInput): Promise<SaleReturnResult>;
}
