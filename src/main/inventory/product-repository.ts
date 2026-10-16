import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Product, ProductInput } from '../../shared/contracts/products';

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  sku: string | null;
  barcodes: string | null;
  baseUnit: string;
  packSize: number;
  singleUnitName: string;
  singleSellingPriceMinor: number | null;
  purchaseCostMinor: number;
  sellingPriceMinor: number;
  taxRateBasisPoints: number;
  isActive: number;
  stockOnHandMilli: number;
  createdAt: string;
  updatedAt: string;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    categoryName: row.categoryName ?? '',
    sku: row.sku,
    barcodes: row.barcodes ? row.barcodes.split('\u001f') : [],
    baseUnit: row.baseUnit,
    packSize: row.packSize,
    singleUnitName: row.singleUnitName,
    singleSellingPriceMinor: row.singleSellingPriceMinor,
    purchaseCostMinor: row.purchaseCostMinor,
    sellingPriceMinor: row.sellingPriceMinor,
    taxRateBasisPoints: row.taxRateBasisPoints,
    isActive: row.isActive === 1,
    stockOnHandMilli: row.stockOnHandMilli,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const productSelect = `
  SELECT p.id, p.name, p.description, c.name AS categoryName, p.sku,
         (SELECT group_concat(barcode, char(31)) FROM product_barcodes pb WHERE pb.product_id = p.id) AS barcodes,
         p.base_unit AS baseUnit, p.pack_size AS packSize, p.single_unit_name AS singleUnitName, p.single_selling_price_minor AS singleSellingPriceMinor,
         p.purchase_cost_minor AS purchaseCostMinor, p.selling_price_minor AS sellingPriceMinor, p.tax_rate_basis_points AS taxRateBasisPoints,
         p.is_active AS isActive,
         COALESCE((SELECT SUM(sm.quantity_delta_milli) FROM stock_movements sm WHERE sm.product_id = p.id AND sm.counter_id = ?), 0) AS stockOnHandMilli,
         p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
`;

export class ProductRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly counterId: string,
  ) {}

  list(storeId: string, search: string, includeArchived: boolean): Product[] {
    const conditions = ['p.store_id = ?'];
    const params: (string | number)[] = [this.counterId, storeId];
    if (!includeArchived) conditions.push('p.is_active = 1');
    if (search) {
      conditions.push(`(p.name LIKE ? ESCAPE '\\' OR COALESCE(p.sku, '') LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM product_barcodes pb2 WHERE pb2.product_id = p.id AND pb2.barcode LIKE ? ESCAPE '\\'
      ))`);
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    const rows = this.database
      .prepare(
        `${productSelect} WHERE ${conditions.join(' AND ')} ORDER BY p.name COLLATE NOCASE LIMIT 1000`,
      )
      .all(...params) as unknown as ProductRow[];
    return rows.map(mapProduct);
  }

  findById(storeId: string, id: string): Product | null {
    const row = this.database
      .prepare(`${productSelect} WHERE p.store_id = ? AND p.id = ?`)
      .get(this.counterId, storeId, id) as ProductRow | undefined;
    return row ? mapProduct(row) : null;
  }

  save(storeId: string, input: ProductInput, id: string, categoryId: string | null): Product {
    const now = new Date().toISOString();
    const sku = input.sku || null;
    if (input.id) {
      this.database
        .prepare(
          `UPDATE products SET category_id = ?, sku = ?, name = ?, description = ?, base_unit = ?, pack_size = ?, single_unit_name = ?, single_selling_price_minor = ?, purchase_cost_minor = ?, selling_price_minor = ?, tax_rate_basis_points = ?, updated_at = ? WHERE id = ? AND store_id = ?`,
        )
        .run(
          categoryId,
          sku,
          input.name,
          input.description || null,
          input.baseUnit,
          input.packSize,
          input.singleUnitName,
          input.singleSellingPriceMinor,
          input.purchaseCostMinor,
          input.sellingPriceMinor,
          input.taxRateBasisPoints,
          now,
          input.id,
          storeId,
        );
      this.database.prepare('DELETE FROM product_barcodes WHERE product_id = ?').run(input.id);
    } else {
      this.database
        .prepare(
          `INSERT INTO products (id, store_id, category_id, sku, name, description, base_unit, pack_size, single_unit_name, single_selling_price_minor, purchase_cost_minor, selling_price_minor, tax_rate_basis_points, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          storeId,
          categoryId,
          sku,
          input.name,
          input.description || null,
          input.baseUnit,
          input.packSize,
          input.singleUnitName,
          input.singleSellingPriceMinor,
          input.purchaseCostMinor,
          input.sellingPriceMinor,
          input.taxRateBasisPoints,
          now,
          now,
        );
    }
    const productId = input.id ?? id;
    const insertBarcode = this.database.prepare(
      'INSERT INTO product_barcodes (id, product_id, barcode) VALUES (?, ?, ?)',
    );
    for (const barcode of input.barcodes) insertBarcode.run(randomUUID(), productId, barcode);
    const product = this.findById(storeId, productId);
    if (!product) throw new Error('Saved product could not be reloaded.');
    return product;
  }

  delete(storeId: string, id: string): void {
    this.database.prepare('DELETE FROM product_barcodes WHERE product_id = ?').run(id);
    this.database.prepare('DELETE FROM counter_stock_allocations WHERE product_id = ?').run(id);
    this.database.prepare('DELETE FROM products WHERE store_id = ? AND id = ?').run(storeId, id);
  }

  archive(storeId: string, id: string): void {
    this.database
      .prepare(
        `UPDATE products SET is_active = 0, archived_at = ?, updated_at = ? WHERE store_id = ? AND id = ? AND is_active = 1`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), storeId, id);
  }
}
