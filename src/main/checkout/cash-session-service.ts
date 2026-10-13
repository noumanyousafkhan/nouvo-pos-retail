import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CashMovementInputSchema,
  CashSessionSchema,
  CloseCashierSessionSchema,
  OpenCashierSessionSchema,
  type CashSession,
} from '../../shared/contracts/cash-sessions';
import { runInTransaction } from '../database/connection';

interface SessionRow {
  id: string;
  counter_id: string;
  opened_by_user_id: string;
  opened_by_name: string;
  status: 'open' | 'closed';
  opening_float_minor: number;
  expected_cash_minor: number | null;
  counted_cash_minor: number | null;
  variance_minor: number | null;
  opening_note: string | null;
  closing_note: string | null;
  opened_at: string;
  closed_at: string | null;
}

export class CashSessionService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
    private readonly actorUserId: string,
    private readonly actorRole: string = 'cashier',
  ) {}

  getActive(): CashSession | null {
    const row = this.database
      .prepare(
        `SELECT cs.id, cs.counter_id, cs.opened_by_user_id, u.display_name AS opened_by_name, cs.status, cs.opening_float_minor, cs.expected_cash_minor, cs.counted_cash_minor, cs.variance_minor, cs.opening_note, cs.closing_note, cs.opened_at, cs.closed_at FROM cashier_sessions cs JOIN users u ON u.id = cs.opened_by_user_id WHERE cs.store_id = ? AND cs.counter_id = ? AND cs.status = 'open'`,
      )
      .get(this.storeId, this.counterId) as unknown as SessionRow | undefined;
    return row ? this.mapSession(row, this.calculateCash(row.id, row.opening_float_minor)) : null;
  }

  listHistory(): CashSession[] {
    const rows = this.database
      .prepare(
        `SELECT cs.id, cs.counter_id, cs.opened_by_user_id, u.display_name AS opened_by_name, cs.status, cs.opening_float_minor, cs.expected_cash_minor, cs.counted_cash_minor, cs.variance_minor, cs.opening_note, cs.closing_note, cs.opened_at, cs.closed_at FROM cashier_sessions cs JOIN users u ON u.id = cs.opened_by_user_id WHERE cs.store_id = ? AND cs.counter_id = ? AND cs.status = 'closed' ORDER BY cs.closed_at DESC LIMIT 30`,
      )
      .all(this.storeId, this.counterId) as unknown as SessionRow[];
    return rows.map((row) =>
      this.mapSession(row, this.calculateCash(row.id, row.opening_float_minor)),
    );
  }

  open(rawInput: unknown): CashSession {
    const input = OpenCashierSessionSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      if (
        this.database
          .prepare("SELECT 1 FROM cashier_sessions WHERE counter_id = ? AND status = 'open'")
          .get(this.counterId)
      )
        throw new Error(
          'This counter already has an open cashier shift. Close it before opening another.',
        );
      const id = randomUUID();
      this.database
        .prepare(
          "INSERT INTO cashier_sessions (id, store_id, counter_id, opened_by_user_id, status, opening_float_minor, opening_note) VALUES (?, ?, ?, ?, 'open', ?, ?)",
        )
        .run(
          id,
          this.storeId,
          this.counterId,
          this.actorUserId,
          input.openingFloatMinor,
          input.openingNote || null,
        );
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'cash_session.opened', 'cashier_session', ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          id,
          JSON.stringify({
            openingFloatMinor: input.openingFloatMinor,
            openingNote: input.openingNote,
          }),
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'cash_session.opened', 'cashier_session', ?, ?)",
        )
        .run(
          randomUUID(),
          id,
          JSON.stringify({
            schemaVersion: 1,
            sessionId: id,
            counterId: this.counterId,
            openingFloatMinor: input.openingFloatMinor,
          }),
        );
      return this.getActive()!;
    });
  }

  recordMovement(rawInput: unknown): CashSession {
    const input = CashMovementInputSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const session = this.getActive();
      if (!session) throw new Error('Open a cashier shift before recording a cash movement.');
      if (
        session.openedByUserId !== this.actorUserId &&
        !['owner', 'manager'].includes(this.actorRole)
      )
        throw new Error(
          'Only the cashier who opened this shift or an authorized manager can record cash movements.',
        );
      if (input.movementType === 'cash_out' && input.amountMinor > session.expectedCashMinor)
        throw new Error('Cash-out amount exceeds the expected cash in the drawer.');
      const id = randomUUID();
      this.database
        .prepare(
          'INSERT INTO cash_movements (id, store_id, counter_id, session_id, movement_type, amount_minor, reason, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          this.storeId,
          this.counterId,
          session.id,
          input.movementType,
          input.amountMinor,
          input.reason,
          this.actorUserId,
        );
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json, reason) VALUES (?, ?, ?, ?, 'cash_movement', ?, ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          input.movementType === 'cash_in' ? 'cash_session.cash_in' : 'cash_session.cash_out',
          id,
          JSON.stringify({
            sessionId: session.id,
            amountMinor: input.amountMinor,
            reason: input.reason,
          }),
          input.reason,
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, 'cash_movement', ?, ?)",
        )
        .run(
          randomUUID(),
          `cash_session.${input.movementType}`,
          id,
          JSON.stringify({ schemaVersion: 1, sessionId: session.id, ...input }),
        );
      return this.getActive()!;
    });
  }

  close(rawInput: unknown): CashSession {
    const input = CloseCashierSessionSchema.parse(rawInput);
    return runInTransaction(this.database, () => {
      const session = this.getActive();
      if (!session) throw new Error('There is no open cashier shift to close.');
      if (
        session.openedByUserId !== this.actorUserId &&
        !['owner', 'manager'].includes(this.actorRole)
      )
        throw new Error(
          'Only the cashier who opened this shift or an authorized manager can close it.',
        );
      const expectedCashMinor = session.expectedCashMinor;
      const varianceMinor = input.countedCashMinor - expectedCashMinor;
      const closedAt = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE cashier_sessions SET status = 'closed', expected_cash_minor = ?, counted_cash_minor = ?, variance_minor = ?, closing_note = ?, closed_by_user_id = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'",
        )
        .run(
          expectedCashMinor,
          input.countedCashMinor,
          varianceMinor,
          input.closingNote || null,
          this.actorUserId,
          closedAt,
          closedAt,
          session.id,
        );
      this.database
        .prepare(
          "INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason) VALUES (?, ?, ?, 'cash_session.closed', 'cashier_session', ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          this.storeId,
          this.actorUserId,
          session.id,
          JSON.stringify({ status: 'open', openingFloatMinor: session.openingFloatMinor }),
          JSON.stringify({
            status: 'closed',
            expectedCashMinor,
            countedCashMinor: input.countedCashMinor,
            varianceMinor,
          }),
          input.closingNote || null,
        );
      this.database
        .prepare(
          "INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'cash_session.closed', 'cashier_session', ?, ?)",
        )
        .run(
          randomUUID(),
          session.id,
          JSON.stringify({
            schemaVersion: 1,
            sessionId: session.id,
            expectedCashMinor,
            countedCashMinor: input.countedCashMinor,
            varianceMinor,
            closingNote: input.closingNote,
          }),
        );
      const row = this.database
        .prepare(
          `SELECT cs.id, cs.counter_id, cs.opened_by_user_id, u.display_name AS opened_by_name, cs.status, cs.opening_float_minor, cs.expected_cash_minor, cs.counted_cash_minor, cs.variance_minor, cs.opening_note, cs.closing_note, cs.opened_at, cs.closed_at FROM cashier_sessions cs JOIN users u ON u.id = cs.opened_by_user_id WHERE cs.id = ?`,
        )
        .get(session.id) as unknown as SessionRow;
      return this.mapSession(row, {
        cashSalesMinor: session.cashSalesMinor,
        cashRefundsMinor: session.cashRefundsMinor,
        cashInMinor: session.cashInMinor,
        cashOutMinor: session.cashOutMinor,
        expectedCashMinor,
      });
    });
  }

  private calculateCash(sessionId: string, openingFloatMinor: number) {
    const cashSales = this.database
      .prepare(
        "SELECT COALESCE(SUM(MAX(0, p.amount_tendered_minor - p.change_due_minor)),0) AS amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.cashier_session_id = ? AND p.payment_method = 'cash' AND s.status IN ('completed','partially_returned','returned')",
      )
      .get(sessionId) as { amount: number };
    const cashRefunds = this.database
      .prepare(
        "SELECT COALESCE(SUM(rp.amount_minor),0) AS amount FROM sale_return_payments rp JOIN sale_returns sr ON sr.id = rp.sale_return_id WHERE sr.cashier_session_id = ? AND rp.payment_method = 'cash' AND sr.status = 'completed'",
      )
      .get(sessionId) as { amount: number };
    const movements = this.database
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount_minor ELSE 0 END),0) AS cash_in, COALESCE(SUM(CASE WHEN movement_type = 'cash_out' THEN amount_minor ELSE 0 END),0) AS cash_out FROM cash_movements WHERE session_id = ?",
      )
      .get(sessionId) as { cash_in: number; cash_out: number };
    return {
      cashSalesMinor: cashSales.amount,
      cashRefundsMinor: cashRefunds.amount,
      cashInMinor: movements.cash_in,
      cashOutMinor: movements.cash_out,
      expectedCashMinor:
        openingFloatMinor +
        cashSales.amount -
        cashRefunds.amount +
        movements.cash_in -
        movements.cash_out,
    };
  }

  private mapSession(
    row: SessionRow,
    totals: ReturnType<CashSessionService['calculateCash']>,
  ): CashSession {
    return CashSessionSchema.parse({
      id: row.id,
      counterId: row.counter_id,
      openedByUserId: row.opened_by_user_id,
      openedByName: row.opened_by_name,
      status: row.status,
      openingFloatMinor: row.opening_float_minor,
      expectedCashMinor:
        row.status === 'closed'
          ? (row.expected_cash_minor ?? totals.expectedCashMinor)
          : totals.expectedCashMinor,
      countedCashMinor: row.counted_cash_minor,
      varianceMinor: row.variance_minor,
      cashSalesMinor: totals.cashSalesMinor,
      cashRefundsMinor: totals.cashRefundsMinor,
      cashInMinor: totals.cashInMinor,
      cashOutMinor: totals.cashOutMinor,
      openingNote: row.opening_note ?? '',
      closingNote: row.closing_note ?? '',
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    });
  }
}
