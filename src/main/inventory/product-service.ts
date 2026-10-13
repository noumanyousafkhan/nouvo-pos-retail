import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ProductIdPayloadSchema,
  ProductInputSchema,
  ProductListQuerySchema,
  type Product,
  type ProductInput,
} from '../../shared/contracts/products';
import { runInTransaction } from '../database/connection';
import { ProductRepository } from './product-repository';

export class ProductService {
  private readonly repository: ProductRepository;

  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
  ) {
    this.repository = new ProductRepository(database);
  }

  list(rawQuery: unknown = {}): Product[] {
    const query = ProductListQuerySchema.parse(rawQuery);
    return this.repository.list(this.storeId, query.search, query.includeArchived);
  }

  save(rawInput: unknown): Product {
    const input = ProductInputSchema.parse(rawInput);
    const normalizedBarcodes = input.barcodes.map((barcode) => barcode.trim());
    if (new Set(normalizedBarcodes).size !== normalizedBarcodes.length) {
      throw new Error('A barcode was entered more than once for this product.');
    }
    const normalized: ProductInput = { ...input, barcodes: normalizedBarcodes };
    const id = input.id ?? randomUUID();

    try {
      return runInTransaction(this.database, () => {
        const before = input.id ? this.repository.findById(this.storeId, input.id) : null;
        if (input.id && !before)
          throw new Error('Product was not found. Refresh the list and try again.');
        if (before && before.baseUnit !== input.baseUnit) {
          const hasStockHistory = this.database
            .prepare('SELECT 1 AS found FROM stock_movements WHERE product_id = ? LIMIT 1')
            .get(before.id);
          const hasSaleHistory = this.database
            .prepare('SELECT 1 AS found FROM sale_lines WHERE product_id = ? LIMIT 1')
            .get(before.id);
          if (hasStockHistory || hasSaleHistory) {
            throw new Error(
              'Base unit cannot be changed after stock movements or sales exist for this product. Use a controlled unit-conversion workflow.',
            );
          }
        }

        let categoryId: string | null = null;
        if (input.categoryName) {
          const existingCategory = this.database
            .prepare('SELECT id FROM categories WHERE store_id = ? AND name = ? COLLATE NOCASE')
            .get(this.storeId, input.categoryName) as { id: string } | undefined;
          categoryId = existingCategory?.id ?? randomUUID();
          if (!existingCategory) {
            this.database
              .prepare('INSERT INTO categories (id, store_id, name) VALUES (?, ?, ?)')
              .run(categoryId, this.storeId, input.categoryName);
          }
        }

        const after = this.repository.save(this.storeId, normalized, id, categoryId);
        this.database
          .prepare(
            `INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, 'product', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            this.storeId,
            before ? 'product.updated' : 'product.created',
            after.id,
            before ? JSON.stringify(before) : null,
            JSON.stringify(after),
          );
        return after;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: products\.store_id, products\.sku/.test(error.message)
      ) {
        throw new Error('This SKU is already used by another product.', { cause: error });
      }
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: product_barcodes\.barcode/.test(error.message)
      ) {
        throw new Error('One of these barcodes is already assigned to another product.', {
          cause: error,
        });
      }
      throw error;
    }
  }

  archive(rawPayload: unknown, reason?: unknown): void {
    const { id } = ProductIdPayloadSchema.parse(rawPayload);
    const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    runInTransaction(this.database, () => {
      const before = this.repository.findById(this.storeId, id);
      if (!before) throw new Error('Product was not found or is already archived.');
      this.repository.archive(this.storeId, id);
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, 'product.archived', 'product', ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          id,
          JSON.stringify(before),
          JSON.stringify({ ...before, isActive: false }),
          safeReason || null,
        );
    });
  }
}
