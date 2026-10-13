# Central Sync Server

Node.js + TypeScript API for receiving durable outbox batches into PostgreSQL and enforcing store-level stock allocations.

## Local development and integration testing

Requirements: Node.js 22+, Docker Compose, curl and OpenSSL.

From this folder, install dependencies and set local-only credentials:

```bash
npm install
export POSTGRES_PASSWORD='replace-with-a-long-random-development-password'
export SYNC_ADMIN_TOKEN="$(openssl rand -hex 32)"
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
npm run test:integration
```

The integration suite provisions a test store/counter and exercises authenticated event delivery, duplicate delivery, conflicting IDs, product/settings snapshots, stock movements, allocations, sales, returns, oversell prevention, and conflict resolution. It uses the running local Compose stack and should only be run against a disposable development database.

Provision a store and counter with UUIDs and a random token of at least 32 characters:

```bash
docker compose exec -T sync-server node dist/provision-counter.js <store-uuid> "Store Name" <counter-uuid> <random-counter-token>
```

The provisioner stores only a SHA-256 hash of the counter token. Keep the original token securely; it cannot be recovered from PostgreSQL.

## Pairing a desktop counter

In the desktop app, open **Synchronization → Central server connection**, enter the API URL and the counter-specific token, then save. The desktop encrypts the token with Electron's operating-system secure storage. The URL must use HTTPS outside localhost. If secure storage is unavailable, the UI will not save credentials; configure the environment variables `NOUVO_SYNC_URL` and `NOUVO_SYNC_TOKEN` through the OS/service environment instead.

For remote use, put the service behind a TLS-terminating reverse proxy. Never expose plain HTTP publicly. The included Compose port binds to localhost only.

## Central operations UI

Open `/admin` from the central service host to review central stock, adjust stock with a reason, set counter allocations and inspect/resolve sync conflicts. It requires the separate `SYNC_ADMIN_TOKEN`; the page keeps the token in JavaScript memory only and clears it when the page reloads. Use this interface only over localhost during development or behind authenticated network controls and HTTPS in deployment.

## API

- `GET /healthz`: database readiness.
- `POST /api/v1/sync/events`: accepts batches of up to 50 events, authenticates the counter, deduplicates event and business IDs, and stores events with domain validation.
- `GET /api/v1/sync/snapshot`: authenticated counter catalogue and remaining stock allocation snapshot. The desktop worker applies the snapshot locally only after pending/failed events are clear.
- `POST /api/v1/admin/inventory/adjustment`: adjust central on-hand quantity without reducing it below existing allocations.
- `POST /api/v1/admin/allocations`: allocate stock to a counter; total remaining allocations cannot exceed central on-hand.
- `GET /api/v1/admin/conflicts?storeId=<uuid>`: list open conflicts.
- `POST /api/v1/admin/conflicts/resolve`: record a resolution note and close a conflict.

Administrative endpoints require a separate `SYNC_ADMIN_TOKEN` of at least 32 characters. Keep it only in the deployment secret store. Never use a counter token as the admin token.

## Implemented event processing

Product create/update/archive snapshots, store settings, stock movement receipts/adjustments, completed sales, returns and voids are processed transactionally. Sale events consume the originating counter's remaining allocation and central on-hand quantity. Returns restore both, while duplicate return IDs, over-returns, negative stock, oversells and mismatched event IDs are rejected and recorded as conflicts.

## Remaining before production

This is not yet a complete multi-counter ERP backend. Supplier settlement/aging, central accounting journals and financial statements, a dedicated central administration UI for allocation/conflict review, provisioning/recovery UX, comprehensive business-event coverage, concurrency/restore acceptance tests and production TLS deployment remain open. Local PostgreSQL integration smoke checks pass, but this service has not been deployed behind production TLS or tested with real store data. Do not use it for live store operations until the remaining workflows and production deployment checks are completed.
