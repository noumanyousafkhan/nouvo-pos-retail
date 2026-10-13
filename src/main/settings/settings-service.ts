import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  BusinessSettingsSchema,
  SaveBusinessSettingsSchema,
  type BusinessSettings,
} from '../../shared/contracts/settings';
import { runInTransaction } from '../database/connection';

interface StoreSettingsRow {
  id: string;
  name: string;
  currency_code: string;
  timezone: string;
  tax_behavior: 'exclusive' | 'inclusive';
  address: string | null;
  phone: string | null;
  business_registration_number: string | null;
  receipt_footer: string;
  receipt_paper_width_mm: 58 | 80;
}

function mapSettings(row: StoreSettingsRow): BusinessSettings {
  return BusinessSettingsSchema.parse({
    storeId: row.id,
    name: row.name,
    currencyCode: row.currency_code,
    timezone: row.timezone,
    taxBehavior: row.tax_behavior,
    address: row.address ?? '',
    phone: row.phone ?? '',
    businessRegistrationNumber: row.business_registration_number ?? '',
    receiptFooter: row.receipt_footer,
    receiptPaperWidthMm: row.receipt_paper_width_mm,
  });
}

export class SettingsService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
  ) {}

  get(): BusinessSettings {
    const row = this.database
      .prepare(
        'SELECT id, name, currency_code, timezone, tax_behavior, address, phone, business_registration_number, receipt_footer, receipt_paper_width_mm FROM stores WHERE id = ?',
      )
      .get(this.storeId) as StoreSettingsRow | undefined;
    if (!row) throw new Error('Local store settings were not found.');
    return mapSettings(row);
  }

  save(rawInput: unknown): BusinessSettings {
    const input = SaveBusinessSettingsSchema.parse(rawInput);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch {
      throw new Error('Enter a valid IANA timezone, for example Asia/Karachi.');
    }
    return runInTransaction(this.database, () => {
      const before = this.get();
      this.database
        .prepare(
          `UPDATE stores SET name = ?, currency_code = ?, timezone = ?, tax_behavior = ?, address = ?, phone = ?, business_registration_number = ?, receipt_footer = ?, receipt_paper_width_mm = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.currencyCode,
          input.timezone,
          input.taxBehavior,
          input.address || null,
          input.phone || null,
          input.businessRegistrationNumber || null,
          input.receiptFooter,
          input.receiptPaperWidthMm,
          new Date().toISOString(),
          this.storeId,
        );
      const after = this.get();
      const revisionRow = this.database
        .prepare(
          'SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM business_branding_profiles WHERE store_id = ?',
        )
        .get(this.storeId) as { revision: number };
      this.database
        .prepare(
          'INSERT INTO business_branding_profiles (id, store_id, revision, profile_json) VALUES (?, ?, ?, ?)',
        )
        .run(randomUUID(), this.storeId, revisionRow.revision, JSON.stringify(after));
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, 'settings.updated', 'store', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          this.storeId,
          JSON.stringify(before),
          JSON.stringify(after),
        );
      this.database
        .prepare(
          `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'store.settings.updated', 'store', ?, ?)`,
        )
        .run(randomUUID(), this.storeId, JSON.stringify({ schemaVersion: 1, settings: after }));
      return after;
    });
  }
}
