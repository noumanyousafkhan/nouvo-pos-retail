import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';

const EventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1).max(120),
  schemaVersion: z.number().int().positive(),
  aggregateType: z.string().min(1).max(120),
  aggregateId: z.string().min(1).max(200),
  payload: z.unknown(),
  createdAt: z.string().datetime({ offset: true }),
});
const BatchSchema = z.object({
  schemaVersion: z.literal(1),
  storeId: z.string().uuid(),
  counterId: z.string().uuid(),
  events: z.array(EventSchema).max(50),
}).strict();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.PG_POOL_MAX ?? '10', 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('Request body exceeds the 1 MB limit.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function tokenMatches(token: string, storedHash: Buffer): boolean {
  const suppliedHash = createHash('sha256').update(token).digest();
  return storedHash.length === suppliedHash.length && timingSafeEqual(storedHash, suppliedHash);
}

async function handleBatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let parsed;
  try {
    parsed = BatchSchema.safeParse(await readJson(request));
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
    return;
  }
  if (!parsed.success) {
    send(response, 400, { error: 'Request does not match the sync batch contract.', issues: parsed.error.issues });
    return;
  }

  const authorization = request.headers.authorization ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (token.length < 32) {
    send(response, 401, { error: 'A valid counter bearer token is required.' });
    return;
  }

  const client: PoolClient = await pool.connect();
  try {
    const counterResult = await client.query<{
      store_id: string;
      token_hash: Buffer;
      is_active: boolean;
    }>('SELECT store_id, token_hash, is_active FROM sync_counters WHERE counter_id = $1', [parsed.data.counterId]);
    const counter = counterResult.rows[0];
    if (!counter || !counter.is_active || counter.store_id !== parsed.data.storeId || !tokenMatches(token, counter.token_hash)) {
      send(response, 401, { error: 'Counter credentials are invalid or disabled.' });
      return;
    }

    await client.query('BEGIN');
    await client.query('UPDATE sync_counters SET last_seen_at = now() WHERE counter_id = $1', [parsed.data.counterId]);
    const acceptedEventIds: string[] = [];
    const rejectedEvents: { eventId: string; message: string; retryable: boolean }[] = [];

    for (const event of parsed.data.events) {
      const inserted = await client.query(
        'INSERT INTO sync_events (counter_id, event_id, store_id, event_type, schema_version, aggregate_type, aggregate_id, payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT (counter_id,event_id) DO NOTHING RETURNING event_id',
        [parsed.data.counterId, event.id, parsed.data.storeId, event.eventType, event.schemaVersion, event.aggregateType, event.aggregateId, JSON.stringify(event.payload), event.createdAt],
      );
      if (inserted.rowCount === 1) {
        acceptedEventIds.push(event.id);
        continue;
      }
      const existing = await client.query<{ same_event: boolean }>(
        'SELECT (store_id=$3 AND event_type=$4 AND schema_version=$5 AND aggregate_type=$6 AND aggregate_id=$7 AND payload=$8::jsonb AND occurred_at=$9::timestamptz) AS same_event FROM sync_events WHERE counter_id=$1 AND event_id=$2',
        [parsed.data.counterId, event.id, parsed.data.storeId, event.eventType, event.schemaVersion, event.aggregateType, event.aggregateId, JSON.stringify(event.payload), event.createdAt],
      );
      if (existing.rows[0]?.same_event) acceptedEventIds.push(event.id);
      else rejectedEvents.push({ eventId: event.id, message: 'Event ID already exists with different content; manual review is required.', retryable: false });
    }
    await client.query('COMMIT');
    send(response, 200, { acceptedEventIds, rejectedEvents });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be closed */ }
    console.error('Sync batch failed:', error instanceof Error ? error.message : 'unknown error');
    send(response, 500, { error: 'Sync batch could not be stored; retry the same event IDs.' });
  } finally {
    client.release();
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    try {
      await pool.query('SELECT 1');
      send(response, 200, { ok: true, service: 'nouvo-pos-sync' });
    } catch {
      send(response, 503, { ok: false, service: 'nouvo-pos-sync' });
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/api/v1/sync/events') {
    await handleBatch(request, response);
    return;
  }
  send(response, 404, { error: 'Route not found.' });
});

async function start(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '../migrations/001_sync.sql');
  await pool.query(await readFile(migrationPath, 'utf8'));
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => console.info('NOUVO sync server listening on ' + host + ':' + port));
}

function shutdown(): void {
  server.close(() => void pool.end());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start().catch((error: unknown) => {
  console.error('Could not start sync server:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
