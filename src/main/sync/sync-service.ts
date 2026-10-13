import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runInTransaction } from '../database/connection';
import {
  SyncOverviewSchema,
  SyncSnapshotSchema,
  type SyncEvent,
} from '../../shared/contracts/sync';

type SyncStatus = 'not_configured' | 'idle' | 'syncing' | 'connected' | 'offline' | 'error';
export interface ClaimedEvent extends SyncEvent {
  attempts: number;
}

export class SyncService {
  constructor(
    private readonly database: DatabaseSync,
    readonly storeId: string,
    readonly counterId: string,
  ) {}

  initialize(configured: boolean): void {
    this.database
      .prepare(
        "UPDATE outbox_events SET status='pending', next_attempt_at=NULL WHERE status='in_flight'",
      )
      .run();
    this.database
      .prepare('INSERT OR IGNORE INTO sync_state (counter_id, status) VALUES (?, ?)')
      .run(this.counterId, configured ? 'idle' : 'not_configured');
    this.database
      .prepare(
        'UPDATE sync_state SET allocation_enforced = CASE WHEN ? = 1 THEN 1 ELSE allocation_enforced END WHERE counter_id = ?',
      )
      .run(configured ? 1 : 0, this.counterId);
    if (configured) this.setStatus('idle');
    else this.setStatus('not_configured');
  }

  getOverview(configured: boolean) {
    this.database
      .prepare('INSERT OR IGNORE INTO sync_state (counter_id, status) VALUES (?, ?)')
      .run(this.counterId, configured ? 'idle' : 'not_configured');
    const state = this.database
      .prepare(
        'SELECT status, last_attempt_at AS lastAttemptAt, last_success_at AS lastSuccessAt, last_error AS lastError FROM sync_state WHERE counter_id = ?',
      )
      .get(this.counterId) as {
      status: SyncStatus;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastError: string | null;
    };
    const counts = this.database
      .prepare(
        "SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pendingCount, SUM(CASE WHEN status='in_flight' THEN 1 ELSE 0 END) AS inFlightCount, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failedCount, SUM(CASE WHEN status='acknowledged' THEN 1 ELSE 0 END) AS acknowledgedCount FROM outbox_events",
      )
      .get() as {
      pendingCount: number | null;
      inFlightCount: number | null;
      failedCount: number | null;
      acknowledgedCount: number | null;
    };
    const events = this.database
      .prepare(
        'SELECT id, event_type AS eventType, aggregate_type AS aggregateType, aggregate_id AS aggregateId, status, attempts, next_attempt_at AS nextAttemptAt, last_error AS lastError, created_at AS createdAt FROM outbox_events ORDER BY created_at DESC LIMIT 100',
      )
      .all() as {
      id: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      status: 'pending' | 'in_flight' | 'acknowledged' | 'failed';
      attempts: number;
      nextAttemptAt: string | null;
      lastError: string | null;
      createdAt: string;
    }[];
    return SyncOverviewSchema.parse({
      configured,
      status: configured ? state.status : 'not_configured',
      pendingCount: counts.pendingCount ?? 0,
      inFlightCount: counts.inFlightCount ?? 0,
      failedCount: counts.failedCount ?? 0,
      acknowledgedCount: counts.acknowledgedCount ?? 0,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      events,
    });
  }

  retryFailed(): number {
    const result = this.database
      .prepare(
        "UPDATE outbox_events SET status='pending', attempts=0, next_attempt_at=NULL, last_error=NULL WHERE status='failed'",
      )
      .run();
    if (Number(result.changes) > 0) this.setStatus('idle');
    return Number(result.changes);
  }

  claimBatch(limit = 50): ClaimedEvent[] {
    return runInTransaction(this.database, () => {
      const rows = this.database
        .prepare(
          "SELECT id, event_type AS eventType, schema_version AS schemaVersion, aggregate_type AS aggregateType, aggregate_id AS aggregateId, payload_json AS payloadJson, created_at AS createdAt, attempts FROM outbox_events WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at, rowid LIMIT ?",
        )
        .all(new Date().toISOString(), Math.max(1, Math.min(100, Math.trunc(limit)))) as {
        id: string;
        eventType: string;
        schemaVersion: number;
        aggregateType: string;
        aggregateId: string;
        payloadJson: string;
        createdAt: string;
        attempts: number;
      }[];
      const update = this.database.prepare(
        "UPDATE outbox_events SET status='in_flight', attempts=attempts+1, last_error=NULL WHERE id=? AND status='pending'",
      );
      const claimed: ClaimedEvent[] = [];
      for (const row of rows) {
        if (Number(update.run(row.id).changes) !== 1) continue;
        claimed.push({
          id: row.id,
          eventType: row.eventType,
          schemaVersion: row.schemaVersion,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          payload: JSON.parse(row.payloadJson) as unknown,
          createdAt: row.createdAt,
          attempts: row.attempts + 1,
        });
      }
      return claimed;
    });
  }

  acknowledge(eventIds: string[]): void {
    const update = this.database.prepare(
      "UPDATE outbox_events SET status='acknowledged', next_attempt_at=NULL, last_error=NULL, acknowledged_at=? WHERE id=? AND status='in_flight'",
    );
    const now = new Date().toISOString();
    for (const id of eventIds) update.run(now, id);
  }

  reject(eventId: string, message: string, retryable: boolean): void {
    const row = this.database
      .prepare("SELECT attempts FROM outbox_events WHERE id=? AND status='in_flight'")
      .get(eventId) as { attempts: number } | undefined;
    if (!row) return;
    const failed = !retryable || row.attempts >= 8;
    const nextAttemptAt = failed
      ? null
      : new Date(
          Date.now() + Math.min(3600, 5 * 2 ** Math.max(0, row.attempts - 1)) * 1000,
        ).toISOString();
    this.database
      .prepare('UPDATE outbox_events SET status=?, next_attempt_at=?, last_error=? WHERE id=?')
      .run(failed ? 'failed' : 'pending', nextAttemptAt, message.slice(0, 1000), eventId);
  }

  failTransient(eventIds: string[], message: string, retryable = true): void {
    for (const id of eventIds) this.reject(id, message, retryable);
  }

  applySnapshot(rawSnapshot: unknown): void {
    const snapshot = SyncSnapshotSchema.parse(rawSnapshot);
    if (snapshot.storeId !== this.storeId || snapshot.counterId !== this.counterId)
      throw new Error('Sync snapshot belongs to a different store or counter.');
    const unresolved = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM outbox_events WHERE status IN ('pending','in_flight','failed')",
      )
      .get() as { count: number };
    if (unresolved.count > 0)
      throw new Error('Sync snapshot deferred while local events remain pending or failed.');
    if (snapshot.settings && snapshot.settings.storeId !== this.storeId)
      throw new Error('Sync settings belong to a different store.');

    runInTransaction(this.database, () => {
      if (snapshot.settings) {
        const settings = snapshot.settings;
        this.database
          .prepare(
            'UPDATE stores SET name = ?, currency_code = ?, timezone = ?, tax_behavior = ?, address = ?, phone = ?, business_registration_number = ?, receipt_footer = ?, receipt_paper_width_mm = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            settings.name,
            settings.currencyCode,
            settings.timezone,
            settings.taxBehavior,
            settings.address,
            settings.phone,
            settings.businessRegistrationNumber,
            settings.receiptFooter,
            settings.receiptPaperWidthMm,
            snapshot.generatedAt,
            this.storeId,
          );
      }
      this.database
        .prepare(
          'DELETE FROM product_barcodes WHERE product_id IN (SELECT id FROM products WHERE store_id = ?)',
        )
        .run(this.storeId);
      for (const product of snapshot.products) {
        let categoryId: string | null = null;
        const categoryName = product.categoryName.trim();
        if (categoryName) {
          const existingCategory = this.database
            .prepare('SELECT id FROM categories WHERE store_id = ? AND name = ? COLLATE NOCASE')
            .get(this.storeId, categoryName) as { id: string } | undefined;
          categoryId = existingCategory?.id ?? randomUUID();
          if (!existingCategory)
            this.database
              .prepare('INSERT INTO categories (id, store_id, name) VALUES (?, ?, ?)')
              .run(categoryId, this.storeId, categoryName);
        }
        this.database
          .prepare(
            'INSERT INTO products (id, store_id, category_id, sku, name, description, base_unit, purchase_cost_minor, selling_price_minor, tax_rate_basis_points, is_active, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, sku=excluded.sku, name=excluded.name, description=excluded.description, base_unit=excluded.base_unit, purchase_cost_minor=excluded.purchase_cost_minor, selling_price_minor=excluded.selling_price_minor, tax_rate_basis_points=excluded.tax_rate_basis_points, is_active=excluded.is_active, updated_at=excluded.updated_at, archived_at=CASE WHEN excluded.is_active=0 THEN COALESCE(products.archived_at, excluded.updated_at) ELSE NULL END',
          )
          .run(
            product.id,
            this.storeId,
            categoryId,
            product.sku,
            product.name,
            product.description || null,
            product.baseUnit,
            product.purchaseCostMinor,
            product.sellingPriceMinor,
            product.taxRateBasisPoints,
            product.isActive ? 1 : 0,
            product.createdAt,
            product.updatedAt,
            product.isActive ? null : product.updatedAt,
          );
        const insertBarcode = this.database.prepare(
          'INSERT INTO product_barcodes (id, product_id, barcode) VALUES (?, ?, ?)',
        );
        for (const barcode of product.barcodes)
          insertBarcode.run(randomUUID(), product.id, barcode);
      }

      this.database
        .prepare('DELETE FROM counter_stock_allocations WHERE counter_id = ?')
        .run(this.counterId);
      const insertAllocation = this.database.prepare(
        'INSERT INTO counter_stock_allocations (counter_id, product_id, remaining_quantity_milli, updated_at) VALUES (?, ?, ?, ?)',
      );
      for (const allocation of snapshot.allocations) {
        if (allocation.quantityMilli <= 0) continue;
        const currentBalance = this.database
          .prepare(
            'SELECT COALESCE(SUM(quantity_delta_milli), 0) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
          )
          .get(allocation.productId, this.counterId) as { quantity: number };
        if (currentBalance.quantity < allocation.quantityMilli) {
          const product = this.database
            .prepare(
              'SELECT purchase_cost_minor AS purchaseCostMinor FROM products WHERE id = ? AND store_id = ?',
            )
            .get(allocation.productId, this.storeId) as { purchaseCostMinor: number } | undefined;
          this.database
            .prepare(
              "INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, unit_cost_minor, reference_type, reference_id, reason) VALUES (?, ?, ?, ?, 'allocation', ?, ?, 'sync_allocation', ?, ?)",
            )
            .run(
              randomUUID(),
              this.storeId,
              this.counterId,
              allocation.productId,
              allocation.quantityMilli - currentBalance.quantity,
              product?.purchaseCostMinor ?? null,
              snapshot.generatedAt,
              'Central stock allocation synchronized',
            );
        }
        insertAllocation.run(
          this.counterId,
          allocation.productId,
          allocation.quantityMilli,
          snapshot.generatedAt,
        );
      }
      this.database
        .prepare(
          'UPDATE sync_state SET allocation_enforced = 1, updated_at = ? WHERE counter_id = ?',
        )
        .run(snapshot.generatedAt, this.counterId);
    });
  }

  setStatus(
    status: SyncStatus,
    error: string | null = null,
    attempted = false,
    succeeded = false,
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        'INSERT INTO sync_state (counter_id, status, last_attempt_at, last_success_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(counter_id) DO UPDATE SET status=excluded.status, last_attempt_at=COALESCE(excluded.last_attempt_at, sync_state.last_attempt_at), last_success_at=COALESCE(excluded.last_success_at, sync_state.last_success_at), last_error=excluded.last_error, updated_at=excluded.updated_at',
      )
      .run(this.counterId, status, attempted ? now : null, succeeded ? now : null, error, now);
  }
}
