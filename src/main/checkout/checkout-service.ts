import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CheckoutInputSchema,
  SaleResultSchema,
  type CheckoutInput,
  type SaleResult,
} from '../../shared/contracts/checkout';
import { runInTransaction } from '../database/connection';

interface ProductForSale {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  base_unit: string;
  selling_price_minor: number;
  purchase_cost_minor: number;
  tax_rate_basis_points: number;
  is_active: number;
}

function safeMinor(value: number, label: string): number {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0)
    throw new Error(`${label} exceeds the supported currency amount.`);
  return rounded;
}

export class CheckoutService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
  ) {}

  complete(rawInput: unknown): SaleResult {
    const input: CheckoutInput = CheckoutInputSchema.parse(rawInput);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return runInTransaction(this.database, () => {
      const prior = this.database
        .prepare('SELECT id, request_hash FROM sales WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as { id: string; request_hash: string } | undefined;
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new Error(
            'This checkout request key was already used for a different sale. Refresh the checkout and try again.',
          );
        return this.loadSale(prior.id);
      }

      const mergedItems = new Map<string, number>();
      for (const item of input.items)
        mergedItems.set(
          item.productId,
          (mergedItems.get(item.productId) ?? 0) + item.quantityMilli,
        );
      const lines: SaleResult['lines'] = [];
      const stockDeltas: { productId: string; quantityMilli: number; unitCostMinor: number }[] = [];
      let subtotalMinor = 0;
      let taxMinor = 0;

      for (const [productId, quantityMilli] of mergedItems) {
        const product = this.database
          .prepare(
            `SELECT p.id, p.name, p.sku, p.base_unit, p.selling_price_minor, p.purchase_cost_minor, p.tax_rate_basis_points, p.is_active, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.product_id = p.id ORDER BY pb.created_at LIMIT 1) AS barcode FROM products p WHERE p.id = ? AND p.store_id = ?`,
          )
          .get(productId, this.storeId) as ProductForSale | undefined;
        if (!product || product.is_active !== 1)
          throw new Error(
            'A cart product is no longer active. Refresh inventory and review the cart.',
          );
        const balance = this.database
          .prepare(
            'SELECT COALESCE(SUM(quantity_delta_milli), 0) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
          )
          .get(productId, this.counterId) as { quantity: number };
        if (balance.quantity < quantityMilli)
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${(balance.quantity / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${product.base_unit}.`,
          );

        const lineSubtotal = safeMinor(
          (product.selling_price_minor * quantityMilli) / 1000,
          'Line subtotal',
        );
        const lineTax = safeMinor(
          (lineSubtotal * product.tax_rate_basis_points) / 10000,
          'Line tax',
        );
        const lineTotal = safeMinor(lineSubtotal + lineTax, 'Line total');
        subtotalMinor = safeMinor(subtotalMinor + lineSubtotal, 'Sale subtotal');
        taxMinor = safeMinor(taxMinor + lineTax, 'Sale tax');
        lines.push({
          productId,
          productName: product.name,
          productCode: product.sku ?? product.barcode,
          unit: product.base_unit,
          quantityMilli,
          unitPriceMinor: product.selling_price_minor,
          taxMinor: lineTax,
          lineTotalMinor: lineTotal,
        });
        stockDeltas.push({ productId, quantityMilli, unitCostMinor: product.purchase_cost_minor });
      }

      const totalMinor = safeMinor(subtotalMinor + taxMinor, 'Sale total');
      if (totalMinor <= 0) throw new Error('Sale total must be greater than zero.');
      const appliedTotal = input.paymentLines.reduce(
        (sum, payment) => safeMinor(sum + payment.amountMinor, 'Payment total'),
        0,
      );
      if (appliedTotal !== totalMinor)
        throw new Error(
          `Payment amounts must equal the sale total of ${(totalMinor / 100).toFixed(2)}.`,
        );

      const payments: SaleResult['payments'] = input.paymentLines.map((payment) => {
        const tendered = payment.amountTenderedMinor ?? payment.amountMinor;
        if (payment.paymentMethod === 'cash' && tendered < payment.amountMinor)
          throw new Error('Cash tendered cannot be less than the cash amount applied to the sale.');
        if (payment.paymentMethod !== 'cash' && tendered !== payment.amountMinor)
          throw new Error('Tendered amount must equal the applied amount for non-cash payments.');
        return {
          paymentMethod: payment.paymentMethod,
          amountMinor: payment.amountMinor,
          amountTenderedMinor: tendered,
          changeDueMinor: payment.paymentMethod === 'cash' ? tendered - payment.amountMinor : 0,
          reference: payment.reference,
        };
      });
      const changeDueMinor = payments.reduce(
        (sum, payment) => safeMinor(sum + payment.changeDueMinor, 'Change due'),
        0,
      );
      const now = new Date().toISOString();
      const nextReceipt = this.database
        .prepare(
          'SELECT COALESCE(MAX(CAST(receipt_number AS INTEGER)), 0) + 1 AS next FROM sales WHERE counter_id = ?',
        )
        .get(this.counterId) as { next: number };
      const receiptNumber = String(nextReceipt.next).padStart(6, '0');
      const saleId = randomUUID();
      const currency = this.database
        .prepare('SELECT name, currency_code, timezone FROM stores WHERE id = ?')
        .get(this.storeId) as { name: string; currency_code: string; timezone: string };
      const result: SaleResult = {
        id: saleId,
        receiptNumber,
        businessName: currency.name,
        currencyCode: currency.currency_code,
        subtotalMinor,
        discountMinor: 0,
        taxMinor,
        totalMinor,
        changeDueMinor,
        completedAt: now,
        lines,
        payments,
      };

      this.database
        .prepare(
          `INSERT INTO sales (id, store_id, counter_id, receipt_number, status, currency_code, subtotal_minor, discount_minor, tax_minor, total_minor, completed_at, idempotency_key, request_hash, change_due_minor) VALUES (?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          saleId,
          this.storeId,
          this.counterId,
          receiptNumber,
          currency.currency_code,
          subtotalMinor,
          taxMinor,
          totalMinor,
          now,
          input.idempotencyKey,
          requestHash,
          changeDueMinor,
        );
      const insertLine = this.database.prepare(
        'INSERT INTO sale_lines (id, sale_id, product_id, product_name_snapshot, product_code_snapshot, unit_snapshot, quantity_milli, unit_price_minor, discount_minor, tax_minor, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      );
      for (const line of lines)
        insertLine.run(
          randomUUID(),
          saleId,
          line.productId,
          line.productName,
          line.productCode,
          line.unit,
          line.quantityMilli,
          line.unitPriceMinor,
          line.taxMinor,
          line.lineTotalMinor,
        );
      const insertPayment = this.database.prepare(
        'INSERT INTO sale_payments (id, sale_id, payment_method, amount_minor, reference, amount_tendered_minor, change_due_minor) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const payment of payments)
        insertPayment.run(
          randomUUID(),
          saleId,
          payment.paymentMethod,
          payment.amountMinor,
          payment.reference || null,
          payment.amountTenderedMinor,
          payment.changeDueMinor,
        );

      const insertMovement = this.database.prepare(
        `INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, unit_cost_minor, reference_type, reference_id, reason) VALUES (?, ?, ?, ?, 'sale', ?, ?, 'sale', ?, ?)`,
      );
      for (const movement of stockDeltas)
        insertMovement.run(
          randomUUID(),
          this.storeId,
          this.counterId,
          movement.productId,
          -movement.quantityMilli,
          movement.unitCostMinor,
          saleId,
          `Sale ${receiptNumber}`,
        );

      this.database
        .prepare(
          'INSERT INTO receipt_snapshots (id, sale_id, business_profile_json, receipt_config_json) VALUES (?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          saleId,
          JSON.stringify({
            storeId: this.storeId,
            name: currency.name,
            currencyCode: currency.currency_code,
            timezone: currency.timezone,
          }),
          JSON.stringify({ paperWidthMm: 80, taxBehavior: 'exclusive', footer: '' }),
        );
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, after_json) VALUES (?, ?, 'sale.completed', 'sale', ?, ?)`,
        )
        .run(randomUUID(), this.storeId, saleId, JSON.stringify(result));
      this.database
        .prepare(
          `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'sale.completed', 'sale', ?, ?)`,
        )
        .run(
          randomUUID(),
          saleId,
          JSON.stringify({ schemaVersion: 1, sale: result, idempotencyKey: input.idempotencyKey }),
        );
      return SaleResultSchema.parse(result);
    });
  }

  getById(rawSaleId: string): SaleResult {
    const saleId = rawSaleId;
    const saleExists = this.database
      .prepare('SELECT 1 AS found FROM sales WHERE id = ? AND store_id = ? AND counter_id = ?')
      .get(saleId, this.storeId, this.counterId);
    if (!saleExists) throw new Error('Sale was not found on this counter.');
    return this.loadSale(saleId);
  }

  private loadSale(saleId: string): SaleResult {
    const sale = this.database
      .prepare(
        `SELECT s.id, s.receipt_number AS receiptNumber, s.currency_code AS currencyCode, s.subtotal_minor AS subtotalMinor, s.discount_minor AS discountMinor, s.tax_minor AS taxMinor, s.total_minor AS totalMinor, s.change_due_minor AS changeDueMinor, s.completed_at AS completedAt, json_extract(r.business_profile_json, '$.name') AS businessName FROM sales s JOIN receipt_snapshots r ON r.sale_id = s.id WHERE s.id = ?`,
      )
      .get(saleId) as Omit<SaleResult, 'lines' | 'payments'> | undefined;
    if (!sale)
      throw new Error(
        'Previously completed sale could not be reloaded. Inspect the local database before retrying.',
      );
    const lines = this.database
      .prepare(
        'SELECT product_id AS productId, product_name_snapshot AS productName, product_code_snapshot AS productCode, unit_snapshot AS unit, quantity_milli AS quantityMilli, unit_price_minor AS unitPriceMinor, tax_minor AS taxMinor, line_total_minor AS lineTotalMinor FROM sale_lines WHERE sale_id = ? ORDER BY rowid',
      )
      .all(saleId);
    const payments = this.database
      .prepare(
        "SELECT payment_method AS paymentMethod, amount_minor AS amountMinor, amount_tendered_minor AS amountTenderedMinor, change_due_minor AS changeDueMinor, COALESCE(reference, '') AS reference FROM sale_payments WHERE sale_id = ? ORDER BY rowid",
      )
      .all(saleId);
    return SaleResultSchema.parse({ ...sale, lines, payments });
  }
}
