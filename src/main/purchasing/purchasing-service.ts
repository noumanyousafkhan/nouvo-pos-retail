import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  PurchaseOrderInputSchema,
  PurchaseOrderSummarySchema,
  ReceivePurchaseOrderSchema,
  SupplierInputSchema,
  SupplierSchema,
  type PurchaseOrderSummary,
  type Supplier,
} from '../../shared/contracts/purchasing';
import { runInTransaction } from '../database/connection';

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

  receivePurchaseOrder(rawInput: unknown): PurchaseOrderSummary {
    const input = ReceivePurchaseOrderSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          'SELECT id, order_number, supplier_id, supplier_invoice_number, status, subtotal_minor FROM purchase_orders WHERE id = ? AND store_id = ? AND counter_id = ?',
        )
        .get(input.id, this.storeId, this.counterId) as unknown as
        | {
            id: string;
            order_number: string;
            supplier_id: string;
            supplier_invoice_number: string | null;
            status: string;
            subtotal_minor: number;
          }
        | undefined;
      if (!order) throw new Error('Purchase order was not found for this counter.');
      if (order.status !== 'draft') throw new Error('Only draft purchase orders can be received.');
      const lines = this.database
        .prepare(
          'SELECT id, product_id, quantity_ordered_milli, unit_cost_minor FROM purchase_order_lines WHERE purchase_order_id = ?',
        )
        .all(order.id) as unknown as {
        id: string;
        product_id: string;
        quantity_ordered_milli: number;
        unit_cost_minor: number;
      }[];
      if (!lines.length) throw new Error('Cannot receive an empty purchase order.');
      for (const line of lines) {
        const product = this.database
          .prepare('SELECT name, purchase_cost_minor FROM products WHERE id = ? AND store_id = ?')
          .get(line.product_id, this.storeId) as unknown as
          { name: string; purchase_cost_minor: number } | undefined;
        if (!product) throw new Error('A product on this purchase order no longer exists.');
        const current = this.database
          .prepare(
            'SELECT COALESCE(SUM(quantity_delta_milli),0) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
          )
          .get(line.product_id, this.counterId) as { quantity: number };
        const newQuantity = current.quantity + line.quantity_ordered_milli;
        const averageCost =
          newQuantity > 0
            ? Math.round(
                (current.quantity * product.purchase_cost_minor +
                  line.quantity_ordered_milli * line.unit_cost_minor) /
                  newQuantity,
              )
            : line.unit_cost_minor;
        this.database
          .prepare(
            "INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, unit_cost_minor, reference_type, reference_id, reason, actor_user_id) VALUES (?, ?, ?, ?, 'receipt', ?, ?, 'purchase_order', ?, ?, ?)",
          )
          .run(
            randomUUID(),
            this.storeId,
            this.counterId,
            line.product_id,
            line.quantity_ordered_milli,
            line.unit_cost_minor,
            order.id,
            `Goods received against ${order.order_number}`,
            this.actorUserId,
          );
        this.database
          .prepare('UPDATE products SET purchase_cost_minor = ?, updated_at = ? WHERE id = ?')
          .run(averageCost, new Date().toISOString(), line.product_id);
        this.database
          .prepare(
            'UPDATE purchase_order_lines SET quantity_received_milli = quantity_ordered_milli WHERE id = ?',
          )
          .run(line.id);
        this.database
          .prepare(
            "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, 'purchase.received_line', 'product', ?, ?, ?)",
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
            }),
          );
      }
      const invoiceNumber = input.supplierInvoiceNumber || order.supplier_invoice_number;
      this.database
        .prepare(
          "UPDATE purchase_orders SET status = 'received', supplier_invoice_number = ?, received_by_user_id = ?, received_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          invoiceNumber || null,
          this.actorUserId,
          new Date().toISOString(),
          new Date().toISOString(),
          order.id,
        );
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'purchase_order.received', 'purchase_order', ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          order.id,
          JSON.stringify({
            orderNumber: order.order_number,
            supplierInvoiceNumber: invoiceNumber || null,
            subtotalMinor: order.subtotal_minor,
            lines: lines.length,
          }),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'purchase_order.received', 'purchase_order', ?, ?)",
        )
        .run(
          randomUUID(),
          order.id,
          JSON.stringify({
            schemaVersion: 1,
            orderId: order.id,
            orderNumber: order.order_number,
            supplierInvoiceNumber: invoiceNumber || null,
          }),
        );
      const row = this.database
        .prepare(
          `SELECT po.id, po.order_number, po.supplier_id, su.name AS supplier_name, po.supplier_invoice_number, po.status, po.notes, po.subtotal_minor, (SELECT COUNT(*) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS line_count, po.ordered_at, po.received_at FROM purchase_orders po JOIN suppliers su ON su.id = po.supplier_id WHERE po.id = ?`,
        )
        .get(order.id) as unknown as OrderRow;
      return mapOrder(row);
    });
  }

  cancelPurchaseOrder(rawId: unknown): void {
    if (typeof rawId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawId))
      throw new Error('Purchase order ID is invalid.');
    runInTransaction(this.database, () => {
      const order = this.database
        .prepare(
          'SELECT id, order_number, status FROM purchase_orders WHERE id = ? AND store_id = ? AND counter_id = ?',
        )
        .get(rawId, this.storeId, this.counterId) as unknown as
        { id: string; order_number: string; status: string } | undefined;
      if (!order) throw new Error('Purchase order was not found.');
      if (order.status !== 'draft') throw new Error('Only draft purchase orders can be cancelled.');
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
