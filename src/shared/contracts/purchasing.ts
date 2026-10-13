import { z } from 'zod';

export const SupplierInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().max(80).default(''),
  email: z
    .string()
    .trim()
    .max(160)
    .default('')
    .refine(
      (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      'Enter a valid supplier email.',
    ),
  address: z.string().trim().max(500).default(''),
  taxNumber: z.string().trim().max(100).default(''),
});
export const SupplierSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string(),
  taxNumber: z.string(),
  isActive: z.boolean(),
});
export const PurchaseOrderInputSchema = z
  .object({
    supplierId: z.string().uuid(),
    notes: z.string().trim().max(1000).default(''),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantityMilli: z.number().int().min(1).max(9_000_000_000),
          unitCostMinor: z.number().int().min(0).max(9_000_000_000_000),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.productId)).size === input.lines.length,
    { message: 'A product can appear only once in a purchase order.' },
  );
export const ReceivePurchaseOrderSchema = z.object({
  id: z.string().uuid(),
  supplierInvoiceNumber: z.string().trim().max(100).default(''),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().uuid(),
        quantityReceivedMilli: z.number().int().min(0).max(9_000_000_000),
      }),
    )
    .max(200)
    .default([])
    .refine(
      (lines) => new Set(lines.map((line) => line.purchaseOrderLineId)).size === lines.length,
      'A purchase-order line can appear only once per receipt.',
    ),
  finalizeOrder: z.boolean().default(true),
  discrepancyReason: z.string().trim().max(500).default(''),
});
export const PurchaseOrderReceivingLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  sku: z.string(),
  quantityOrderedMilli: z.number().int().positive(),
  quantityPreviouslyReceivedMilli: z.number().int().nonnegative(),
  remainingQuantityMilli: z.number().int().nonnegative(),
  unitCostMinor: z.number().int().nonnegative(),
});
export const PurchaseReturnInputSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().uuid(),
        quantityMilli: z.number().int().positive().max(9_000_000_000),
      }),
    )
    .min(1)
    .max(200)
    .refine(
      (lines) => new Set(lines.map((line) => line.purchaseOrderLineId)).size === lines.length,
      'A purchase-order line can appear only once per return.',
    ),
});
export const PurchaseReturnableLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  sku: z.string(),
  quantityReceivedMilli: z.number().int().nonnegative(),
  quantityReturnedMilli: z.number().int().nonnegative(),
  returnableQuantityMilli: z.number().int().nonnegative(),
  unitCostMinor: z.number().int().nonnegative(),
});
export const PurchaseReturnSummarySchema = z.object({
  id: z.string().uuid(),
  returnNumber: z.string(),
  purchaseOrderId: z.string().uuid(),
  orderNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  reason: z.string(),
  totalMinor: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type PurchaseReturnInput = z.infer<typeof PurchaseReturnInputSchema>;
export type PurchaseOrderReceivingLine = z.infer<typeof PurchaseOrderReceivingLineSchema>;
export type PurchaseReturnableLine = z.infer<typeof PurchaseReturnableLineSchema>;
export type PurchaseReturnSummary = z.infer<typeof PurchaseReturnSummarySchema>;
export const SupplierPaymentInputSchema = z
  .object({
    purchaseOrderId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(9_000_000_000_000),
    paymentMethod: z.enum(['cash', 'bank', 'mobile', 'card', 'other']),
    reference: z.string().trim().max(160).default(''),
    notes: z.string().trim().max(500).default(''),
  })
  .strict();
export const SupplierBalanceSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  orderNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  supplierInvoiceNumber: z.string(),
  receivedAt: z.string(),
  originalAmountMinor: z.number().int().nonnegative(),
  returnedAmountMinor: z.number().int().nonnegative(),
  paidAmountMinor: z.number().int().nonnegative(),
  outstandingMinor: z.number().int(),
  ageDays: z.number().int().nonnegative(),
  agingBucket: z.enum(['0-30 days', '31-60 days', '61-90 days', '90+ days']),
});
export const SupplierPaymentSummarySchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
  purchaseOrderId: z.string().uuid(),
  orderNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  amountMinor: z.number().int().positive(),
  paymentMethod: z.enum(['cash', 'bank', 'mobile', 'card', 'other']),
  reference: z.string(),
  notes: z.string(),
  createdAt: z.string(),
});
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentInputSchema>;
export type SupplierBalance = z.infer<typeof SupplierBalanceSchema>;
export type SupplierPaymentSummary = z.infer<typeof SupplierPaymentSummarySchema>;
export const PurchaseOrderSummarySchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  supplierInvoiceNumber: z.string(),
  status: z.enum(['draft', 'received', 'cancelled']),
  notes: z.string(),
  subtotalMinor: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  orderedAt: z.string(),
  receivedAt: z.string().nullable(),
});
export type SupplierInput = z.infer<typeof SupplierInputSchema>;
export type Supplier = z.infer<typeof SupplierSchema>;
export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInputSchema>;
export type PurchaseOrderSummary = z.infer<typeof PurchaseOrderSummarySchema>;
export type ReceivePurchaseOrderInput = z.input<typeof ReceivePurchaseOrderSchema>;
export interface PurchasingApi {
  listSuppliers(): Promise<Supplier[]>;
  saveSupplier(input: SupplierInput): Promise<Supplier>;
  listPurchaseOrders(): Promise<PurchaseOrderSummary[]>;
  createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrderSummary>;
  listPurchaseOrderReceivingLines(orderId: string): Promise<PurchaseOrderReceivingLine[]>;
  receivePurchaseOrder(input: ReceivePurchaseOrderInput): Promise<PurchaseOrderSummary>;
  cancelPurchaseOrder(id: string): Promise<void>;
  listReturnablePurchaseOrderLines(orderId: string): Promise<PurchaseReturnableLine[]>;
  createPurchaseReturn(input: PurchaseReturnInput): Promise<PurchaseReturnSummary>;
  listPurchaseReturns(): Promise<PurchaseReturnSummary[]>;
  listSupplierBalances(): Promise<SupplierBalance[]>;
  createSupplierPayment(input: SupplierPaymentInput): Promise<SupplierPaymentSummary>;
  listSupplierPayments(): Promise<SupplierPaymentSummary[]>;
}
