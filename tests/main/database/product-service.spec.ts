// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { ProductService } from '../../../src/main/inventory/product-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Test Counter');
  return {
    database,
    storeId,
    counterId,
    service: new ProductService(database.connection, storeId, counterId),
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('product service', () => {
  it('creates and searches a product with barcodes and an audit event', () => {
    const { database, service } = setup();
    const product = service.save({
      name: 'Basmati Rice',
      sku: 'RICE-01',
      categoryName: 'Grocery',
      barcodes: ['1234567890'],
      baseUnit: 'bag',
      purchaseCostMinor: 18000,
      sellingPriceMinor: 25000,
      taxRateBasisPoints: 0,
    });
    expect(product.name).toBe('Basmati Rice');
    expect(product.barcodes).toEqual(['1234567890']);
    expect(product.stockOnHandMilli).toBe(0);
    expect(service.list({ search: 'RICE-01' })).toHaveLength(1);
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ?')
        .get(product.id).count,
    ).toBe(1);
    expect(
      database.connection
        .prepare('SELECT action FROM audit_events WHERE entity_id = ?')
        .get(product.id),
    ).toEqual({ action: 'product.created' });
  });

  it('rejects duplicate SKU and barcode without partial writes', () => {
    const { database, service } = setup();
    const input = {
      name: 'Milk',
      sku: 'MILK-1',
      barcodes: ['0001'],
      purchaseCostMinor: 100,
      sellingPriceMinor: 150,
    };
    service.save(input);
    expect(() => service.save({ ...input, name: 'Milk Duplicate' })).toThrow(
      /SKU is already used/i,
    );
    expect(() => service.save({ ...input, sku: 'MILK-2', name: 'Other Milk' })).toThrow(
      /barcodes? is already assigned/i,
    );
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({
      count: 1,
    });
  });

  it('updates the product and records before/after audit snapshots', () => {
    const { database, service } = setup();
    const original = service.save({
      name: 'Tea',
      sku: 'TEA-1',
      purchaseCostMinor: 100,
      sellingPriceMinor: 200,
    });
    const updated = service.save({
      id: original.id,
      name: 'Tea Premium',
      sku: 'TEA-1',
      purchaseCostMinor: 120,
      sellingPriceMinor: 250,
    });
    expect(updated.name).toBe('Tea Premium');
    expect(
      database.connection
        .prepare('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at, rowid')
        .all(original.id),
    ).toEqual([{ action: 'product.created' }, { action: 'product.updated' }]);
  });

  it('archives instead of deleting a product and preserves the row', () => {
    const { database, service } = setup();
    const product = service.save({
      name: 'Archived Item',
      purchaseCostMinor: 10,
      sellingPriceMinor: 20,
    });
    service.archive({ id: product.id }, 'Discontinued');
    expect(service.list()).toHaveLength(0);
    expect(service.list({ includeArchived: true })[0].isActive).toBe(false);
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM products WHERE id = ?')
        .get(product.id),
    ).toEqual({ count: 1 });
    expect(
      database.connection
        .prepare("SELECT reason FROM audit_events WHERE action = 'product.archived'")
        .get(),
    ).toEqual({ reason: 'Discontinued' });
  });

  it('blocks base-unit changes once stock movement history exists', () => {
    const { database, storeId, service } = setup();
    const product = service.save({
      name: 'Bulk Flour',
      baseUnit: 'kg',
      purchaseCostMinor: 100,
      sellingPriceMinor: 150,
    });
    database.connection
      .prepare(
        `INSERT INTO stock_movements (id, store_id, product_id, movement_type, quantity_delta_milli) VALUES (?, ?, ?, 'opening', 1000)`,
      )
      .run(randomUUID(), storeId, product.id);
    expect(() =>
      service.save({
        id: product.id,
        name: product.name,
        baseUnit: 'bag',
        purchaseCostMinor: 100,
        sellingPriceMinor: 150,
      }),
    ).toThrow(/base unit cannot be changed/i);
  });

  it('rolls back category and product writes when a barcode conflict occurs', () => {
    const { database, service } = setup();
    service.save({
      name: 'Existing',
      barcodes: ['777'],
      purchaseCostMinor: 10,
      sellingPriceMinor: 20,
    });
    expect(() =>
      service.save({
        name: 'Broken',
        categoryName: 'Should Roll Back',
        barcodes: ['777'],
        purchaseCostMinor: 10,
        sellingPriceMinor: 20,
      }),
    ).toThrow();
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM categories WHERE name = 'Should Roll Back'")
        .get(),
    ).toEqual({ count: 0 });
    expect(database.connection.isTransaction).toBe(false);
  });
});
