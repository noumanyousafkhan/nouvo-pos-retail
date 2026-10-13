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
const BatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    storeId: z.string().uuid(),
    counterId: z.string().uuid(),
    events: z.array(EventSchema).max(50),
  })
  .strict();
const BusinessSettingsPayloadSchema = z
  .object({
    storeId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().trim().min(1).max(100),
    taxBehavior: z.enum(['exclusive', 'inclusive']),
    address: z.string().max(500),
    phone: z.string().max(80),
    businessRegistrationNumber: z.string().max(100),
    receiptFooter: z.string().max(500),
    receiptPaperWidthMm: z.union([z.literal(58), z.literal(80)]),
  })
  .strict();
const ProductPayloadSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(180),
    description: z.string(),
    categoryName: z.string(),
    sku: z.string().nullable(),
    barcodes: z.array(z.string()),
    baseUnit: z.string().min(1),
    purchaseCostMinor: z.number().int().nonnegative(),
    sellingPriceMinor: z.number().int().nonnegative(),
    taxRateBasisPoints: z.number().int().min(0).max(10000),
    isActive: z.boolean(),
    stockOnHandMilli: z.number().int(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const SalePayloadSchema = z
  .object({
    id: z.string().uuid(),
    lines: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantityMilli: z.number().int().positive(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const ReturnPayloadSchema = z
  .object({
    returnId: z.string().uuid(),
    saleId: z.string().uuid(),
    operation: z.enum(['return', 'void']),
    lines: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantityMilli: z.number().int().positive(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const AllocationPayloadSchema = z
  .object({
    storeId: z.string().uuid(),
    counterId: z.string().uuid(),
    productId: z.string().uuid(),
    allocatedQuantityMilli: z.number().int().nonnegative().max(2_000_000_000),
  })
  .strict();
const ResolveConflictSchema = z
  .object({
    storeId: z.string().uuid(),
    conflictId: z.number().int().positive(),
    resolutionNote: z.string().trim().min(3).max(1000),
  })
  .strict();
const InventoryAdjustmentSchema = z
  .object({
    storeId: z.string().uuid(),
    productId: z.string().uuid(),
    deltaQuantityMilli: z
      .number()
      .int()
      .refine((value) => value !== 0, 'Quantity delta must not be zero.')
      .min(-2_000_000_000)
      .max(2_000_000_000),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

class DomainConflict extends Error {}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.parseInt(process.env.PG_POOL_MAX ?? '10', 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
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
  return storedHash.length === suppliedHash.length && timingSafeEqual(suppliedHash, storedHash);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainConflict('Event payload must be a JSON object.');
  return value as Record<string, unknown>;
}

async function applyEvent(
  client: PoolClient,
  storeId: string,
  counterId: string,
  event: z.infer<typeof EventSchema>,
): Promise<void> {
  const payload = objectPayload(event.payload);

  if (event.eventType === 'store.settings.updated') {
    const settings = BusinessSettingsPayloadSchema.safeParse(payload.settings);
    if (!settings.success)
      throw new DomainConflict(
        'Store settings payload is invalid: ' +
          settings.error.issues
            .map((issue) => issue.path.join('.') + ' ' + issue.message)
            .join('; '),
      );
    if (settings.data.storeId !== storeId || event.aggregateId !== storeId)
      throw new DomainConflict('Store settings event does not contain settings for this store.');
    await client.query('UPDATE sync_stores SET store_name=$2 WHERE store_id=$1', [
      storeId,
      settings.data.name,
    ]);
    await client.query(
      'INSERT INTO sync_store_settings (store_id,settings,revision) VALUES ($1,$2::jsonb,1) ON CONFLICT (store_id) DO UPDATE SET settings=EXCLUDED.settings,revision=sync_store_settings.revision+1,updated_at=now()',
      [storeId, JSON.stringify(settings.data)],
    );
    return;
  }

  if (event.eventType === 'product.created' || event.eventType === 'product.updated') {
    const parsed = ProductPayloadSchema.safeParse(payload.product);
    if (!parsed.success || parsed.data.id !== event.aggregateId)
      throw new DomainConflict('Product event does not contain a valid matching product snapshot.');
    await client.query(
      'INSERT INTO sync_products (store_id, product_id, is_active, product_snapshot, updated_at) VALUES ($1,$2,$3,$4::jsonb,now()) ON CONFLICT (store_id,product_id) DO UPDATE SET is_active=EXCLUDED.is_active, product_snapshot=EXCLUDED.product_snapshot, updated_at=now()',
      [storeId, parsed.data.id, parsed.data.isActive, JSON.stringify(parsed.data)],
    );
    await client.query(
      'INSERT INTO sync_inventory (store_id, product_id, on_hand_quantity_milli) VALUES ($1,$2,0) ON CONFLICT (store_id,product_id) DO NOTHING',
      [storeId, parsed.data.id],
    );
    return;
  }

  if (event.eventType === 'product.archived') {
    const productId = z.string().uuid().safeParse(payload.productId);
    if (!productId.success || productId.data !== event.aggregateId)
      throw new DomainConflict('Archive event does not identify its product.');
    await client.query(
      "UPDATE sync_products SET is_active=FALSE, product_snapshot=jsonb_set(product_snapshot,'{isActive}','false'::jsonb,true), updated_at=now() WHERE store_id=$1 AND product_id=$2",
      [storeId, productId.data],
    );
    await client.query(
      'UPDATE sync_allocations SET allocated_quantity_milli=allocated_quantity_milli-remaining_quantity_milli, remaining_quantity_milli=0, updated_at=now() WHERE store_id=$1 AND product_id=$2',
      [storeId, productId.data],
    );
    return;
  }

  if (event.eventType === 'stock.movement.recorded') {
    const movementId = z.string().uuid().safeParse(payload.movementId);
    const productId = z.string().uuid().safeParse(payload.productId);
    const delta = z
      .number()
      .int()
      .refine((value) => value !== 0)
      .safeParse(payload.quantityDeltaMilli);
    if (
      !movementId.success ||
      movementId.data !== event.aggregateId ||
      !productId.success ||
      !delta.success
    )
      throw new DomainConflict(
        'Stock movement payload is invalid or has a mismatched movement ID.',
      );
    const previousMovement = await client.query<{ payload: unknown }>(
      'SELECT payload FROM sync_stock_movements WHERE counter_id=$1 AND movement_id=$2',
      [counterId, movementId.data],
    );
    if (previousMovement.rows[0]) {
      if (canonicalJson(previousMovement.rows[0].payload) === canonicalJson(payload)) return;
      throw new DomainConflict('Stock movement ID was reused with different contents.');
    }
    const isSupplierReturn = payload.referenceType === 'purchase_return' && delta.data < 0;
    const returnQuantity = isSupplierReturn ? -delta.data : 0;
    if (isSupplierReturn) {
      const allocation = await client.query<{
        allocated_quantity_milli: string;
        remaining_quantity_milli: string;
      }>(
        'SELECT allocated_quantity_milli::text,remaining_quantity_milli::text FROM sync_allocations WHERE store_id=$1 AND counter_id=$2 AND product_id=$3 FOR UPDATE',
        [storeId, counterId, productId.data],
      );
      const row = allocation.rows[0];
      if (
        !row ||
        BigInt(row.allocated_quantity_milli) < BigInt(returnQuantity) ||
        BigInt(row.remaining_quantity_milli) < BigInt(returnQuantity)
      )
        throw new DomainConflict(
          'Supplier return exceeds this counter’s remaining allocated stock.',
        );
    }
    const updated = await client.query(
      'UPDATE sync_inventory SET on_hand_quantity_milli=on_hand_quantity_milli+$3, updated_at=now() WHERE store_id=$1 AND product_id=$2 AND on_hand_quantity_milli+$3>=0 RETURNING on_hand_quantity_milli',
      [storeId, productId.data, delta.data],
    );
    if (updated.rowCount !== 1)
      throw new DomainConflict(
        'Stock movement references an unknown product or would make central stock negative.',
      );
    if (isSupplierReturn) {
      await client.query(
        'UPDATE sync_allocations SET allocated_quantity_milli=allocated_quantity_milli-$4, remaining_quantity_milli=remaining_quantity_milli-$4, updated_at=now() WHERE store_id=$1 AND counter_id=$2 AND product_id=$3',
        [storeId, counterId, productId.data, returnQuantity],
      );
    }
    const allocated = await client.query<{ reserved: string }>(
      'SELECT COALESCE(SUM(remaining_quantity_milli),0)::text AS reserved FROM sync_allocations WHERE store_id=$1 AND product_id=$2',
      [storeId, productId.data],
    );
    if (
      BigInt(allocated.rows[0]?.reserved ?? '0') >
      BigInt(updated.rows[0].on_hand_quantity_milli as string | number)
    ) {
      throw new DomainConflict(
        'Stock movement would put central on-hand below stock already allocated to counters.',
      );
    }
    await client.query(
      'INSERT INTO sync_stock_movements (store_id,counter_id,movement_id,product_id,quantity_delta_milli,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [storeId, counterId, movementId.data, productId.data, delta.data, JSON.stringify(payload)],
    );
    return;
  }

  if (event.eventType === 'sale.completed') {
    const sale = SalePayloadSchema.safeParse(payload.sale);
    if (!sale.success || sale.data.id !== event.aggregateId)
      throw new DomainConflict('Sale event does not contain a valid matching sale snapshot.');
    const previousSale = await client.query<{ payload: unknown }>(
      'SELECT payload FROM sync_sales WHERE counter_id=$1 AND sale_id=$2',
      [counterId, sale.data.id],
    );
    if (previousSale.rows[0]) {
      if (canonicalJson(previousSale.rows[0].payload) === canonicalJson(sale.data)) return;
      throw new DomainConflict('Sale ID was reused with different contents.');
    }
    const quantities = new Map<string, number>();
    for (const line of sale.data.lines)
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantityMilli);
    const consolidatedLines = [...quantities.entries()].map(([productId, quantityMilli]) => ({
      productId,
      quantityMilli,
    }));
    for (const line of consolidatedLines) {
      const product = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM sync_products WHERE store_id=$1 AND product_id=$2 FOR UPDATE',
        [storeId, line.productId],
      );
      if (product.rows[0]?.is_active !== true)
        throw new DomainConflict('Sale references a product that is unknown or inactive.');
      const inventory = await client.query<{ on_hand_quantity_milli: string }>(
        'SELECT on_hand_quantity_milli::text FROM sync_inventory WHERE store_id=$1 AND product_id=$2 FOR UPDATE',
        [storeId, line.productId],
      );
      const allocation = await client.query<{ remaining_quantity_milli: string }>(
        'SELECT remaining_quantity_milli::text FROM sync_allocations WHERE store_id=$1 AND counter_id=$2 AND product_id=$3 FOR UPDATE',
        [storeId, counterId, line.productId],
      );
      if (!inventory.rows[0] || !allocation.rows[0])
        throw new DomainConflict(
          'No central stock allocation exists for product ' + line.productId + '.',
        );
      if (
        BigInt(inventory.rows[0].on_hand_quantity_milli) < BigInt(line.quantityMilli) ||
        BigInt(allocation.rows[0].remaining_quantity_milli) < BigInt(line.quantityMilli)
      ) {
        throw new DomainConflict(
          'Counter stock allocation is exhausted for product ' +
            line.productId +
            '. Sale is saved locally but requires authorized stock/conflict review.',
        );
      }
    }
    for (const line of consolidatedLines) {
      await client.query(
        'UPDATE sync_inventory SET on_hand_quantity_milli=on_hand_quantity_milli-$3, updated_at=now() WHERE store_id=$1 AND product_id=$2',
        [storeId, line.productId, line.quantityMilli],
      );
      await client.query(
        'UPDATE sync_allocations SET remaining_quantity_milli=remaining_quantity_milli-$4, updated_at=now() WHERE store_id=$1 AND counter_id=$2 AND product_id=$3',
        [storeId, counterId, line.productId, line.quantityMilli],
      );
    }
    await client.query(
      'INSERT INTO sync_sales (store_id,counter_id,sale_id,payload) VALUES ($1,$2,$3,$4::jsonb)',
      [storeId, counterId, sale.data.id, JSON.stringify(sale.data)],
    );
    return;
  }

  if (event.eventType === 'sale.return.completed' || event.eventType === 'sale.voided') {
    const returned = ReturnPayloadSchema.safeParse(payload);
    if (!returned.success || returned.data.returnId !== event.aggregateId)
      throw new DomainConflict('Return event payload is invalid or has a mismatched return ID.');
    if (
      (event.eventType === 'sale.voided' && returned.data.operation !== 'void') ||
      (event.eventType === 'sale.return.completed' && returned.data.operation !== 'return')
    )
      throw new DomainConflict('Return event type does not match its operation.');
    const original = await client.query<{ payload: unknown }>(
      'SELECT payload FROM sync_sales WHERE store_id=$1 AND counter_id=$2 AND sale_id=$3 FOR UPDATE',
      [storeId, counterId, returned.data.saleId],
    );
    if (original.rowCount !== 1)
      throw new DomainConflict(
        'Original sale has not been synchronized; return cannot be applied yet.',
      );
    const originalSale = SalePayloadSchema.safeParse(original.rows[0]?.payload);
    if (!originalSale.success) throw new DomainConflict('Original sale snapshot is invalid.');
    const priorReturn = await client.query(
      'SELECT 1 FROM sync_returns WHERE counter_id=$1 AND return_id=$2',
      [counterId, returned.data.returnId],
    );
    if (priorReturn.rowCount)
      throw new DomainConflict('This return has already been synchronized under another event ID.');

    const quantities = new Map<string, number>();
    for (const line of returned.data.lines)
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantityMilli);
    for (const [productId, quantityMilli] of quantities) {
      const soldQuantity = originalSale.data.lines
        .filter((line) => line.productId === productId)
        .reduce((sum, line) => sum + line.quantityMilli, 0);
      const previous = await client.query<{ returned: string }>(
        'SELECT COALESCE(SUM(quantity_milli),0)::text AS returned FROM sync_return_lines WHERE counter_id=$1 AND sale_id=$2 AND product_id=$3',
        [counterId, returned.data.saleId, productId],
      );
      if (
        !soldQuantity ||
        BigInt(previous.rows[0]?.returned ?? '0') + BigInt(quantityMilli) > BigInt(soldQuantity)
      )
        throw new DomainConflict(
          'Return quantity exceeds the remaining quantity on the original sale.',
        );
      const product = await client.query(
        'SELECT 1 FROM sync_products WHERE store_id=$1 AND product_id=$2 FOR UPDATE',
        [storeId, productId],
      );
      if (product.rowCount !== 1) throw new DomainConflict('Return references an unknown product.');
    }

    await client.query(
      'INSERT INTO sync_returns (store_id,counter_id,return_id,sale_id,operation,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [
        storeId,
        counterId,
        returned.data.returnId,
        returned.data.saleId,
        returned.data.operation,
        JSON.stringify(payload),
      ],
    );
    for (const [productId, quantityMilli] of quantities) {
      await client.query(
        'INSERT INTO sync_return_lines (counter_id,return_id,sale_id,product_id,quantity_milli) VALUES ($1,$2,$3,$4,$5)',
        [counterId, returned.data.returnId, returned.data.saleId, productId, quantityMilli],
      );
      await client.query(
        'UPDATE sync_inventory SET on_hand_quantity_milli=on_hand_quantity_milli+$3, updated_at=now() WHERE store_id=$1 AND product_id=$2',
        [storeId, productId, quantityMilli],
      );
      await client.query(
        'INSERT INTO sync_allocations (store_id,counter_id,product_id,allocated_quantity_milli,remaining_quantity_milli) VALUES ($1,$2,$3,$4,$4) ON CONFLICT (counter_id,product_id) DO UPDATE SET allocated_quantity_milli=sync_allocations.allocated_quantity_milli+EXCLUDED.allocated_quantity_milli, remaining_quantity_milli=sync_allocations.remaining_quantity_milli+EXCLUDED.remaining_quantity_milli, updated_at=now()',
        [storeId, counterId, productId, quantityMilli],
      );
    }
    return;
  }

  // Events not yet mapped to central business tables are retained in the immutable event log.
}

async function authenticateCounter(
  client: PoolClient,
  request: IncomingMessage,
  storeId?: string,
  counterIdHeader?: string,
) {
  const authorization = request.headers.authorization ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const counterId = counterIdHeader ?? request.headers['x-counter-id'];
  if (token.length < 32 || typeof counterId !== 'string') return null;
  const result = await client.query<{ store_id: string; token_hash: Buffer; is_active: boolean }>(
    'SELECT store_id,token_hash,is_active FROM sync_counters WHERE counter_id=$1',
    [counterId],
  );
  const row = result.rows[0];
  if (
    !row ||
    !row.is_active ||
    (storeId && row.store_id !== storeId) ||
    !tokenMatches(token, row.token_hash)
  )
    return null;
  await client.query('UPDATE sync_counters SET last_seen_at=now() WHERE counter_id=$1', [
    counterId,
  ]);
  return { counterId, storeId: row.store_id };
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
    send(response, 400, {
      error: 'Request does not match the sync batch contract.',
      issues: parsed.error.issues,
    });
    return;
  }

  const client = await pool.connect();
  try {
    const auth = await authenticateCounter(
      client,
      request,
      parsed.data.storeId,
      parsed.data.counterId,
    );
    if (!auth) {
      send(response, 401, { error: 'Counter credentials are invalid or disabled.' });
      return;
    }
    await client.query('BEGIN');
    const acceptedEventIds: string[] = [];
    const rejectedEvents: { eventId: string; message: string; retryable: boolean }[] = [];
    for (const event of parsed.data.events) {
      const existing = await client.query<{
        event_type: string;
        schema_version: number;
        aggregate_type: string;
        aggregate_id: string;
        payload: unknown;
        occurred_at: Date;
      }>(
        'SELECT event_type,schema_version,aggregate_type,aggregate_id,payload,occurred_at FROM sync_events WHERE counter_id=$1 AND event_id=$2',
        [auth.counterId, event.id],
      );
      if (existing.rows[0]) {
        const old = existing.rows[0];
        const same =
          old.event_type === event.eventType &&
          old.schema_version === event.schemaVersion &&
          old.aggregate_type === event.aggregateType &&
          old.aggregate_id === event.aggregateId &&
          canonicalJson(old.payload) === canonicalJson(event.payload) &&
          new Date(old.occurred_at).toISOString() === new Date(event.createdAt).toISOString();
        if (same) acceptedEventIds.push(event.id);
        else {
          const message =
            'Event ID already exists with different content; manual review is required.';
          await client.query(
            'INSERT INTO sync_conflicts (store_id,counter_id,event_id,event_type,message,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (counter_id,event_id) DO NOTHING',
            [
              auth.storeId,
              auth.counterId,
              event.id,
              event.eventType,
              message,
              JSON.stringify(event.payload),
            ],
          );
          rejectedEvents.push({ eventId: event.id, message, retryable: false });
        }
        continue;
      }

      await client.query('SAVEPOINT sync_event');
      try {
        await applyEvent(client, auth.storeId, auth.counterId, event);
        await client.query(
          'INSERT INTO sync_events (counter_id,event_id,store_id,event_type,schema_version,aggregate_type,aggregate_id,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
          [
            auth.counterId,
            event.id,
            auth.storeId,
            event.eventType,
            event.schemaVersion,
            event.aggregateType,
            event.aggregateId,
            JSON.stringify(event.payload),
            event.createdAt,
          ],
        );
        await client.query('RELEASE SAVEPOINT sync_event');
        acceptedEventIds.push(event.id);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT sync_event');
        await client.query('RELEASE SAVEPOINT sync_event');
        if (!(error instanceof DomainConflict)) throw error;
        const message = error.message.slice(0, 1000);
        await client.query(
          'INSERT INTO sync_conflicts (store_id,counter_id,event_id,event_type,message,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (counter_id,event_id) DO NOTHING',
          [
            auth.storeId,
            auth.counterId,
            event.id,
            event.eventType,
            message,
            JSON.stringify(event.payload),
          ],
        );
        rejectedEvents.push({ eventId: event.id, message, retryable: false });
      }
    }
    await client.query('COMMIT');
    send(response, 200, { acceptedEventIds, rejectedEvents });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection may already be closed */
    }
    console.error('Sync batch failed:', error instanceof Error ? error.message : 'unknown error');
    send(response, 500, { error: 'Sync batch could not be stored; retry the same event IDs.' });
  } finally {
    client.release();
  }
}

async function handleSnapshot(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const client = await pool.connect();
  try {
    const auth = await authenticateCounter(client, request);
    if (!auth) {
      send(response, 401, { error: 'Counter credentials are invalid or disabled.' });
      return;
    }
    const products = await client.query<{ product_id: string; product_snapshot: unknown }>(
      'SELECT product_id,product_snapshot FROM sync_products WHERE store_id=$1 ORDER BY product_id',
      [auth.storeId],
    );
    const allocations = await client.query<{
      product_id: string;
      remaining_quantity_milli: string;
    }>(
      'SELECT a.product_id,a.remaining_quantity_milli::text FROM sync_allocations a JOIN sync_products p ON p.store_id=a.store_id AND p.product_id=a.product_id AND p.is_active=TRUE WHERE a.store_id=$1 AND a.counter_id=$2 AND a.remaining_quantity_milli>0 ORDER BY a.product_id',
      [auth.storeId, auth.counterId],
    );
    const settingsResult = await client.query<{ settings: unknown }>(
      'SELECT settings FROM sync_store_settings WHERE store_id=$1',
      [auth.storeId],
    );
    send(response, 200, {
      storeId: auth.storeId,
      counterId: auth.counterId,
      settings: settingsResult.rows[0]?.settings ?? null,
      products: products.rows.map((row) => ({
        ...objectPayload(row.product_snapshot),
        id: row.product_id,
      })),
      allocations: allocations.rows.map((row) => ({
        productId: row.product_id,
        quantityMilli: Number(row.remaining_quantity_milli),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Snapshot request failed:', error instanceof Error ? error.message : error);
    send(response, 500, { error: 'Snapshot could not be loaded.' });
  } finally {
    client.release();
  }
}

async function requireAdmin(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const expected = process.env.SYNC_ADMIN_TOKEN ?? '';
  const supplied = request.headers['x-admin-token'];
  if (expected.length < 32 || typeof supplied !== 'string') {
    send(response, 503, {
      error: 'Administrative API is disabled until SYNC_ADMIN_TOKEN is configured.',
    });
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    send(response, 401, { error: 'Invalid administrative credentials.' });
    return false;
  }
  return true;
}

async function handleAdminInventory(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!(await requireAdmin(request, response))) return;
  const url = new URL(request.url ?? '/', 'http://localhost');
  const storeId = z.string().uuid().safeParse(url.searchParams.get('storeId'));
  if (!storeId.success) {
    send(response, 400, { error: 'A valid storeId query parameter is required.' });
    return;
  }
  const store = await pool.query<{ store_id: string; store_name: string }>(
    'SELECT store_id,store_name FROM sync_stores WHERE store_id=$1',
    [storeId.data],
  );
  if (!store.rows[0]) {
    send(response, 404, { error: 'Store was not found.' });
    return;
  }
  const [counters, products, allocations] = await Promise.all([
    pool.query(
      'SELECT counter_id AS "counterId",is_active AS "isActive",last_seen_at AS "lastSeenAt" FROM sync_counters WHERE store_id=$1 ORDER BY created_at',
      [storeId.data],
    ),
    pool.query(
      'SELECT p.product_id AS "productId",p.is_active AS "isActive",p.product_snapshot->>\'name\' AS name,p.product_snapshot->>\'sku\' AS sku,i.on_hand_quantity_milli::text AS "onHandQuantityMilli" FROM sync_products p JOIN sync_inventory i ON i.store_id=p.store_id AND i.product_id=p.product_id WHERE p.store_id=$1 ORDER BY p.product_snapshot->>\'name\'',
      [storeId.data],
    ),
    pool.query(
      'SELECT counter_id AS "counterId",product_id AS "productId",allocated_quantity_milli::text AS "allocatedQuantityMilli",remaining_quantity_milli::text AS "remainingQuantityMilli" FROM sync_allocations WHERE store_id=$1 ORDER BY product_id,counter_id',
      [storeId.data],
    ),
  ]);
  send(response, 200, {
    store: store.rows[0],
    counters: counters.rows,
    products: products.rows.map((row) => ({
      ...row,
      onHandQuantityMilli: Number(row.onHandQuantityMilli),
    })),
    allocations: allocations.rows.map((row) => ({
      ...row,
      allocatedQuantityMilli: Number(row.allocatedQuantityMilli),
      remainingQuantityMilli: Number(row.remainingQuantityMilli),
    })),
  });
}

async function handleAllocation(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!(await requireAdmin(request, response))) return;
  let body;
  try {
    body = AllocationPayloadSchema.safeParse(await readJson(request));
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
    return;
  }
  if (!body.success) {
    send(response, 400, { error: 'Invalid stock allocation payload.', issues: body.error.issues });
    return;
  }
  const value = body.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counter = await client.query(
      'SELECT 1 FROM sync_counters WHERE store_id=$1 AND counter_id=$2 AND is_active=TRUE FOR UPDATE',
      [value.storeId, value.counterId],
    );
    if (counter.rowCount !== 1)
      throw new DomainConflict('Active counter was not found in this store.');
    const product = await client.query(
      'SELECT 1 FROM sync_products WHERE store_id=$1 AND product_id=$2 AND is_active=TRUE FOR UPDATE',
      [value.storeId, value.productId],
    );
    if (product.rowCount !== 1)
      throw new DomainConflict('Active product has not synchronized to the central service yet.');
    const inventory = await client.query<{ on_hand_quantity_milli: string }>(
      'SELECT on_hand_quantity_milli::text FROM sync_inventory WHERE store_id=$1 AND product_id=$2 FOR UPDATE',
      [value.storeId, value.productId],
    );
    if (!inventory.rows[0]) throw new DomainConflict('Inventory row was not found.');
    const existing = await client.query<{
      allocated_quantity_milli: string;
      remaining_quantity_milli: string;
    }>(
      'SELECT allocated_quantity_milli::text,remaining_quantity_milli::text FROM sync_allocations WHERE counter_id=$1 AND product_id=$2 FOR UPDATE',
      [value.counterId, value.productId],
    );
    const consumed = existing.rows[0]
      ? BigInt(existing.rows[0].allocated_quantity_milli) -
        BigInt(existing.rows[0].remaining_quantity_milli)
      : 0n;
    if (BigInt(value.allocatedQuantityMilli) < consumed)
      throw new DomainConflict('Allocation cannot be reduced below already-consumed stock.');
    const newRemaining = BigInt(value.allocatedQuantityMilli) - consumed;
    const other = await client.query<{ reserved: string }>(
      'SELECT COALESCE(SUM(remaining_quantity_milli),0)::text AS reserved FROM sync_allocations WHERE store_id=$1 AND product_id=$2 AND counter_id<>$3',
      [value.storeId, value.productId, value.counterId],
    );
    if (
      BigInt(other.rows[0]?.reserved ?? '0') + newRemaining >
      BigInt(inventory.rows[0].on_hand_quantity_milli)
    )
      throw new DomainConflict('Total counter allocations cannot exceed unreserved central stock.');
    await client.query(
      'INSERT INTO sync_allocations (store_id,counter_id,product_id,allocated_quantity_milli,remaining_quantity_milli) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (counter_id,product_id) DO UPDATE SET allocated_quantity_milli=EXCLUDED.allocated_quantity_milli,remaining_quantity_milli=EXCLUDED.remaining_quantity_milli,updated_at=now()',
      [
        value.storeId,
        value.counterId,
        value.productId,
        value.allocatedQuantityMilli,
        newRemaining.toString(),
      ],
    );
    await client.query('COMMIT');
    send(response, 200, {
      ok: true,
      storeId: value.storeId,
      counterId: value.counterId,
      productId: value.productId,
      allocatedQuantityMilli: value.allocatedQuantityMilli,
      remainingQuantityMilli: Number(newRemaining),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* no active transaction */
    }
    if (error instanceof DomainConflict) send(response, 409, { error: error.message });
    else {
      console.error('Allocation failed:', error instanceof Error ? error.message : error);
      send(response, 500, { error: 'Stock allocation could not be saved.' });
    }
  } finally {
    client.release();
  }
}

async function handleListConflicts(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!(await requireAdmin(request, response))) return;
  const url = new URL(request.url ?? '/', 'http://localhost');
  const storeId = z.string().uuid().safeParse(url.searchParams.get('storeId'));
  if (!storeId.success) {
    send(response, 400, { error: 'A valid storeId query parameter is required.' });
    return;
  }
  const includeResolved = url.searchParams.get('includeResolved') === 'true';
  const result = await pool.query(
    'SELECT id,counter_id AS "counterId",event_id AS "eventId",event_type AS "eventType",message,payload,created_at AS "createdAt",resolved_at AS "resolvedAt",resolution_note AS "resolutionNote" FROM sync_conflicts WHERE store_id=$1 AND ($2::boolean OR resolved_at IS NULL) ORDER BY created_at DESC LIMIT 200',
    [storeId.data, includeResolved],
  );
  send(response, 200, { conflicts: result.rows });
}

async function handleResolveConflict(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!(await requireAdmin(request, response))) return;
  let body;
  try {
    body = ResolveConflictSchema.safeParse(await readJson(request));
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
    return;
  }
  if (!body.success) {
    send(response, 400, {
      error: 'Invalid conflict resolution payload.',
      issues: body.error.issues,
    });
    return;
  }
  const value = body.data;
  const result = await pool.query(
    'UPDATE sync_conflicts SET resolved_at=now(),resolution_note=$3 WHERE store_id=$1 AND id=$2 AND resolved_at IS NULL RETURNING id',
    [value.storeId, value.conflictId, value.resolutionNote],
  );
  if (result.rowCount !== 1) {
    send(response, 409, { error: 'Open conflict was not found or has already been resolved.' });
    return;
  }
  send(response, 200, {
    ok: true,
    conflictId: value.conflictId,
    resolvedAt: new Date().toISOString(),
  });
}

async function handleInventoryAdjustment(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!(await requireAdmin(request, response))) return;
  let body;
  try {
    body = InventoryAdjustmentSchema.safeParse(await readJson(request));
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : 'Invalid JSON body.' });
    return;
  }
  if (!body.success) {
    send(response, 400, {
      error: 'Invalid inventory adjustment payload.',
      issues: body.error.issues,
    });
    return;
  }
  const value = body.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inventory = await client.query<{ on_hand_quantity_milli: string }>(
      'SELECT on_hand_quantity_milli::text FROM sync_inventory WHERE store_id=$1 AND product_id=$2 FOR UPDATE',
      [value.storeId, value.productId],
    );
    if (!inventory.rows[0])
      throw new DomainConflict('Product must sync before central stock can be adjusted.');
    const next =
      BigInt(inventory.rows[0].on_hand_quantity_milli) + BigInt(value.deltaQuantityMilli);
    if (next < 0n) throw new DomainConflict('Central stock cannot become negative.');
    const reserved = await client.query<{ reserved: string }>(
      'SELECT COALESCE(SUM(remaining_quantity_milli),0)::text AS reserved FROM sync_allocations WHERE store_id=$1 AND product_id=$2',
      [value.storeId, value.productId],
    );
    if (next < BigInt(reserved.rows[0]?.reserved ?? '0'))
      throw new DomainConflict('Adjustment would reduce stock below counter allocations.');
    await client.query(
      'UPDATE sync_inventory SET on_hand_quantity_milli=$3,updated_at=now() WHERE store_id=$1 AND product_id=$2',
      [value.storeId, value.productId, next.toString()],
    );
    await client.query('COMMIT');
    send(response, 200, { ok: true, onHandQuantityMilli: Number(next), reason: value.reason });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* no active transaction */
    }
    if (error instanceof DomainConflict) send(response, 409, { error: error.message });
    else {
      console.error('Inventory adjustment failed:', error instanceof Error ? error.message : error);
      send(response, 500, { error: 'Inventory adjustment could not be saved.' });
    }
  } finally {
    client.release();
  }
}

async function start(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '../migrations/001_sync.sql');
  await pool.query(await readFile(migrationPath, 'utf8'));
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/admin') {
        const html = await readFile(
          join(dirname(fileURLToPath(import.meta.url)), '../admin/index.html'),
          'utf8',
        );
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        });
        response.end(html);
      } else if (request.method === 'GET' && request.url === '/admin.js') {
        const script = await readFile(
          join(dirname(fileURLToPath(import.meta.url)), '../admin/admin.js'),
          'utf8',
        );
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'self'",
        });
        response.end(script);
      } else if (request.method === 'GET' && request.url === '/healthz') {
        await pool.query('SELECT 1');
        send(response, 200, { ok: true, service: 'nouvo-pos-sync' });
      } else if (request.method === 'POST' && request.url === '/api/v1/sync/events') {
        await handleBatch(request, response);
      } else if (request.method === 'GET' && request.url === '/api/v1/sync/snapshot') {
        await handleSnapshot(request, response);
      } else if (request.method === 'GET' && request.url?.startsWith('/api/v1/admin/inventory?')) {
        await handleAdminInventory(request, response);
      } else if (request.method === 'GET' && request.url?.startsWith('/api/v1/admin/conflicts?')) {
        await handleListConflicts(request, response);
      } else if (request.method === 'POST' && request.url === '/api/v1/admin/conflicts/resolve') {
        await handleResolveConflict(request, response);
      } else if (request.method === 'POST' && request.url === '/api/v1/admin/allocations') {
        await handleAllocation(request, response);
      } else if (
        request.method === 'POST' &&
        request.url === '/api/v1/admin/inventory/adjustment'
      ) {
        await handleInventoryAdjustment(request, response);
      } else {
        send(response, 404, { error: 'Route not found.' });
      }
    } catch (error) {
      console.error('Request failed:', error instanceof Error ? error.message : error);
      if (!response.headersSent) send(response, 500, { error: 'Request could not be completed.' });
      else response.destroy();
    }
  });
  server.listen(port, host, () =>
    console.info('NOUVO sync server listening on ' + host + ':' + port),
  );
  const shutdown = () => {
    server.close(() => void pool.end());
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
start().catch((error: unknown) => {
  console.error('Could not start sync server:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
