import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  PurchaseOrderInputSchema,
  PurchaseOrderSummarySchema,
  PurchaseOrderReceivingLineSchema,
  PurchaseReturnInputSchema,
  PurchaseReturnSummarySchema,
  PurchaseReturnableLineSchema,
  SupplierBalanceSchema,
  SupplierPaymentInputSchema,
  SupplierPaymentSummarySchema,
  ReceivePurchaseOrderSchema,
  SupplierInputSchema,
  SupplierSchema,
  type PurchaseOrderSummary,
  type PurchaseOrderReceivingLine,
  type PurchaseReturnInput,
  type PurchaseReturnSummary,
  type PurchaseReturnableLine,
  type SupplierBalance,
  type SupplierPaymentInput,
  type SupplierPaymentSummary,
  type Supplier,
} from '../../shared/contracts/purchasing';
import { runInTransaction } from '../database/connection';
import { AccountingService } from '../accounting/accounting-service';
import { ProductRepository } from '../inventory/product-repository';

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  is_active: number;
}
interface OrderRow {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  status: 'draft' | 'received' | 'cancelled';
  notes: string | null;
  subtotal_minor: number;
  line_count: number;
  ordered_at: string;
  received_at: string | null;
}
function mapSupplier(row: SupplierRow): Supplier {
  return SupplierSchema.parse({
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    taxNumber: row.tax_number ?? '',
    isActive: row.is_active === 1,
  });
}
function mapOrder(row: OrderRow): PurchaseOrderSummary {
  return PurchaseOrderSummarySchema.parse({
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number ?? '',
    status: row.status,
    notes: row.notes ?? '',
    subtotalMinor: row.subtotal_minor,
    lineCount: row.line_count,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
  });
}

export class PurchasingService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
    private readonly actorUserId: string,
  ) {}

  listSuppliers(): Supplier[] {
    const rows = this.database
      .prepare(
        'SELECT id, name, phone, email, address, tax_number, is_active FROM suppliers WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE',
      )
      .all(this.storeId) as unknown as SupplierRow[];
    return rows.map(mapSupplier);
  }

  saveSupplier(rawInput: unknown): Supplier {
    const input = SupplierInputSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const id = input.id ?? randomUUID();
      const before = input.id
        ? (this.database
            .prepare(
              'SELECT id, name, phone, email, address, tax_number, is_active FROM suppliers WHERE id = ? AND store_id = ?',
            )
            .get(input.id, this.storeId) as unknown as SupplierRow | undefined)
        : undefined;
      if (input.id && !before) throw new Error('Supplier was not found. Refresh and try again.');
      this.database
        .prepare(
          `INSERT INTO suppliers (id, store_id, name, phone, email, address, tax_number) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, email = excluded.email, address = excluded.address, tax_number = excluded.tax_number, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
        .run(
          id,
          this.storeId,
          input.name,
          input.phone || null,
          input.email || null,
          input.address || null,
          input.taxNumber || null,
        );
      const row = this.database
        .prepare(
          'SELECT id, name, phone, email, address, tax_number, is_active FROM suppliers WHERE id = ? AND store_id = ?',
        )
        .get(id, this.storeId) as unknown as SupplierRow;
      const after = mapSupplier(row);
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, 'supplier', ?, ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          before ? 'supplier.updated' : 'supplier.created',
          id,
          before ? JSON.stringify(mapSupplier(before)) : null,
          JSON.stringify(after),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, 'supplier', ?, ?)",
        )
        .run(
          randomUUID(),
          before ? 'supplier.updated' : 'supplier.created',
          id,
          JSON.stringify({ schemaVersion: 1, supplier: after }),
        );
      return after;
    });
  }

  listPurchaseOrders(): PurchaseOrderSummary[] {
    const rows = this.database
      .prepare(
        `SELECT po.id, po.order_number, po.supplier_id, su.name AS supplier_name, po.supplier_invoice_number, po.status, po.notes, po.subtotal_minor, COUNT(pol.id) AS line_count, po.ordered_at, po.received_at FROM purchase_orders po JOIN suppliers su ON su.id = po.supplier_id LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id WHERE po.store_id = ? AND po.counter_id = ? GROUP BY po.id ORDER BY po.ordered_at DESC LIMIT 200`,
      )
      .all(this.storeId, this.counterId) as unknown as OrderRow[];
    return rows.map(mapOrder);
  }

  createPurchaseOrder(rawInput: unknown): PurchaseOrderSummary {
    const input = PurchaseOrderInputSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const supplier = this.database
        .prepare('SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1')
        .get(input.supplierId, this.storeId);
      if (!supplier)
        throw new Error('Select an active supplier before creating the purchase order.');
      const productIds = input.lines.map((line) => line.productId);
      const products = new Map<
        string,
        { id: string; name: string; sku: string | null; base_unit: string; is_active: number }
      >();
      for (const productId of productIds) {
        const product = this.database
          .prepare(
            'SELECT id, name, sku, base_unit, is_active FROM products WHERE id = ? AND store_id = ? AND archived_at IS NULL',
          )
          .get(productId, this.storeId) as unknown as
          | { id: string; name: string; sku: string | null; base_unit: string; is_active: number }
          | undefined;
        if (!product || product.is_active !== 1)
          throw new Error('Every purchase-order line must reference an active product.');
        products.set(productId, product);
      }
      const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const prefix = `PO-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM purchase_orders WHERE store_id = ? AND order_number LIKE ?',
        )
        .get(this.storeId, `${prefix}%`) as { count: number };
      const orderNumber = `${prefix}${String(sequence.count + 1).padStart(4, '0')}`;
      const id = randomUUID();
      const subtotalMinor = input.lines.reduce(
        (sum, line) => sum + Math.round((line.quantityMilli * line.unitCostMinor) / 1000),
        0,
      );
      this.database
        .prepare(
          "INSERT INTO purchase_orders (id, store_id, counter_id, supplier_id, order_number, status, notes, subtotal_minor, created_by_user_id) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
        )
        .run(
          id,
          this.storeId,
          this.counterId,
          input.supplierId,
          orderNumber,
          input.notes || null,
          subtotalMinor,
          this.actorUserId,
        );
      for (const line of input.lines) {
        const product = products.get(line.productId)!;
        this.database
          .prepare(
            'INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot, quantity_ordered_milli, unit_cost_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            id,
            product.id,
            product.name,
            product.sku,
            product.base_unit,
            line.quantityMilli,
            line.unitCostMinor,
            Math.round((line.quantityMilli * line.unitCostMinor) / 1000),
          );
      }
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'purchase_order.created', 'purchase_order', ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          id,
          JSON.stringify({
            orderNumber,
            supplierId: input.supplierId,
            lineCount: input.lines.length,
            subtotalMinor,
          }),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'purchase_order.created', 'purchase_order', ?, ?)",
        )
        .run(
          randomUUID(),
          id,
          JSON.stringify({
            schemaVersion: 1,
            orderId: id,
            orderNumber,
            supplierId: input.supplierId,
            lines: input.lines,
          }),
        );
      const row = this.database
        .prepare(
          `SELECT po.id, po.order_number, po.supplier_id, su.name AS supplier_name, po.supplier_invoice_number, po.status, po.notes, po.subtotal_minor, (SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS line_count, po.ordered_at, po.received_at FROM purchase_orders po JOIN suppliers su ON su.id = po.supplier_id WHERE po.id = ?`,
        )
        .get(id) as unknown as OrderRow;
      return mapOrder(row);
    });
  }

  listPurchaseOrderReceivingLines(rawOrderId: unknown): PurchaseOrderReceivingLine[] {
    if (typeof rawOrderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawOrderId))
      throw new Error('Purchase order ID is invalid.');
    const order = this.database
      .prepare(
        "SELECT id FROM purchase_orders WHERE id=? AND store_id=? AND counter_id=? AND status='draft'",
      )
      .get(rawOrderId, this.storeId, this.counterId);
    if (!order) throw new Error('Only a draft purchase order from this counter can be received.');
    const rows = this.database
      .prepare(
        `
      SELECT pol.id AS purchaseOrderLineId, pol.product_id AS productId,
        pol.product_name_snapshot AS productName, COALESCE(pol.sku_snapshot,'') AS sku,
        pol.quantity_ordered_milli AS quantityOrderedMilli,
        pol.quantity_received_milli AS quantityPreviouslyReceivedMilli,
        pol.quantity_ordered_milli-pol.quantity_received_milli AS remainingQuantityMilli,
        pol.unit_cost_minor AS unitCostMinor
      FROM purchase_order_lines pol WHERE pol.purchase_order_id=? ORDER BY pol.created_at, pol.id
    `,
      )
      .all(rawOrderId) as unknown as PurchaseOrderReceivingLine[];
    return rows.map((row) => PurchaseOrderReceivingLineSchema.parse(row));
  }

  receivePurchaseOrder(rawInput: unknown): PurchaseOrderSummary {
    const input = ReceivePurchaseOrderSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          `SELECT id, order_number, supplier_id, supplier_invoice_number, status, subtotal_minor,
          received_subtotal_minor FROM purchase_orders WHERE id=? AND store_id=? AND counter_id=?`,
        )
        .get(input.id, this.storeId, this.counterId) as unknown as
        | {
            id: string;
            order_number: string;
            supplier_id: string;
            supplier_invoice_number: string | null;
            status: string;
            subtotal_minor: number;
            received_subtotal_minor: number;
          }
        | undefined;
      if (!order) throw new Error('Purchase order was not found for this counter.');
      if (order.status !== 'draft') throw new Error('Only draft purchase orders can be received.');
      const lines = this.database
        .prepare(
          `SELECT id, product_id, quantity_ordered_milli, quantity_received_milli, unit_cost_minor
         FROM purchase_order_lines WHERE purchase_order_id=? ORDER BY created_at, id`,
        )
        .all(order.id) as unknown as {
        id: string;
        product_id: string;
        quantity_ordered_milli: number;
        quantity_received_milli: number;
        unit_cost_minor: number;
      }[];
      if (!lines.length) throw new Error('Cannot receive an empty purchase order.');
      const requested = input.lines.length
        ? new Map(input.lines.map((line) => [line.purchaseOrderLineId, line.quantityReceivedMilli]))
        : new Map(
            lines.map((line) => [
              line.id,
              line.quantity_ordered_milli - line.quantity_received_milli,
            ]),
          );
      const knownIds = new Set(lines.map((line) => line.id));
      if ([...requested.keys()].some((id) => !knownIds.has(id)))
        throw new Error(
          'A receiving line does not belong to this purchase order. Refresh and try again.',
        );
      const receiptLines = lines.map((line) => {
        const remaining = line.quantity_ordered_milli - line.quantity_received_milli;
        const quantity = requested.get(line.id) ?? 0;
        if (quantity > remaining)
          throw new Error('Received quantity cannot exceed the remaining quantity ordered.');
        return { ...line, remaining, quantity };
      });
      if (!receiptLines.some((line) => line.quantity > 0) && !input.finalizeOrder)
        throw new Error('Enter at least one received quantity before saving a partial receipt.');
      if (
        input.finalizeOrder &&
        !input.discrepancyReason &&
        receiptLines.some((line) => line.quantity < line.remaining)
      )
        throw new Error('Enter a discrepancy reason when finalizing an order with missing goods.');

      const now = new Date().toISOString();
      const invoiceNumber = input.supplierInvoiceNumber || order.supplier_invoice_number || '';
      const datePart = now.slice(0, 10).replaceAll('-', '');
      const prefix = `GRN-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM purchase_receipts WHERE store_id=? AND receipt_number LIKE ?',
        )
        .get(this.storeId, `${prefix}%`) as { count: number };
      const receiptId = randomUUID();
      const receiptNumber = `${prefix}${String(sequence.count + 1).padStart(4, '0')}`;
      const receiptTotal = receiptLines.reduce(
        (sum, line) => sum + Math.round((line.quantity * line.unit_cost_minor) / 1000),
        0,
      );
      const discrepancies = receiptLines
        .filter((line) => input.finalizeOrder && line.quantity < line.remaining)
        .map((line) => ({
          purchaseOrderLineId: line.id,
          productId: line.product_id,
          quantityShortMilli: line.remaining - line.quantity,
        }));
      this.database
        .prepare(
          `INSERT INTO purchase_receipts
        (id,store_id,counter_id,purchase_order_id,receipt_number,supplier_invoice_number,discrepancy_note,total_minor,received_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          receiptId,
          this.storeId,
          this.counterId,
          order.id,
          receiptNumber,
          invoiceNumber,
          input.discrepancyReason,
          receiptTotal,
          this.actorUserId,
        );

      for (const line of receiptLines) {
        const product = this.database
          .prepare('SELECT name,purchase_cost_minor FROM products WHERE id=? AND store_id=?')
          .get(line.product_id, this.storeId) as
          { name: string; purchase_cost_minor: number } | undefined;
        if (!product) throw new Error('A product on this purchase order no longer exists.');
        const lineTotal = Math.round((line.quantity * line.unit_cost_minor) / 1000);
        this.database
          .prepare(
            `INSERT INTO purchase_receipt_lines
          (id,purchase_receipt_id,purchase_order_line_id,product_id,quantity_ordered_milli,quantity_previously_received_milli,quantity_received_milli,quantity_short_milli,unit_cost_minor,line_total_minor)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            randomUUID(),
            receiptId,
            line.id,
            line.product_id,
            line.quantity_ordered_milli,
            line.quantity_received_milli,
            line.quantity,
            input.finalizeOrder ? line.remaining - line.quantity : 0,
            line.unit_cost_minor,
            lineTotal,
          );
        if (line.quantity <= 0) continue;
        const current = this.database
          .prepare(
            'SELECT COALESCE(SUM(quantity_delta_milli),0) AS quantity FROM stock_movements WHERE product_id=? AND counter_id=?',
          )
          .get(line.product_id, this.counterId) as { quantity: number };
        const newQuantity = current.quantity + line.quantity;
        const averageCost =
          newQuantity > 0
            ? Math.round(
                (current.quantity * product.purchase_cost_minor +
                  line.quantity * line.unit_cost_minor) /
                  newQuantity,
              )
            : line.unit_cost_minor;
        const movementId = randomUUID();
        this.database
          .prepare(
            `INSERT INTO stock_movements
          (id,store_id,counter_id,product_id,movement_type,quantity_delta_milli,unit_cost_minor,reference_type,reference_id,reason,actor_user_id)
          VALUES (?,?,?,?,'receipt',?,?,'purchase_order',?,?,?)`,
          )
          .run(
            movementId,
            this.storeId,
            this.counterId,
            line.product_id,
            line.quantity,
            line.unit_cost_minor,
            receiptId,
            `Goods received ${receiptNumber} against ${order.order_number}`,
            this.actorUserId,
          );
        this.database
          .prepare(
            `INSERT INTO outbox_events
          (id,event_type,aggregate_type,aggregate_id,payload_json)
          VALUES (?,'stock.movement.recorded','stock_movement',?,?)`,
          )
          .run(
            randomUUID(),
            movementId,
            JSON.stringify({
              schemaVersion: 1,
              movementId,
              storeId: this.storeId,
              counterId: this.counterId,
              productId: line.product_id,
              movementType: 'receipt',
              quantityDeltaMilli: line.quantity,
              unitCostMinor: line.unit_cost_minor,
              reason: `Goods received ${receiptNumber} against ${order.order_number}`,
            }),
          );
        this.database
          .prepare('UPDATE products SET purchase_cost_minor=?,updated_at=? WHERE id=?')
          .run(averageCost, now, line.product_id);
        const updatedProduct = new ProductRepository(this.database, this.counterId).findById(
          this.storeId,
          line.product_id,
        );
        if (updatedProduct)
          this.database
            .prepare(
              `INSERT INTO outbox_events
          (id,event_type,aggregate_type,aggregate_id,payload_json) VALUES (?,'product.updated','product',?,?)`,
            )
            .run(
              randomUUID(),
              line.product_id,
              JSON.stringify({ schemaVersion: 1, product: updatedProduct }),
            );
        this.database
          .prepare(
            'UPDATE purchase_order_lines SET quantity_received_milli=quantity_received_milli+? WHERE id=?',
          )
          .run(line.quantity, line.id);
        this.database
          .prepare(
            `INSERT INTO audit_events
          (id,store_id,actor_user_id,action,entity_type,entity_id,before_json,after_json)
          VALUES (?,?,?,'purchase.received_line','product',?,?,?)`,
          )
          .run(
            randomUUID(),
            this.storeId,
            this.actorUserId,
            line.product_id,
            JSON.stringify({
              quantityMilli: current.quantity,
              purchaseCostMinor: product.purchase_cost_minor,
            }),
            JSON.stringify({
              quantityMilli: newQuantity,
              purchaseCostMinor: averageCost,
              purchaseOrderId: order.id,
              receiptId,
            }),
          );
      }
      const newReceivedSubtotal = order.received_subtotal_minor + receiptTotal;
      const shouldFinalize = input.finalizeOrder;
      this.database
        .prepare(
          `UPDATE purchase_orders SET supplier_invoice_number=?,
        received_subtotal_minor=?, receipt_discrepancy_note=?, receipt_discrepancy_json=?,
        status=?, received_by_user_id=?, received_at=?, updated_at=? WHERE id=?`,
        )
        .run(
          invoiceNumber || null,
          newReceivedSubtotal,
          shouldFinalize ? input.discrepancyReason : '',
          JSON.stringify(shouldFinalize ? discrepancies : []),
          shouldFinalize ? 'received' : 'draft',
          shouldFinalize ? this.actorUserId : null,
          shouldFinalize ? now : null,
          now,
          order.id,
        );
      this.database
        .prepare(
          `INSERT INTO audit_events
        (id,store_id,actor_user_id,action,entity_type,entity_id,after_json)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          shouldFinalize ? 'purchase_order.received' : 'purchase_order.partially_received',
          'purchase_order',
          order.id,
          JSON.stringify({
            orderNumber: order.order_number,
            receiptNumber,
            supplierInvoiceNumber: invoiceNumber || null,
            receiptTotalMinor: receiptTotal,
            cumulativeReceivedMinor: newReceivedSubtotal,
            discrepancyReason: input.discrepancyReason,
            discrepancies,
          }),
        );
      this.database
        .prepare(
          `INSERT INTO outbox_events
        (id,event_type,aggregate_type,aggregate_id,payload_json) VALUES (?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          shouldFinalize ? 'purchase_order.received' : 'purchase_order.receipt.created',
          'purchase_order',
          order.id,
          JSON.stringify({
            schemaVersion: 1,
            orderId: order.id,
            orderNumber: order.order_number,
            receiptId,
            receiptNumber,
            supplierInvoiceNumber: invoiceNumber || null,
            receiptTotalMinor: receiptTotal,
            cumulativeReceivedMinor: newReceivedSubtotal,
            finalizeOrder: shouldFinalize,
            discrepancyReason: input.discrepancyReason,
            discrepancies,
          }),
        );
      if (shouldFinalize && newReceivedSubtotal > 0)
        new AccountingService(this.database, this.storeId, this.actorUserId).postPurchaseReceipt(
          order.id,
        );
      const row = this.database
        .prepare(
          `SELECT po.id,po.order_number,po.supplier_id,su.name AS supplier_name,
        po.supplier_invoice_number,po.status,po.notes,po.subtotal_minor,
        (SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id=po.id) AS line_count,
        po.ordered_at,po.received_at FROM purchase_orders po JOIN suppliers su ON su.id=po.supplier_id WHERE po.id=?`,
        )
        .get(order.id) as unknown as OrderRow;
      return mapOrder(row);
    });
  }

  listReturnablePurchaseOrderLines(rawOrderId: unknown): PurchaseReturnableLine[] {
    if (typeof rawOrderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawOrderId))
      throw new Error('Purchase order ID is invalid.');
    const order = this.database
      .prepare(
        "SELECT id FROM purchase_orders WHERE id=? AND store_id=? AND counter_id=? AND status='received'",
      )
      .get(rawOrderId, this.storeId, this.counterId);
    if (!order)
      throw new Error('Only a received purchase order from this counter can be returned.');
    const rows = this.database
      .prepare(
        `SELECT pol.id AS purchaseOrderLineId, pol.product_id AS productId,
          pol.product_name_snapshot AS productName, COALESCE(pol.sku_snapshot,'') AS sku,
          pol.quantity_received_milli AS quantityReceivedMilli,
          COALESCE((SELECT SUM(prl.quantity_milli) FROM purchase_return_lines prl WHERE prl.purchase_order_line_id=pol.id),0) AS quantityReturnedMilli,
          pol.unit_cost_minor AS unitCostMinor,
          COALESCE((SELECT SUM(sm.quantity_delta_milli) FROM stock_movements sm WHERE sm.product_id=pol.product_id AND sm.counter_id=po.counter_id),0) AS onHandMilli
        FROM purchase_order_lines pol
        JOIN purchase_orders po ON po.id=pol.purchase_order_id
        WHERE po.id=? AND po.store_id=? AND po.counter_id=?
        ORDER BY pol.rowid`,
      )
      .all(rawOrderId, this.storeId, this.counterId) as {
      purchaseOrderLineId: string;
      productId: string;
      productName: string;
      sku: string;
      quantityReceivedMilli: number;
      quantityReturnedMilli: number;
      unitCostMinor: number;
      onHandMilli: number;
    }[];
    return rows.map((row) =>
      PurchaseReturnableLineSchema.parse({
        purchaseOrderLineId: row.purchaseOrderLineId,
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        quantityReceivedMilli: row.quantityReceivedMilli,
        quantityReturnedMilli: row.quantityReturnedMilli,
        returnableQuantityMilli: Math.max(
          0,
          Math.min(row.quantityReceivedMilli - row.quantityReturnedMilli, row.onHandMilli),
        ),
        unitCostMinor: row.unitCostMinor,
      }),
    );
  }

  listPurchaseReturns(): PurchaseReturnSummary[] {
    const rows = this.database
      .prepare(
        `SELECT pr.id, pr.return_number AS returnNumber, pr.purchase_order_id AS purchaseOrderId,
          po.order_number AS orderNumber, pr.supplier_id AS supplierId, su.name AS supplierName,
          pr.reason, pr.total_minor AS totalMinor, COUNT(prl.id) AS lineCount, pr.created_at AS createdAt
        FROM purchase_returns pr
        JOIN purchase_orders po ON po.id=pr.purchase_order_id
        JOIN suppliers su ON su.id=pr.supplier_id
        LEFT JOIN purchase_return_lines prl ON prl.purchase_return_id=pr.id
        WHERE pr.store_id=? AND pr.counter_id=?
        GROUP BY pr.id ORDER BY pr.created_at DESC LIMIT 200`,
      )
      .all(this.storeId, this.counterId);
    return rows.map((row) => PurchaseReturnSummarySchema.parse(row));
  }

  createPurchaseReturn(rawInput: unknown): PurchaseReturnSummary {
    const input = PurchaseReturnInputSchema.parse(rawInput) as PurchaseReturnInput;
    return runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          'SELECT id, order_number, supplier_id, status FROM purchase_orders WHERE id=? AND store_id=? AND counter_id=?',
        )
        .get(input.purchaseOrderId, this.storeId, this.counterId) as
        { id: string; order_number: string; supplier_id: string; status: string } | undefined;
      if (!order || order.status !== 'received')
        throw new Error('Only a received purchase order from this counter can be returned.');

      const lines = input.lines.map((requested) => {
        const line = this.database
          .prepare(
            `SELECT pol.id, pol.product_id, pol.product_name_snapshot, pol.quantity_received_milli,
              pol.unit_cost_minor,
              COALESCE((SELECT SUM(prl.quantity_milli) FROM purchase_return_lines prl WHERE prl.purchase_order_line_id=pol.id),0) AS quantity_returned_milli,
              COALESCE((SELECT SUM(sm.quantity_delta_milli) FROM stock_movements sm WHERE sm.product_id=pol.product_id AND sm.counter_id=po.counter_id),0) AS on_hand_milli
            FROM purchase_order_lines pol JOIN purchase_orders po ON po.id=pol.purchase_order_id
            WHERE pol.id=? AND po.id=? AND po.store_id=? AND po.counter_id=?`,
          )
          .get(requested.purchaseOrderLineId, order.id, this.storeId, this.counterId) as
          | {
              id: string;
              product_id: string;
              product_name_snapshot: string;
              quantity_received_milli: number;
              unit_cost_minor: number;
              quantity_returned_milli: number;
              on_hand_milli: number;
            }
          | undefined;
        if (!line) throw new Error('A return line does not belong to this purchase order.');
        const returnable = Math.max(
          0,
          Math.min(line.quantity_received_milli - line.quantity_returned_milli, line.on_hand_milli),
        );
        if (requested.quantityMilli > returnable)
          throw new Error(
            `Cannot return more ${line.product_name_snapshot} than the remaining received quantity and current stock allow.`,
          );
        return {
          orderLineId: line.id,
          productId: line.product_id,
          productName: line.product_name_snapshot,
          quantityMilli: requested.quantityMilli,
          unitCostMinor: line.unit_cost_minor,
          lineTotalMinor: Math.round((requested.quantityMilli * line.unit_cost_minor) / 1000),
        };
      });
      const totalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const prefix = `PR-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM purchase_returns WHERE store_id=? AND return_number LIKE ?',
        )
        .get(this.storeId, `${prefix}%`) as { count: number };
      const returnNumber = prefix + String(sequence.count + 1).padStart(4, '0');
      const returnId = randomUUID();
      this.database
        .prepare(
          'INSERT INTO purchase_returns (id,store_id,counter_id,purchase_order_id,supplier_id,return_number,reason,total_minor,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          returnId,
          this.storeId,
          this.counterId,
          order.id,
          order.supplier_id,
          returnNumber,
          input.reason,
          totalMinor,
          this.actorUserId,
        );
      for (const line of lines) {
        this.database
          .prepare(
            'INSERT INTO purchase_return_lines (id,purchase_return_id,purchase_order_line_id,product_id,quantity_milli,unit_cost_minor,line_total_minor) VALUES (?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            returnId,
            line.orderLineId,
            line.productId,
            line.quantityMilli,
            line.unitCostMinor,
            line.lineTotalMinor,
          );
        const movementId = randomUUID();
        this.database
          .prepare(
            "INSERT INTO stock_movements (id,store_id,counter_id,product_id,movement_type,quantity_delta_milli,unit_cost_minor,reference_type,reference_id,reason,actor_user_id) VALUES (?,?,?,?,'adjustment',?,?, 'purchase_return',?,?,?)",
          )
          .run(
            movementId,
            this.storeId,
            this.counterId,
            line.productId,
            -line.quantityMilli,
            line.unitCostMinor,
            returnId,
            `Supplier return ${returnNumber}: ${input.reason}`,
            this.actorUserId,
          );
        this.database
          .prepare(
            "INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json) VALUES (?,'stock.movement.recorded','stock_movement',?,?)",
          )
          .run(
            randomUUID(),
            movementId,
            JSON.stringify({
              schemaVersion: 1,
              movementId,
              storeId: this.storeId,
              counterId: this.counterId,
              productId: line.productId,
              movementType: 'adjustment',
              quantityDeltaMilli: -line.quantityMilli,
              unitCostMinor: line.unitCostMinor,
              referenceType: 'purchase_return',
              referenceId: returnId,
              reason: `Supplier return ${returnNumber}: ${input.reason}`,
            }),
          );
      }
      this.database
        .prepare(
          "INSERT INTO audit_events (id,store_id,actor_user_id,action,entity_type,entity_id,after_json) VALUES (?,?,?,'purchase.return.created','purchase_return',?,?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          returnId,
          JSON.stringify({ returnNumber, orderId: order.id, totalMinor, lines }),
        );
      if (totalMinor > 0)
        new AccountingService(this.database, this.storeId, this.actorUserId).postPurchaseReturn(
          returnId,
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json) VALUES (?,'purchase.return.created','purchase_return',?,?)",
        )
        .run(
          randomUUID(),
          returnId,
          JSON.stringify({
            schemaVersion: 1,
            returnId,
            returnNumber,
            purchaseOrderId: order.id,
            supplierId: order.supplier_id,
            reason: input.reason,
            totalMinor,
            lines,
          }),
        );
      const summary = this.database
        .prepare(
          `SELECT pr.id, pr.return_number AS returnNumber, pr.purchase_order_id AS purchaseOrderId,
            po.order_number AS orderNumber, pr.supplier_id AS supplierId, su.name AS supplierName,
            pr.reason, pr.total_minor AS totalMinor,
            (SELECT COUNT(*) FROM purchase_return_lines WHERE purchase_return_id=pr.id) AS lineCount,
            pr.created_at AS createdAt
          FROM purchase_returns pr JOIN purchase_orders po ON po.id=pr.purchase_order_id
          JOIN suppliers su ON su.id=pr.supplier_id WHERE pr.id=?`,
        )
        .get(returnId);
      return PurchaseReturnSummarySchema.parse(summary);
    });
  }

  listSupplierBalances(): SupplierBalance[] {
    const rows = this.database
      .prepare(
        `SELECT po.id AS purchaseOrderId, po.order_number AS orderNumber,
          po.supplier_id AS supplierId, su.name AS supplierName,
          COALESCE(po.supplier_invoice_number,'') AS supplierInvoiceNumber,
          COALESCE(po.received_at,po.ordered_at) AS receivedAt,
          po.received_subtotal_minor AS originalAmountMinor,
          COALESCE((SELECT SUM(pr.total_minor) FROM purchase_returns pr WHERE pr.purchase_order_id=po.id),0) AS returnedAmountMinor,
          COALESCE((SELECT SUM(sp.amount_minor) FROM supplier_payments sp WHERE sp.purchase_order_id=po.id),0) AS paidAmountMinor
        FROM purchase_orders po JOIN suppliers su ON su.id=po.supplier_id
        WHERE po.store_id=? AND po.counter_id=? AND po.status='received'
        ORDER BY COALESCE(po.received_at,po.ordered_at) DESC`,
      )
      .all(this.storeId, this.counterId) as {
      purchaseOrderId: string;
      orderNumber: string;
      supplierId: string;
      supplierName: string;
      supplierInvoiceNumber: string;
      receivedAt: string;
      originalAmountMinor: number;
      returnedAmountMinor: number;
      paidAmountMinor: number;
    }[];
    return rows.map((row) => {
      const ageDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(row.receivedAt).getTime()) / 86_400_000),
      );
      const agingBucket =
        ageDays <= 30
          ? '0-30 days'
          : ageDays <= 60
            ? '31-60 days'
            : ageDays <= 90
              ? '61-90 days'
              : '90+ days';
      return SupplierBalanceSchema.parse({
        ...row,
        outstandingMinor: row.originalAmountMinor - row.returnedAmountMinor - row.paidAmountMinor,
        ageDays,
        agingBucket,
      });
    });
  }

  listSupplierPayments(): SupplierPaymentSummary[] {
    const rows = this.database
      .prepare(
        `SELECT sp.id, sp.payment_number AS paymentNumber, sp.purchase_order_id AS purchaseOrderId,
          po.order_number AS orderNumber, sp.supplier_id AS supplierId, su.name AS supplierName,
          sp.amount_minor AS amountMinor, sp.payment_method AS paymentMethod,
          sp.reference, sp.notes, sp.created_at AS createdAt
        FROM supplier_payments sp
        JOIN purchase_orders po ON po.id=sp.purchase_order_id
        JOIN suppliers su ON su.id=sp.supplier_id
        WHERE sp.store_id=? AND sp.counter_id=?
        ORDER BY sp.created_at DESC LIMIT 200`,
      )
      .all(this.storeId, this.counterId);
    return rows.map((row) => SupplierPaymentSummarySchema.parse(row));
  }

  createSupplierPayment(rawInput: unknown): SupplierPaymentSummary {
    const input = SupplierPaymentInputSchema.parse(rawInput) as SupplierPaymentInput;
    return runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          `SELECT po.id, po.order_number, po.supplier_id, po.status, po.received_subtotal_minor AS subtotal_minor,
            COALESCE((SELECT SUM(pr.total_minor) FROM purchase_returns pr WHERE pr.purchase_order_id=po.id),0) AS returned_minor,
            COALESCE((SELECT SUM(sp.amount_minor) FROM supplier_payments sp WHERE sp.purchase_order_id=po.id),0) AS paid_minor
          FROM purchase_orders po WHERE po.id=? AND po.store_id=? AND po.counter_id=?`,
        )
        .get(input.purchaseOrderId, this.storeId, this.counterId) as
        | {
            id: string;
            order_number: string;
            supplier_id: string;
            status: string;
            subtotal_minor: number;
            returned_minor: number;
            paid_minor: number;
          }
        | undefined;
      if (!order || order.status !== 'received')
        throw new Error(
          'Supplier payments can only settle a received purchase order from this counter.',
        );
      const outstanding = order.subtotal_minor - order.returned_minor - order.paid_minor;
      if (outstanding <= 0)
        throw new Error('This purchase order has no outstanding supplier balance.');
      if (input.amountMinor > outstanding)
        throw new Error('Supplier payment cannot exceed the remaining invoice balance.');
      const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const prefix = `SP-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM supplier_payments WHERE store_id=? AND payment_number LIKE ?',
        )
        .get(this.storeId, `${prefix}%`) as { count: number };
      const paymentNumber = prefix + String(sequence.count + 1).padStart(4, '0');
      const paymentId = randomUUID();
      this.database
        .prepare(
          'INSERT INTO supplier_payments (id,store_id,counter_id,supplier_id,purchase_order_id,payment_number,amount_minor,payment_method,reference,notes,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          paymentId,
          this.storeId,
          this.counterId,
          order.supplier_id,
          order.id,
          paymentNumber,
          input.amountMinor,
          input.paymentMethod,
          input.reference,
          input.notes,
          this.actorUserId,
        );
      new AccountingService(this.database, this.storeId, this.actorUserId).postSupplierPayment(
        paymentId,
      );
      this.database
        .prepare(
          "INSERT INTO audit_events (id,store_id,actor_user_id,action,entity_type,entity_id,after_json) VALUES (?,?,?,'supplier.payment.created','supplier_payment',?,?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          paymentId,
          JSON.stringify({
            paymentNumber,
            orderId: order.id,
            amountMinor: input.amountMinor,
            paymentMethod: input.paymentMethod,
          }),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id,event_type,aggregate_type,aggregate_id,payload_json) VALUES (?,'supplier.payment.created','supplier_payment',?,?)",
        )
        .run(
          randomUUID(),
          paymentId,
          JSON.stringify({
            schemaVersion: 1,
            paymentId,
            paymentNumber,
            supplierId: order.supplier_id,
            purchaseOrderId: order.id,
            amountMinor: input.amountMinor,
            paymentMethod: input.paymentMethod,
            reference: input.reference,
            notes: input.notes,
          }),
        );
      const summary = this.database
        .prepare(
          `SELECT sp.id, sp.payment_number AS paymentNumber, sp.purchase_order_id AS purchaseOrderId,
            po.order_number AS orderNumber, sp.supplier_id AS supplierId, su.name AS supplierName,
            sp.amount_minor AS amountMinor, sp.payment_method AS paymentMethod,
            sp.reference, sp.notes, sp.created_at AS createdAt
          FROM supplier_payments sp JOIN purchase_orders po ON po.id=sp.purchase_order_id
          JOIN suppliers su ON su.id=sp.supplier_id WHERE sp.id=?`,
        )
        .get(paymentId);
      return SupplierPaymentSummarySchema.parse(summary);
    });
  }

  cancelPurchaseOrder(rawId: unknown): void {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawId))
      throw new Error('Purchase order ID is invalid.');
    runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          `SELECT po.id, po.order_number, po.status, EXISTS(SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id AND pol.quantity_received_milli>0) AS has_received_goods FROM purchase_orders po WHERE po.id=? AND po.store_id=? AND po.counter_id=?`,
        )
        .get(rawId, this.storeId, this.counterId) as unknown as
        | { id: string; order_number: string; status: string; has_received_goods: number }
        | undefined;
      if (!order) throw new Error('Purchase order was not found.');
      if (order.status !== 'draft') throw new Error('Only draft purchase orders can be cancelled.');
      if (order.has_received_goods === 1)
        throw new Error(
          'A purchase order with received goods cannot be cancelled. Finalize the receipt or record the supplier discrepancy instead.',
        );
      this.database
        .prepare("UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), order.id);
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, 'purchase_order.cancelled', 'purchase_order', ?, ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          order.id,
          JSON.stringify({ status: 'draft' }),
          JSON.stringify({ status: 'cancelled' }),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'purchase_order.cancelled', 'purchase_order', ?, ?)",
        )
        .run(
          randomUUID(),
          order.id,
          JSON.stringify({ schemaVersion: 1, orderId: order.id, orderNumber: order.order_number }),
        );
    });
  }
}
