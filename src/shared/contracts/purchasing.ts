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
});
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
export type ReceivePurchaseOrderInput = z.infer<typeof ReceivePurchaseOrderSchema>;
export interface PurchasingApi {
  listSuppliers(): Promise<Supplier[]>;
  saveSupplier(input: SupplierInput): Promise<Supplier>;
  listPurchaseOrders(): Promise<PurchaseOrderSummary[]>;
  createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrderSummary>;
  receivePurchaseOrder(input: ReceivePurchaseOrderInput): Promise<PurchaseOrderSummary>;
  cancelPurchaseOrder(id: string): Promise<void>;
}
