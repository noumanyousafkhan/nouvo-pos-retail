import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  StockMovementInputSchema,
  type StockMovementInput,
  type StockSummary,
} from '../../shared/contracts/stock';
import { runInTransaction } from '../database/connection';

export class StockService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
  ) {}

  record(rawInput: unknown): StockSummary {
    const input: StockMovementInput = StockMovementInputSchema.parse(rawInput);
    const delta =
      input.movementType === 'write_off' ? -Math.abs(input.quantityMilli) : input.quantityMilli;
    if (input.movementType === 'receipt' && delta <= 0)
      throw new Error('Received quantity must be greater than zero.');
    if (input.movementType === 'write_off' && input.quantityMilli <= 0)
      throw new Error('Write-off quantity must be greater than zero.');

    return runInTransaction(this.database, () => {
      const product = this.database
        .prepare('SELECT id, is_active FROM products WHERE id = ? AND store_id = ?')
        .get(input.productId, this.storeId) as { id: string; is_active: number } | undefined;
      if (!product || product.is_active !== 1)
        throw new Error('Active product not found. Refresh inventory and try again.');

      const current = this.database
        .prepare(
          'SELECT COALESCE(SUM(quantity_delta_milli), 0) AS quantity FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(input.productId, this.counterId) as { quantity: number };
      const nextQuantity = current.quantity + delta;
      if (nextQuantity < 0)
        throw new Error(
          'This stock movement would make counter stock negative. Check the quantity and try again.',
        );

      const movementId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO stock_movements (id, store_id, counter_id, product_id, movement_type, quantity_delta_milli, unit_cost_minor, reference_type, reference_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_stock_entry', ?, ?)`,
        )
        .run(
          movementId,
          this.storeId,
          this.counterId,
          input.productId,
          input.movementType,
          delta,
          input.unitCostMinor ?? null,
          movementId,
          input.reason,
        );
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, ?, 'stock', ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          `stock.${input.movementType}`,
          input.productId,
          JSON.stringify({ quantityMilli: current.quantity }),
          JSON.stringify({ quantityMilli: nextQuantity, movementId, delta }),
          input.reason,
        );
      this.database
        .prepare(
          `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'stock.movement.recorded', 'stock_movement', ?, ?)`,
        )
        .run(
          randomUUID(),
          movementId,
          JSON.stringify({
            schemaVersion: 1,
            movementId,
            storeId: this.storeId,
            counterId: this.counterId,
            productId: input.productId,
            movementType: input.movementType,
            quantityDeltaMilli: delta,
            unitCostMinor: input.unitCostMinor ?? null,
            reason: input.reason,
          }),
        );
      const count = this.database
        .prepare(
          'SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ? AND counter_id = ?',
        )
        .get(input.productId, this.counterId) as { count: number };
      return {
        productId: input.productId,
        quantityMilli: nextQuantity,
        movementCount: count.count,
      };
    });
  }
}
