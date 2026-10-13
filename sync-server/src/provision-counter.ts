import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';

const ArgumentsSchema = z.tuple([
  z.string().uuid(),
  z.string().trim().min(1).max(160),
  z.string().uuid(),
  z.string().min(32).max(256),
]);
const parsed = ArgumentsSchema.safeParse(process.argv.slice(2));
if (!parsed.success) {
  console.error('Usage: npm run provision-counter -- <store-uuid> <store-name> <counter-uuid> <random-token-32+chars>');
  process.exitCode = 2;
} else {
  const [storeId, storeName, counterId, token] = parsed.data;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(
      'INSERT INTO sync_stores (store_id, store_name) VALUES ($1,$2) ON CONFLICT (store_id) DO UPDATE SET store_name=EXCLUDED.store_name',
      [storeId, storeName],
    );
    const tokenHash = createHash('sha256').update(token).digest();
    await pool.query(
      'INSERT INTO sync_counters (counter_id, store_id, token_hash, is_active) VALUES ($1,$2,$3,TRUE) ON CONFLICT (counter_id) DO UPDATE SET store_id=EXCLUDED.store_id, token_hash=EXCLUDED.token_hash, is_active=TRUE',
      [counterId, storeId, tokenHash],
    );
    console.info('Counter provisioned. Store ID:', storeId, 'Counter ID:', counterId);
    console.info('Save the token securely; it cannot be recovered from the server database.');
  } catch (error) {
    console.error('Provisioning failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
