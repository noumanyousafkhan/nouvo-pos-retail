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
    const clauses = [
      's.store_id = ?',
      "s.status IN ('completed','partially_returned','returned')",
      's.completed_at IS NOT NULL',
    ];
    const params: (string | number)[] = [this.storeId];
    if (query.fromDate) {
      clauses.push('date(s.completed_at) >= ?');
      params.push(query.fromDate);
    }
    if (query.toDate) {
      clauses.push('date(s.completed_at) <= ?');
      params.push(query.toDate);
    }
    const where = clauses.join(' AND ');
    const refundAggregate = `SELECT sr.sale_id, SUM(sr.total_minor) AS refund_total_minor, COALESCE(SUM(rl.refund_subtotal_minor),0) AS refund_subtotal_minor, COALESCE(SUM(rl.refund_discount_minor),0) AS refund_discount_minor, COALESCE(SUM(rl.refund_tax_minor),0) AS refund_tax_minor FROM sale_returns sr LEFT JOIN sale_return_lines rl ON rl.sale_return_id = sr.id WHERE sr.status = 'completed' AND sr.operation = 'return' GROUP BY sr.sale_id`;
    const summary = this.database
      .prepare(
        `SELECT COUNT(*) AS sale_count, COALESCE(SUM(MAX(0, s.subtotal_minor - COALESCE(r.refund_subtotal_minor,0))),0) AS subtotal_minor, COALESCE(SUM(MAX(0, s.discount_minor - COALESCE(r.refund_discount_minor,0))),0) AS discount_minor, COALESCE(SUM(MAX(0, s.tax_minor - COALESCE(r.refund_tax_minor,0))),0) AS tax_minor, COALESCE(SUM(MAX(0, s.total_minor - COALESCE(r.refund_total_minor,0))),0) AS total_minor FROM sales s LEFT JOIN (${refundAggregate}) r ON r.sale_id = s.id WHERE ${where}`,
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
        `SELECT date(s.completed_at) AS date, COUNT(*) AS sale_count, COALESCE(SUM(MAX(0, s.total_minor - COALESCE(r.refund_total_minor,0))),0) AS total_minor FROM sales s LEFT JOIN (${refundAggregate}) r ON r.sale_id = s.id WHERE ${where} GROUP BY date(s.completed_at) ORDER BY date DESC LIMIT 90`,
      )
      .all(...params) as { date: string; sale_count: number; total_minor: number }[];
    const byPaymentMethod = this.database
      .prepare(
        `SELECT method, SUM(amount_minor) AS amount_minor, SUM(payment_count) AS payment_count FROM (SELECT p.payment_method AS method, SUM(p.amount_minor) AS amount_minor, COUNT(*) AS payment_count FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE ${where} GROUP BY p.payment_method UNION ALL SELECT rp.payment_method AS method, -SUM(rp.amount_minor) AS amount_minor, COUNT(*) AS payment_count FROM sale_return_payments rp JOIN sale_returns sr ON sr.id = rp.sale_return_id JOIN sales s ON s.id = sr.sale_id WHERE sr.operation = 'return' AND sr.status = 'completed' AND ${where} GROUP BY rp.payment_method) GROUP BY method ORDER BY amount_minor DESC`,
      )
      .all(...params, ...params) as {
      method: string;
      amount_minor: number;
      payment_count: number;
    }[];
    const byCategory = this.database
      .prepare(
        `SELECT COALESCE(NULLIF(trim(c.name),''),'Uncategorized') AS category_name,
          COUNT(DISTINCT s.id) AS sale_count,
          COALESCE(SUM(MAX(0, sl.line_total_minor - sl.tax_minor - sl.discount_minor - COALESCE(r.refund_subtotal_minor,0))),0) AS net_sales_minor,
          COALESCE(SUM(CASE WHEN sl.unit_cost_minor IS NOT NULL THEN ROUND(MAX(0, sl.quantity_milli - COALESCE(r.returned_quantity_milli,0)) * sl.unit_cost_minor / 1000.0) ELSE 0 END),0) AS cost_minor,
          COALESCE(SUM(CASE WHEN sl.unit_cost_minor IS NOT NULL THEN MAX(0, sl.quantity_milli - COALESCE(r.returned_quantity_milli,0)) ELSE 0 END),0) AS costed_quantity_milli,
          COALESCE(SUM(MAX(0, sl.quantity_milli - COALESCE(r.returned_quantity_milli,0))),0) AS net_quantity_milli
        FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
        LEFT JOIN products p ON p.id=sl.product_id
        LEFT JOIN categories c ON c.id=p.category_id
        LEFT JOIN (
          SELECT rl.original_sale_line_id, SUM(rl.quantity_milli) AS returned_quantity_milli,
            SUM(rl.refund_subtotal_minor) AS refund_subtotal_minor
          FROM sale_return_lines rl JOIN sale_returns sr ON sr.id=rl.sale_return_id
          WHERE sr.status='completed' AND sr.operation='return'
          GROUP BY rl.original_sale_line_id
        ) r ON r.original_sale_line_id=sl.id
        WHERE ${where}
        GROUP BY COALESCE(NULLIF(trim(c.name),''),'Uncategorized')
        ORDER BY net_sales_minor DESC, category_name`,
      )
      .all(...params) as {
      category_name: string;
      sale_count: number;
      net_sales_minor: number;
      cost_minor: number;
      costed_quantity_milli: number;
      net_quantity_milli: number;
    }[];
    const byCashier = this.database
      .prepare(
        `SELECT COALESCE(NULLIF(trim(u.display_name),''),'Unassigned cashier') AS cashier_name, COUNT(*) AS sale_count, COALESCE(SUM(MAX(0, s.total_minor - COALESCE(r.refund_total_minor,0))),0) AS total_minor FROM sales s LEFT JOIN users u ON u.id=s.cashier_user_id LEFT JOIN (${refundAggregate}) r ON r.sale_id=s.id WHERE ${where} GROUP BY s.cashier_user_id, u.display_name HAVING SUM(MAX(0, s.total_minor - COALESCE(r.refund_total_minor,0))) > 0 OR COUNT(*) > 0 ORDER BY total_minor DESC, cashier_name LIMIT 50`,
      )
      .all(...params) as { cashier_name: string; sale_count: number; total_minor: number }[];
    const topProducts = this.database
      .prepare(
        `SELECT sl.product_name_snapshot AS product_name, COALESCE(SUM(MAX(0, sl.quantity_milli - COALESCE(r.returned_quantity_milli,0))),0) AS quantity_milli, COALESCE(SUM(MAX(0, sl.line_total_minor - COALESCE(r.refund_total_minor,0))),0) AS total_minor FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id LEFT JOIN (SELECT rl.original_sale_line_id, SUM(rl.quantity_milli) AS returned_quantity_milli, SUM(rl.refund_total_minor) AS refund_total_minor FROM sale_return_lines rl JOIN sale_returns sr ON sr.id = rl.sale_return_id WHERE sr.status = 'completed' AND sr.operation = 'return' GROUP BY rl.original_sale_line_id) r ON r.original_sale_line_id = sl.id WHERE ${where} GROUP BY sl.product_name_snapshot HAVING SUM(MAX(0, sl.quantity_milli - COALESCE(r.returned_quantity_milli,0))) > 0 ORDER BY total_minor DESC LIMIT 10`,
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
      byCategory: byCategory.map((row) => ({
        categoryName: row.category_name,
        saleCount: row.sale_count,
        netSalesMinor: row.net_sales_minor,
        costMinor: row.cost_minor,
        grossMarginMinor: row.net_sales_minor - row.cost_minor,
        costCoveragePercent:
          row.net_quantity_milli > 0
            ? Math.round((row.costed_quantity_milli / row.net_quantity_milli) * 100)
            : 100,
      })),
      byCashier: byCashier.map((row) => ({
        cashierName: row.cashier_name,
        saleCount: row.sale_count,
        totalMinor: row.total_minor,
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
