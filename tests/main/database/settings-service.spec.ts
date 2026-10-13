// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../../../src/main/database/connection';
import { SettingsService } from '../../../src/main/settings/settings-service';

const opened: ReturnType<typeof openLocalDatabase>[] = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  opened.push(database);
  const storeId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'My Store');
  return { database, storeId, service: new SettingsService(database.connection, storeId) };
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe('business settings service', () => {
  it('saves store identity, tax mode and receipt settings with audit/outbox revisions', () => {
    const { database, service, storeId } = setup();
    const saved = service.save({
      name: 'Northside Cash & Carry',
      currencyCode: 'pkr',
      timezone: 'Asia/Karachi',
      taxBehavior: 'inclusive',
      address: 'Main Road',
      phone: '03001234567',
      businessRegistrationNumber: 'REG-01',
      receiptFooter: 'Thank you',
      receiptPaperWidthMm: 58,
    });
    expect(saved).toMatchObject({
      storeId,
      name: 'Northside Cash & Carry',
      currencyCode: 'PKR',
      taxBehavior: 'inclusive',
      receiptFooter: 'Thank you',
      receiptPaperWidthMm: 58,
    });
    expect(
      database.connection
        .prepare("SELECT action FROM audit_events WHERE entity_type = 'store'")
        .get(),
    ).toEqual({ action: 'settings.updated' });
    expect(
      database.connection
        .prepare('SELECT revision FROM business_branding_profiles WHERE store_id = ?')
        .get(storeId),
    ).toEqual({ revision: 1 });
    expect(
      database.connection
        .prepare("SELECT event_type FROM outbox_events WHERE aggregate_type = 'store'")
        .get(),
    ).toEqual({ event_type: 'store.settings.updated' });
  });

  it('rejects invalid timezones without changing persisted settings', () => {
    const { service } = setup();
    const before = service.get();
    expect(() =>
      service.save({ ...before, timezone: 'Not/A_Timezone', storeId: undefined }),
    ).toThrow(/valid IANA timezone/i);
    expect(service.get()).toEqual(before);
  });
});
