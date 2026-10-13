import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ReturnSaleInputSchema,
  ReturnableSaleLineSchema,
  SaleReturnResultSchema,
  VoidSaleInputSchema,
  type ReturnableSaleLine,
  type SaleReturnResult,
} from '../../shared/contracts/returns';
import { runInTransaction } from '../database/connection';

interface SaleRow {
  id: string;
  receipt_number: string;
  status: string;
  currency_code: string;
  total_minor: number;
  store_id: string;
  counter_id: string;
}
interface SaleLineRow {
  id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_snapshot: string;
  quantity_milli: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  line_total_minor: number;
}
export class ReturnsService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
    private readonly actorUserId: string,
  ) {}

  getReturnableItems(rawSaleId: unknown): ReturnableSaleLine[] {
    if (typeof rawSaleId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawSaleId))
      throw new Error('Sale ID is invalid.');
    const sale = this.database
      .prepare('SELECT status FROM sales WHERE id = ? AND store_id = ? AND counter_id = ?')
      .get(rawSaleId, this.storeId, this.counterId) as { status: string } | undefined;
    if (!sale || !['completed', 'partially_returned'].includes(sale.status))
      throw new Error('This sale has no remaining returnable quantity.');
    const rows = this.database
      .prepare(
        `SELECT sl.id AS saleLineId, sl.product_name_snapshot AS productName, sl.unit_snapshot AS unit, sl.quantity_milli AS soldQuantityMilli, MAX(0, sl.quantity_milli - COALESCE(returns.returned_quantity_milli,0)) AS remainingQuantityMilli, MAX(0, sl.line_total_minor - COALESCE(returns.refunded_minor,0)) AS remainingRefundMinor, COALESCE(returns.returned_quantity_milli,0) AS returnedQuantityMilli FROM sale_lines sl LEFT JOIN (SELECT rl.original_sale_line_id, SUM(rl.quantity_milli) AS returned_quantity_milli, SUM(rl.refund_total_minor) AS refunded_minor FROM sale_return_lines rl JOIN sale_returns sr ON sr.id = rl.sale_return_id WHERE sr.status = 'completed' GROUP BY rl.original_sale_line_id) returns ON returns.original_sale_line_id = sl.id WHERE sl.sale_id = ? ORDER BY sl.rowid`,
      )
      .all(rawSaleId);
    return rows.map((row) => ReturnableSaleLineSchema.parse(row));
  }

  returnSale(rawInput: unknown): SaleReturnResult {
    const input = ReturnSaleInputSchema.parse(rawInput);
    return this.process({
      saleId: input.saleId,
      reason: input.reason,
      operation: 'return',
      refundPaymentMethod: input.refundPaymentMethod,
      refundReference: input.refundReference,
      requestedItems: input.items,
    });
  }

  voidSale(rawInput: unknown): SaleReturnResult {
    const input = VoidSaleInputSchema.parse(rawInput);
    return this.process({
      saleId: input.saleId,
      reason: input.reason,
      operation: 'void',
      refundPaymentMethod: input.refundPaymentMethod,
      refundReference: input.refundReference,
    });
  }

  private process(input: {
    saleId: string;
    reason: string;
    operation: 'return' | 'void';
    refundPaymentMethod: string;
    refundReference: string;
    requestedItems?: { saleLineId: string; quantityMilli: number }[];
  }): SaleReturnResult {
    return runInTransaction(this.database, () => {
      const sale = this.database
        .prepare(
          'SELECT id, receipt_number, status, currency_code, total_minor, store_id, counter_id FROM sales WHERE id = ? AND store_id = ? AND counter_id = ?',
        )
        .get(input.saleId, this.storeId, this.counterId) as unknown as SaleRow | undefined;
      if (!sale) throw new Error('Original sale was not found on this counter.');
      if (input.operation === 'void') {
        if (sale.status !== 'completed')
          throw new Error('Only a sale with no previous returns can be voided.');
        const existingReturn = this.database
          .prepare(
            "SELECT 1 AS found FROM sale_returns WHERE sale_id = ? AND status = 'completed' LIMIT 1",
          )
          .get(sale.id);
        if (existingReturn)
          throw new Error('This sale already has a return record and cannot be voided.');
      } else if (!['completed', 'partially_returned'].includes(sale.status)) {
        throw new Error('Only completed or partially returned sales can be returned.');
      }
      const originalLines = this.database
        .prepare(
          'SELECT id, product_id, product_name_snapshot, unit_snapshot, quantity_milli, unit_price_minor, discount_minor, tax_minor, line_total_minor FROM sale_lines WHERE sale_id = ? ORDER BY rowid',
        )
        .all(sale.id) as unknown as SaleLineRow[];
      if (!originalLines.length) throw new Error('The original sale has no returnable lines.');
      const requested =
        input.operation === 'void'
          ? originalLines.map((line) => ({
              saleLineId: line.id,
              quantityMilli: line.quantity_milli,
            }))
          : (input.requestedItems ?? []);
      const returnId = randomUUID();
      const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      const prefix = `RT-${datePart}-`;
      const sequence = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM sale_returns WHERE counter_id = ? AND return_number LIKE ?',
        )
        .get(this.counterId, `${prefix}%`) as { count: number };
      const returnNumber = `${prefix}${String(sequence.count + 1).padStart(4, '0')}`;
      const calculatedLines: {
        original: SaleLineRow;
        quantityMilli: number;
        refundSubtotalMinor: number;
        refundDiscountMinor: number;
        refundTaxMinor: number;
        refundTotalMinor: number;
      }[] = [];
      for (const item of requested) {
        const original = originalLines.find((line) => line.id === item.saleLineId);
        if (!original)
          throw new Error(
            'A selected return line does not belong to this sale. Refresh and try again.',
          );
        const previous = this.database
          .prepare(
            "SELECT COALESCE(SUM(rl.quantity_milli),0) AS quantity, COALESCE(SUM(rl.refund_subtotal_minor),0) AS refunded_subtotal, COALESCE(SUM(rl.refund_discount_minor),0) AS refunded_discount, COALESCE(SUM(rl.refund_tax_minor),0) AS refunded_tax, COALESCE(SUM(rl.refund_total_minor),0) AS refunded FROM sale_return_lines rl JOIN sale_returns sr ON sr.id = rl.sale_return_id WHERE rl.original_sale_line_id = ? AND sr.status = 'completed'",
          )
          .get(original.id) as {
          quantity: number;
          refunded_subtotal: number;
          refunded_discount: number;
          refunded_tax: number;
          refunded: number;
        };
        const remainingQuantity = original.quantity_milli - previous.quantity;
        if (item.quantityMilli > remainingQuantity)
          throw new Error(
            `Return quantity for ${original.product_name_snapshot} exceeds the remaining sold quantity.`,
          );
        const remainingValue = Math.max(0, original.line_total_minor - previous.refunded);
        const remainingSubtotal = Math.max(
          0,
          Math.round((original.unit_price_minor * original.quantity_milli) / 1000) -
            previous.refunded_subtotal,
        );
        const remainingDiscount = Math.max(0, original.discount_minor - previous.refunded_discount);
        const remainingTax = Math.max(0, original.tax_minor - previous.refunded_tax);
        const isLastQuantity = item.quantityMilli === remainingQuantity;
        const refundSubtotalMinor = isLastQuantity
          ? remainingSubtotal
          : Math.min(
              remainingSubtotal,
              Math.round((original.unit_price_minor * item.quantityMilli) / 1000),
            );
        const refundDiscountMinor = isLastQuantity
          ? remainingDiscount
          : Math.min(
              remainingDiscount,
              Math.round((original.discount_minor * item.quantityMilli) / original.quantity_milli),
            );
        const refundTaxMinor = isLastQuantity
          ? remainingTax
          : Math.min(
              remainingTax,
              Math.round((original.tax_minor * item.quantityMilli) / original.quantity_milli),
            );
        const refundTotalMinor = isLastQuantity
          ? remainingValue
          : Math.min(
              remainingValue,
              Math.round(
                (original.line_total_minor * item.quantityMilli) / original.quantity_milli,
              ),
            );
        calculatedLines.push({
          original,
          quantityMilli: item.quantityMilli,
          refundSubtotalMinor,
          refundDiscountMinor,
          refundTaxMinor,
          refundTotalMinor,
        });
      }
      if (input.operation === 'void' && calculatedLines.length !== originalLines.length)
        throw new Error('Void must include every original sale line.');
      let totalMinor = calculatedLines.reduce((sum, line) => sum + line.refundTotalMinor, 0);
      if (input.operation === 'void' && totalMinor !== sale.total_minor && calculatedLines.length) {
        calculatedLines[calculatedLines.length - 1]!.refundTotalMinor +=
          sale.total_minor - totalMinor;
        totalMinor = sale.total_minor;
      }
      this.database
        .prepare(
          "INSERT INTO sale_returns (id, store_id, counter_id, sale_id, return_number, operation, status, reason, currency_code, total_minor, processed_by_user_id) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)",
        )
        .run(
          returnId,
          this.storeId,
          this.counterId,
          sale.id,
          returnNumber,
          input.operation,
          input.reason,
          sale.currency_code,
          totalMinor,
          this.actorUserId,
        );
      for (const line of calculatedLines) {
        this.database
          .prepare(
            'INSERT INTO sale_return_lines (id, sale_return_id, original_sale_line_id, product_id, product_name_snapshot, unit_snapshot, quantity_milli, refund_subtotal_minor, refund_discount_minor, refund_tax_minor, refund_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            returnId,
            line.original.id,
            line.original.product_id,
            line.original.product_name_snapshot,
            line.original.unit_snapshot,
            line.quantityMilli,
            line.refundSubtotalMinor,
            line.refundDiscountMinor,
            line.refundTaxMinor,
            line.refundTotalMinor,
          );
        if (line.original.product_id) {
          this.database
            .prepare(
              "INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, reference_type, reference_id, reason, actor_user_id) VALUES (?, ?, ?, ?, 'return', ?, 'sale_return', ?, ?, ?)",
            )
            .run(
              randomUUID(),
              this.storeId,
              this.counterId,
              line.original.product_id,
              line.quantityMilli,
              returnId,
              `${input.operation === 'void' ? 'Voided sale' : 'Returned sale'} ${sale.receipt_number}: ${input.reason}`,
              this.actorUserId,
            );
        }
      }
      if (totalMinor > 0)
        this.database
          .prepare(
            'INSERT INTO sale_return_payments (id, sale_return_id, payment_method, amount_minor, reference) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            returnId,
            input.refundPaymentMethod,
            totalMinor,
            input.refundReference || null,
          );
      const receiptSnapshot = this.database
        .prepare(
          'SELECT business_profile_json, receipt_config_json FROM receipt_snapshots WHERE sale_id = ?',
        )
        .get(sale.id) as { business_profile_json: string; receipt_config_json: string } | undefined;
      if (!receiptSnapshot)
        throw new Error('Original receipt snapshot is missing; return was not posted.');
      this.database
        .prepare(
          'INSERT INTO return_receipt_snapshots (id, sale_return_id, business_profile_json, receipt_config_json) VALUES (?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          returnId,
          receiptSnapshot.business_profile_json,
          receiptSnapshot.receipt_config_json,
        );
      let newSaleStatus: string;
      if (input.operation === 'void') newSaleStatus = 'voided';
      else {
        const returned = this.database
          .prepare(
            "SELECT COALESCE(SUM(rl.quantity_milli),0) AS quantity FROM sale_return_lines rl JOIN sale_returns sr ON sr.id = rl.sale_return_id WHERE rl.original_sale_line_id IN (SELECT id FROM sale_lines WHERE sale_id = ?) AND sr.status = 'completed'",
          )
          .get(sale.id) as { quantity: number };
        const sold = originalLines.reduce((sum, line) => sum + line.quantity_milli, 0);
        const allReturned = originalLines.every((line) => {
          const lineReturned = this.database
            .prepare(
              "SELECT COALESCE(SUM(rl.quantity_milli),0) AS quantity FROM sale_return_lines rl JOIN sale_returns sr ON sr.id = rl.sale_return_id WHERE rl.original_sale_line_id = ? AND sr.status = 'completed'",
            )
            .get(line.id) as { quantity: number };
          return lineReturned.quantity >= line.quantity_milli;
        });
        newSaleStatus = allReturned ? 'returned' : 'partially_returned';
        void returned;
        void sold;
      }
      this.database.prepare('UPDATE sales SET status = ? WHERE id = ?').run(newSaleStatus, sale.id);
      this.database
        .prepare(
          'INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          input.operation === 'void' ? 'sale.voided' : 'sale.returned',
          input.operation === 'void' ? 'sale' : 'sale_return',
          returnId,
          JSON.stringify({ saleId: sale.id, status: sale.status }),
          JSON.stringify({
            returnId,
            returnNumber,
            saleId: sale.id,
            status: newSaleStatus,
            totalMinor,
            lines: calculatedLines,
          }),
          input.reason,
        );
      this.database
        .prepare(
          'INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          input.operation === 'void' ? 'sale.voided' : 'sale.return.completed',
          input.operation === 'void' ? 'sale' : 'sale_return',
          returnId,
          JSON.stringify({
            schemaVersion: 1,
            returnId,
            returnNumber,
            saleId: sale.id,
            operation: input.operation,
            totalMinor,
            reason: input.reason,
            lines: calculatedLines.map((line) => ({
              saleLineId: line.original.id,
              productId: line.original.product_id,
              quantityMilli: line.quantityMilli,
              refundTotalMinor: line.refundTotalMinor,
            })),
          }),
        );
      return this.loadResult(returnId);
    });
  }

  private loadResult(returnId: string): SaleReturnResult {
    const header = this.database
      .prepare(
        `SELECT sr.id, sr.return_number AS returnNumber, sr.sale_id AS saleId, s.receipt_number AS originalReceiptNumber, sr.operation, sr.reason, sr.currency_code AS currencyCode, sr.total_minor AS totalMinor, sr.created_at AS createdAt, COALESCE(json_extract(snap.business_profile_json, '$.name'), 'My Store') AS businessName, COALESCE(json_extract(snap.business_profile_json, '$.address'), '') AS businessAddress, COALESCE(json_extract(snap.business_profile_json, '$.phone'), '') AS businessPhone, COALESCE(json_extract(snap.business_profile_json, '$.businessRegistrationNumber'), '') AS businessRegistrationNumber, COALESCE(json_extract(snap.receipt_config_json, '$.receiptFooter'), '') AS receiptFooter, COALESCE(json_extract(snap.receipt_config_json, '$.receiptPaperWidthMm'), 80) AS receiptPaperWidthMm FROM sale_returns sr JOIN sales s ON s.id = sr.sale_id JOIN return_receipt_snapshots snap ON snap.sale_return_id = sr.id WHERE sr.id = ?`,
      )
      .get(returnId) as Omit<SaleReturnResult, 'lines' | 'payments'> | undefined;
    if (!header)
      throw new Error(
        'Return was saved but its receipt could not be reloaded. Preserve the return number and inspect the database.',
      );
    const lines = this.database
      .prepare(
        'SELECT product_name_snapshot AS productName, unit_snapshot AS unit, quantity_milli AS quantityMilli, refund_total_minor AS refundTotalMinor FROM sale_return_lines WHERE sale_return_id = ? ORDER BY rowid',
      )
      .all(returnId);
    const payments = this.database
      .prepare(
        "SELECT payment_method AS paymentMethod, amount_minor AS amountMinor, COALESCE(reference, '') AS reference FROM sale_return_payments WHERE sale_return_id = ? ORDER BY rowid",
      )
      .all(returnId);
    return SaleReturnResultSchema.parse({ ...header, lines, payments });
  }
}
