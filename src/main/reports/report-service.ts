import type { DatabaseSync } from 'node:sqlite';
import {
  ReportQuerySchema,
  SalesReportSchema,
  type ReportQuery,
  type SalesReport,
} from '../../shared/contracts/reports';

export class ReportService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
  ) {}

  sales(rawQuery: unknown = {}): SalesReport {
    const query: ReportQuery = ReportQuerySchema.parse(rawQuery);
    const clauses = ['store_id = ?', "status = 'completed'", 'completed_at IS NOT NULL'];
    const params: (string | number)[] = [this.storeId];
    if (query.fromDate) {
      clauses.push('date(completed_at) >= ?');
      params.push(query.fromDate);
    }
    if (query.toDate) {
      clauses.push('date(completed_at) <= ?');
      params.push(query.toDate);
    }
    const where = clauses.join(' AND ');
    const summary = this.database
      .prepare(
        `SELECT COUNT(*) AS sale_count, COALESCE(SUM(subtotal_minor),0) AS subtotal_minor, COALESCE(SUM(discount_minor),0) AS discount_minor, COALESCE(SUM(tax_minor),0) AS tax_minor, COALESCE(SUM(total_minor),0) AS total_minor FROM sales WHERE ${where}`,
      )
      .get(...params) as {
      sale_count: number;
      subtotal_minor: number;
      discount_minor: number;
      tax_minor: number;
      total_minor: number;
    };
    const daily = this.database
      .prepare(
        `SELECT date(completed_at) AS date, COUNT(*) AS sale_count, COALESCE(SUM(total_minor),0) AS total_minor FROM sales WHERE ${where} GROUP BY date(completed_at) ORDER BY date DESC LIMIT 90`,
      )
      .all(...params) as { date: string; sale_count: number; total_minor: number }[];
    const byPaymentMethod = this.database
      .prepare(
        `SELECT p.payment_method AS method, COALESCE(SUM(p.amount_minor),0) AS amount_minor, COUNT(*) AS payment_count FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE ${where.replaceAll('store_id', 's.store_id').replaceAll('status', 's.status').replaceAll('completed_at', 's.completed_at')} GROUP BY p.payment_method ORDER BY amount_minor DESC`,
      )
      .all(...params) as { method: string; amount_minor: number; payment_count: number }[];
    const topProducts = this.database
      .prepare(
        `SELECT sl.product_name_snapshot AS product_name, COALESCE(SUM(sl.quantity_milli),0) AS quantity_milli, COALESCE(SUM(sl.line_total_minor),0) AS total_minor FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE ${where.replaceAll('store_id', 's.store_id').replaceAll('status', 's.status').replaceAll('completed_at', 's.completed_at')} GROUP BY sl.product_name_snapshot ORDER BY total_minor DESC LIMIT 10`,
      )
      .all(...params) as { product_name: string; quantity_milli: number; total_minor: number }[];
    const inventory = this.database
      .prepare(
        `SELECT COUNT(*) AS active_products, SUM(CASE WHEN COALESCE(stock.quantity_milli,0) > 0 THEN 1 ELSE 0 END) AS stocked_products, COALESCE(SUM(MAX(COALESCE(stock.quantity_milli,0),0)),0) AS quantity_milli, COALESCE(ROUND(SUM(MAX(COALESCE(stock.quantity_milli,0),0) * p.purchase_cost_minor / 1000.0)),0) AS estimated_cost_value_minor FROM products p LEFT JOIN (SELECT product_id, SUM(quantity_delta_milli) AS quantity_milli FROM stock_movements WHERE counter_id = ? GROUP BY product_id) stock ON stock.product_id = p.id WHERE p.store_id = ? AND p.is_active = 1 AND p.archived_at IS NULL`,
      )
      .get(this.counterId, this.storeId) as {
      active_products: number;
      stocked_products: number | null;
      quantity_milli: number;
      estimated_cost_value_minor: number;
    };
    return SalesReportSchema.parse({
      fromDate: query.fromDate ?? null,
      toDate: query.toDate ?? null,
      saleCount: summary.sale_count,
      subtotalMinor: summary.subtotal_minor,
      discountMinor: summary.discount_minor,
      taxMinor: summary.tax_minor,
      totalMinor: summary.total_minor,
      daily: daily.map((row) => ({
        date: row.date,
        saleCount: row.sale_count,
        totalMinor: row.total_minor,
      })),
      byPaymentMethod: byPaymentMethod.map((row) => ({
        method: row.method,
        amountMinor: row.amount_minor,
        paymentCount: row.payment_count,
      })),
      topProducts: topProducts.map((row) => ({
        productName: row.product_name,
        quantityMilli: row.quantity_milli,
        totalMinor: row.total_minor,
      })),
      inventory: {
        activeProducts: inventory.active_products,
        stockedProducts: inventory.stocked_products ?? 0,
        quantityMilli: inventory.quantity_milli,
        estimatedCostValueMinor: inventory.estimated_cost_value_minor,
      },
    });
  }
}
