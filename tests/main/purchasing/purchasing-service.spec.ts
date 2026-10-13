// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { StockService } from '../../../src/main/inventory/stock-service';
import { PurchasingService } from '../../../src/main/purchasing/purchasing-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  const counterId = randomUUID();
  const actorId = randomUUID();
  const productId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  database.connection
    .prepare(
      "INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, 'owner.test', 'Owner Test', 'test-hash', 'owner')",
    )
    .run(actorId, storeId);
  database.connection
    .prepare(
      'INSERT INTO products (id, store_id, sku, name, base_unit, purchase_cost_minor, selling_price_minor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(productId, storeId, 'RICE-1', 'Rice 1kg', 'piece', 500, 1000);
  const service = new PurchasingService(database.connection, storeId, counterId, actorId);
  return { database, storeId, counterId, actorId, productId, service };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('purchasing service', () => {
  it('creates a supplier and draft order without changing stock until receiving', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods', phone: '03001234567' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      notes: 'Deliver in the morning',
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    expect(order).toMatchObject({
      supplierName: 'Wholesale Foods',
      status: 'draft',
      lineCount: 1,
      subtotalMinor: 1600,
    });
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    expect(service.listPurchaseOrders()).toHaveLength(1);
  });

  it('receives goods atomically, updates stock and moving weighted-average cost, and prevents double receiving', () => {
    const { database, storeId, counterId, productId, service } = setup();
    new StockService(database.connection, storeId, counterId).record({
      productId,
      movementType: 'receipt',
      quantityMilli: 5000,
      unitCostMinor: 500,
      reason: 'Opening stock',
    });
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    const received = service.receivePurchaseOrder({
      id: order.id,
      supplierInvoiceNumber: 'INV-2026-001',
    });
    expect(received).toMatchObject({ status: 'received', supplierInvoiceNumber: 'INV-2026-001' });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 7000 });
    expect(
      database.connection
        .prepare('SELECT purchase_cost_minor FROM products WHERE id = ?')
        .get(productId),
    ).toEqual({ purchase_cost_minor: 586 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'purchase_order.received'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type = 'purchase_order.received'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(() => service.receivePurchaseOrder({ id: order.id })).toThrow(/only draft/i);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'purchase_order'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('reconciles supplier invoice totals and requires an explanation for a variance', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Invoice Reconciliation Supplier' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    expect(() =>
      service.receivePurchaseOrder({
        id: order.id,
        supplierInvoiceNumber: 'INV-MISMATCH',
        supplierInvoiceTotalMinor: 1800,
      }),
    ).toThrow(/variance reason/i);
    expect(
      database.connection.prepare('SELECT status FROM purchase_orders WHERE id=?').get(order.id),
    ).toEqual({ status: 'draft' });
    const received = service.receivePurchaseOrder({
      id: order.id,
      supplierInvoiceNumber: 'INV-MISMATCH',
      supplierInvoiceTotalMinor: 1800,
      supplierInvoiceVarianceReason: 'Supplier added freight charge',
    });
    expect(received).toMatchObject({
      status: 'received',
      supplierInvoiceTotalMinor: 1800,
      supplierInvoiceVarianceMinor: 200,
      supplierInvoiceVarianceReason: 'Supplier added freight charge',
      supplierInvoiceReconciliationStatus: 'variance_explained',
    });
    const matchedOrder = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 1000, unitCostMinor: 800 }],
    });
    const matched = service.receivePurchaseOrder({
      id: matchedOrder.id,
      supplierInvoiceNumber: 'INV-MATCH',
      supplierInvoiceTotalMinor: 800,
    });
    expect(matched).toMatchObject({
      supplierInvoiceVarianceMinor: 0,
      supplierInvoiceReconciliationStatus: 'matched',
    });
  });

  it('supports multiple partial receipts and finalizes a short delivery using actual received value', () => {
    const { database, storeId, counterId, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Partial Delivery Supplier' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 4000, unitCostMinor: 800 }],
    });
    const line = service.listPurchaseOrderReceivingLines(order.id)[0]!;
    expect(line).toMatchObject({
      quantityOrderedMilli: 4000,
      quantityPreviouslyReceivedMilli: 0,
      remainingQuantityMilli: 4000,
    });

    const first = service.receivePurchaseOrder({
      id: order.id,
      lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityReceivedMilli: 1500 }],
      finalizeOrder: false,
    });
    expect(first.status).toBe('draft');
    expect(service.listPurchaseOrderReceivingLines(order.id)[0]).toMatchObject({
      quantityPreviouslyReceivedMilli: 1500,
      remainingQuantityMilli: 2500,
    });
    expect(service.listSupplierBalances()).toHaveLength(0);

    service.receivePurchaseOrder({
      id: order.id,
      lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityReceivedMilli: 1000 }],
      finalizeOrder: false,
    });
    const finalized = service.receivePurchaseOrder({
      id: order.id,
      lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityReceivedMilli: 1000 }],
      finalizeOrder: true,
      discrepancyReason: 'Supplier delivered 500 fewer units than ordered.',
    });
    expect(finalized.status).toBe('received');
    expect(
      database.connection
        .prepare(
          'SELECT received_subtotal_minor,receipt_discrepancy_note,receipt_discrepancy_json FROM purchase_orders WHERE id=?',
        )
        .get(order.id),
    ).toMatchObject({
      received_subtotal_minor: 2800,
      receipt_discrepancy_note: 'Supplier delivered 500 fewer units than ordered.',
      receipt_discrepancy_json: JSON.stringify([
        { purchaseOrderLineId: line.purchaseOrderLineId, productId, quantityShortMilli: 500 },
      ]),
    });
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM purchase_receipts WHERE purchase_order_id=?')
        .get(order.id),
    ).toEqual({ count: 3 });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id=? AND counter_id=?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 3500 });
    expect(service.listSupplierBalances()[0]).toMatchObject({
      originalAmountMinor: 2800,
      outstandingMinor: 2800,
    });
    expect(
      database.connection
        .prepare(
          "SELECT SUM(jl.debit_minor) AS debit,SUM(jl.credit_minor) AS credit FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id WHERE je.source_type='purchase_receipt' AND je.source_id=?",
        )
        .get(order.id),
    ).toEqual({ debit: 2800, credit: 2800 });
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects over-receiving a purchase line without creating a receipt or stock movement', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Strict Quantity Supplier' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    const line = service.listPurchaseOrderReceivingLines(order.id)[0]!;
    expect(() =>
      service.receivePurchaseOrder({
        id: order.id,
        lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityReceivedMilli: 2001 }],
        finalizeOrder: false,
      }),
    ).toThrow(/cannot exceed/i);
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM purchase_receipts').get(),
    ).toEqual({ count: 0 });
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
  });

  it('posts supplier returns atomically, reduces stock and posts a balanced payable/inventory journal', () => {
    const { database, storeId, counterId, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    const received = service.receivePurchaseOrder({
      id: order.id,
      supplierInvoiceNumber: 'SUP-RET-1',
    });
    expect(received.status).toBe('received');
    const returnable = service.listReturnablePurchaseOrderLines(order.id);
    expect(returnable[0]).toMatchObject({
      quantityReceivedMilli: 2000,
      quantityReturnedMilli: 0,
      returnableQuantityMilli: 2000,
    });
    const purchaseReturn = service.createPurchaseReturn({
      purchaseOrderId: order.id,
      reason: 'Damaged packaging',
      lines: [{ purchaseOrderLineId: returnable[0]!.purchaseOrderLineId, quantityMilli: 1000 }],
    });
    expect(purchaseReturn).toMatchObject({
      orderNumber: order.orderNumber,
      supplierName: 'Wholesale Foods',
      totalMinor: 800,
      lineCount: 1,
    });
    expect(service.listSupplierBalances()[0]).toMatchObject({
      originalAmountMinor: 1600,
      returnedAmountMinor: 800,
      paidAmountMinor: 0,
      outstandingMinor: 800,
    });
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_delta_milli) AS quantity FROM stock_movements WHERE product_id=? AND counter_id=?',
        )
        .get(productId, counterId),
    ).toEqual({ quantity: 1000 });
    expect(
      database.connection
        .prepare(
          "SELECT source_type AS sourceType, SUM(jl.debit_minor) AS debit, SUM(jl.credit_minor) AS credit FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id WHERE je.store_id=? AND je.source_type='purchase_return' AND je.source_id=? GROUP BY je.id",
        )
        .get(storeId, purchaseReturn.id),
    ).toMatchObject({ sourceType: 'purchase_return', debit: 800, credit: 800 });
    expect(service.listReturnablePurchaseOrderLines(order.id)[0]).toMatchObject({
      quantityReturnedMilli: 1000,
      returnableQuantityMilli: 1000,
    });
    expect(service.listPurchaseReturns()).toHaveLength(1);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type='purchase.return.created'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('rejects supplier returns beyond current stock or the remaining received quantity without partial writes', () => {
    const { database, storeId, counterId, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    service.receivePurchaseOrder({ id: order.id });
    database.connection
      .prepare(
        "INSERT INTO stock_movements (id,store_id,counter_id,product_id,movement_type,quantity_delta_milli,reference_type,reference_id,reason,actor_user_id) VALUES (?, ?, ?, ?, 'sale', -1500, 'sale', ?, 'Test sold stock', ?)",
      )
      .run(randomUUID(), storeId, counterId, productId, randomUUID(), null);
    const line = service.listReturnablePurchaseOrderLines(order.id)[0]!;
    expect(line.returnableQuantityMilli).toBe(500);
    expect(() =>
      service.createPurchaseReturn({
        purchaseOrderId: order.id,
        reason: 'Damaged packaging',
        lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityMilli: 1000 }],
      }),
    ).toThrow(/current stock allow/i);
    expect(service.listPurchaseReturns()).toHaveLength(0);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type='purchase_return'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('settles supplier invoices with partial payments, aging balances and balanced accounting journals', () => {
    const { database, storeId, counterId, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 800 }],
    });
    service.receivePurchaseOrder({ id: order.id, supplierInvoiceNumber: 'SUP-PAY-1' });
    const balance = service.listSupplierBalances()[0]!;
    expect(balance).toMatchObject({
      purchaseOrderId: order.id,
      originalAmountMinor: 1600,
      returnedAmountMinor: 0,
      paidAmountMinor: 0,
      outstandingMinor: 1600,
      agingBucket: '0-30 days',
    });
    expect(() =>
      service.createSupplierPayment({
        purchaseOrderId: order.id,
        amountMinor: 1601,
        paymentMethod: 'cash',
      }),
    ).toThrow(/cannot exceed/i);
    const first = service.createSupplierPayment({
      purchaseOrderId: order.id,
      amountMinor: 500,
      paymentMethod: 'cash',
      reference: 'CASH-1',
    });
    expect(first).toMatchObject({ orderNumber: order.orderNumber, amountMinor: 500 });
    expect(service.listSupplierBalances()[0]).toMatchObject({
      paidAmountMinor: 500,
      outstandingMinor: 1100,
    });
    const second = service.createSupplierPayment({
      purchaseOrderId: order.id,
      amountMinor: 1100,
      paymentMethod: 'bank',
      reference: 'BANK-1',
    });
    expect(service.listSupplierBalances()[0]).toMatchObject({
      paidAmountMinor: 1600,
      outstandingMinor: 0,
    });
    expect(service.listSupplierPayments()).toHaveLength(2);
    for (const payment of [first, second]) {
      expect(
        database.connection
          .prepare(
            "SELECT je.source_type AS sourceType,SUM(jl.debit_minor) AS debit,SUM(jl.credit_minor) AS credit FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id WHERE je.store_id=? AND je.source_type='supplier_payment' AND je.source_id=? GROUP BY je.id",
          )
          .get(storeId, payment.id),
      ).toMatchObject({
        sourceType: 'supplier_payment',
        debit: payment.amountMinor,
        credit: payment.amountMinor,
      });
    }
    expect(
      database.connection
        .prepare(
          'SELECT COUNT(*) AS count FROM supplier_payments WHERE counter_id=? AND id IN (?,?)',
        )
        .get(counterId, first.id, second.id),
    ).toEqual({ count: 2 });
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM outbox_events WHERE event_type='supplier.payment.created' AND aggregate_id IN (?,?)",
        )
        .get(first.id, second.id),
    ).toEqual({ count: 2 });
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('prevents cancelling an order after any goods have been partially received', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Partial Cancel Supplier' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 2000, unitCostMinor: 0 }],
    });
    const line = service.listPurchaseOrderReceivingLines(order.id)[0]!;
    service.receivePurchaseOrder({
      id: order.id,
      lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantityReceivedMilli: 1000 }],
      finalizeOrder: false,
    });
    expect(() => service.cancelPurchaseOrder(order.id)).toThrow(
      /received goods cannot be cancelled/i,
    );
    expect(service.listPurchaseOrders()[0]?.status).toBe('draft');
    expect(
      database.connection
        .prepare(
          'SELECT SUM(quantity_received_milli) AS quantity FROM purchase_order_lines WHERE purchase_order_id=?',
        )
        .get(order.id),
    ).toEqual({ quantity: 1000 });
  });

  it('cancels only draft orders and does not create stock movements', () => {
    const { database, productId, service } = setup();
    const supplier = service.saveSupplier({ name: 'Wholesale Foods' });
    const order = service.createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId, quantityMilli: 1000, unitCostMinor: 500 }],
    });
    service.cancelPurchaseOrder(order.id);
    expect(service.listPurchaseOrders()[0].status).toBe('cancelled');
    expect(
      database.connection.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    expect(() => service.cancelPurchaseOrder(order.id)).toThrow(/only draft/i);
  });
});
