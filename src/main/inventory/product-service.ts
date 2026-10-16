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
    counterId: string,
  ) {
    this.repository = new ProductRepository(database, counterId);
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
    if (input.packSize > 1 && 1000 % input.packSize !== 0) {
      throw new Error(
        'For exact single-unit stock tracking, the pack size must divide 1,000 (for example 10, 20, 25 or 50).',
      );
    }
    if (input.singleSellingPriceMinor !== null && input.packSize < 2) {
      throw new Error(
        'Set a pack size greater than 1 before configuring a single-unit selling price.',
      );
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
        if (before && before.packSize !== input.packSize) {
          const hasSingleSales = this.database
            .prepare(
              "SELECT 1 AS found FROM sale_lines WHERE product_id = ? AND sale_unit_snapshot = 'single' LIMIT 1",
            )
            .get(before.id);
          if (hasSingleSales) {
            throw new Error(
              'Pack size cannot be changed after individual-unit sales exist because those sales use the original conversion. Archive this product and create a new one for a different pack size.',
            );
          }
          if (before.stockOnHandMilli % 1000 !== 0) {
            throw new Error(
              'Pack size cannot be changed while partial packs or individual units remain. Reconcile stock to whole packs first.',
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
        this.database
          .prepare(
            `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, 'product', ?, ?)`,
          )
          .run(
            randomUUID(),
            before ? 'product.updated' : 'product.created',
            after.id,
            JSON.stringify({ schemaVersion: 1, product: after }),
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

  delete(rawPayload: unknown, reason?: unknown): void {
    const { id } = ProductIdPayloadSchema.parse(rawPayload);
    const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    runInTransaction(this.database, () => {
      const before = this.repository.findById(this.storeId, id);
      if (!before) throw new Error('Product was not found. Refresh inventory and try again.');
      const historyChecks: { label: string; sql: string }[] = [
        {
          label: 'stock movements',
          sql: 'SELECT 1 AS found FROM stock_movements WHERE product_id = ? LIMIT 1',
        },
        {
          label: 'sales or returns',
          sql: 'SELECT 1 AS found FROM sale_lines WHERE product_id = ? LIMIT 1',
        },
        {
          label: 'purchase orders',
          sql: 'SELECT 1 AS found FROM purchase_order_lines WHERE product_id = ? LIMIT 1',
        },
        {
          label: 'purchase receipts',
          sql: 'SELECT 1 AS found FROM purchase_receipt_lines WHERE product_id = ? LIMIT 1',
        },
        {
          label: 'purchase returns',
          sql: 'SELECT 1 AS found FROM purchase_return_lines WHERE product_id = ? LIMIT 1',
        },
      ];
      for (const check of historyChecks) {
        if (this.database.prepare(check.sql).get(id)) {
          throw new Error(
            `This product has ${check.label}; archive it instead so financial and audit history stays intact.`,
          );
        }
      }
      if (before.stockOnHandMilli !== 0) {
        throw new Error(
          'This product still has stock. Remove or reconcile its stock before permanent deletion.',
        );
      }
      if (
        this.database
          .prepare(
            "SELECT 1 AS found FROM outbox_events WHERE aggregate_type = 'product' AND aggregate_id = ? AND status IN ('acknowledged', 'in_flight') LIMIT 1",
          )
          .get(id)
      ) {
        throw new Error(
          'This product has synchronized or is being sent to the central system; archive it instead of permanently deleting it.',
        );
      }
      this.database
        .prepare(
          "DELETE FROM outbox_events WHERE aggregate_type = 'product' AND aggregate_id = ? AND status <> 'acknowledged'",
        )
        .run(id);
      this.repository.delete(this.storeId, id);
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, 'product.deleted', 'product', ?, ?, NULL, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          id,
          JSON.stringify(before),
          safeReason || 'Permanently deleted unused product',
        );
    });
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
      this.database
        .prepare(
          `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'product.archived', 'product', ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          JSON.stringify({ schemaVersion: 1, productId: id, archivedAt: new Date().toISOString() }),
        );
    });
  }
}
