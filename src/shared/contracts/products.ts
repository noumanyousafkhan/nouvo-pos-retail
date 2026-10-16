import { z } from 'zod';
import type { StockApi } from './stock';
import type { CheckoutApi } from './checkout';
import type { SalesApi } from './sales';
import type { SettingsApi } from './settings';
import type { BackupApi } from './backup';

export const ProductIdSchema = z.string().uuid();
const barcodeSchema = z.string().trim().min(1).max(80);

export const ProductInputSchema = z.object({
  id: ProductIdSchema.optional(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000).default(''),
  categoryName: z.string().trim().max(100).default(''),
  sku: z.string().trim().max(80).default(''),
  barcodes: z.array(barcodeSchema).max(20).default([]),
  baseUnit: z.string().trim().min(1).max(32).default('piece'),
  packSize: z.number().int().min(1).max(1000).default(1),
  singleUnitName: z.string().trim().min(1).max(32).default('unit'),
  singleSellingPriceMinor: z.number().int().min(0).max(9_000_000_000_000).nullable().default(null),
  purchaseCostMinor: z.number().int().min(0).max(9_000_000_000_000),
  sellingPriceMinor: z.number().int().min(0).max(9_000_000_000_000),
  taxRateBasisPoints: z.number().int().min(0).max(10000).default(0),
});

export const ProductSchema = z.object({
  id: ProductIdSchema,
  name: z.string(),
  description: z.string(),
  categoryName: z.string(),
  sku: z.string().nullable(),
  barcodes: z.array(z.string()),
  baseUnit: z.string(),
  packSize: z.number().int().min(1).max(1000).default(1),
  singleUnitName: z.string().trim().min(1).max(32).default('unit'),
  singleSellingPriceMinor: z.number().int().nullable().default(null),
  purchaseCostMinor: z.number().int(),
  sellingPriceMinor: z.number().int(),
  taxRateBasisPoints: z.number().int(),
  isActive: z.boolean(),
  stockOnHandMilli: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProductListQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  includeArchived: z.boolean().default(false),
});

export const ProductIdPayloadSchema = z.object({ id: ProductIdSchema });
export const ProductListSchema = z.array(ProductSchema);
export type ProductInput = z.infer<typeof ProductInputSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export interface ProductApi extends StockApi, CheckoutApi, SalesApi, SettingsApi, BackupApi {
  listProducts(query?: Partial<ProductListQuery>): Promise<Product[]>;
  saveProduct(input: ProductInput): Promise<Product>;
  archiveProduct(id: string, reason?: string): Promise<void>;
  deleteProduct(id: string, reason?: string): Promise<void>;
}
