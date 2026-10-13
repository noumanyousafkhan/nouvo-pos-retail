import type { DatabaseSync } from 'node:sqlite';
import {
  SaleListSchema,
  SalesListQuerySchema,
  type SaleListItem,
} from '../../shared/contracts/sales';
import { CheckoutService } from './checkout-service';

interface SaleListRow {
  id: string;
  receiptNumber: string;
  businessName: string | null;
  currencyCode: string;
  totalMinor: number;
  status: SaleListItem['status'];
  completedAt: string;
  itemCount: number;
  paymentMethods: string | null;
}

export class SalesService {
  private readonly checkoutService: CheckoutService;

  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
  ) {
    this.checkoutService = new CheckoutService(database, storeId, counterId);
  }

  list(rawQuery: unknown = {}): SaleListItem[] {
    const query = SalesListQuerySchema.parse(rawQuery);
    const conditions = ['s.store_id = ?', 's.counter_id = ?'];
    const parameters: (string | number)[] = [this.storeId, this.counterId];
    if (query.search) {
      conditions.push(
        `(s.receipt_number LIKE ? OR EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.sale_id = s.id AND sl.product_name_snapshot LIKE ?))`,
      );
      parameters.push(`%${query.search}%`, `%${query.search}%`);
    }
    if (query.fromDate) {
      conditions.push('date(s.completed_at) >= date(?)');
      parameters.push(query.fromDate);
    }
    if (query.toDate) {
      conditions.push('date(s.completed_at) <= date(?)');
      parameters.push(query.toDate);
    }
    parameters.push(query.limit);
    const rows = this.database
      .prepare(
        `
      SELECT s.id, s.receipt_number AS receiptNumber,
             json_extract(r.business_profile_json, '$.name') AS businessName,
             s.currency_code AS currencyCode, s.total_minor AS totalMinor,
             s.status, s.completed_at AS completedAt,
             (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS itemCount,
             (SELECT group_concat(DISTINCT payment_method) FROM sale_payments sp WHERE sp.sale_id = s.id) AS paymentMethods
      FROM sales s JOIN receipt_snapshots r ON r.sale_id = s.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.completed_at DESC, s.rowid DESC
      LIMIT ?
    `,
      )
      .all(...parameters) as unknown as SaleListRow[];
    return SaleListSchema.parse(
      rows.map((row) => ({
        ...row,
        businessName: row.businessName ?? 'My Store',
        paymentMethods: row.paymentMethods ? row.paymentMethods.split(',') : [],
      })),
    );
  }

  getById(id: string) {
    return this.checkoutService.getById(id);
  }
}
