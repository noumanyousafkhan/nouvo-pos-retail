# Architecture and module boundaries

## Runtime boundaries

- `src/renderer/src`: Vue UI only. No Node.js, filesystem, shell or direct database access.
- `src/preload`: small allowlisted bridge exposed through `contextBridge`. Only typed application operations are exposed.
- `src/main`: Electron lifecycle, IPC handlers, logging, local database, inventory and checkout domain services.
- `src/shared`: schemas and types shared across trusted process boundaries.
- `src/server`: reserved for the central Node.js/PostgreSQL service; not yet implemented.
- `src/main/database`: local SQLite connection, checksum-verified migrations, transaction helper, and database lifecycle.
- `src/main/inventory`: product repository/service and stock-ledger service; product and stock mutations use transactions, audit snapshots and durable outbox events.
- `src/main/checkout/checkout-service.ts`: atomic sale completion, stock validation/deduction, payment splits/change, immutable line/receipt snapshots and idempotency keys.
- `src/main/checkout/sales-service.ts`: counter-scoped sales search, date filters, receipt listing and detail retrieval.
- `src/main/settings/settings-service.ts`: validated business identity, currency/timezone, tax behavior and receipt settings; each revision is audited and queued for sync.
- `src/main/backup/backup-service.ts`: WAL checkpoint, verified backup file creation, SHA-256 metadata, store/counter identity validation and staged restore with an automatic pre-restore safety copy.
- `src/renderer/src/components/sales/ReceiptPreview.vue`: shared receipt preview for checkout and sales history, with a standard system print dialog and 80 mm print CSS.
- `src/main/ipc`: separate app and inventory IPC registration modules; inputs are parsed through Zod schemas. The current Node `node:sqlite` driver is provisional because its API is still marked experimental; stable-driver evaluation is a release gate.
- `tests`: unit/integration tests. Future end-to-end tests will exercise packaged Electron flows.

## Renderer organization

- `components/base`: reusable UI primitives with consistent states.
- `components/layout` and `layouts`: navigation and application chrome.
- `features/<domain>`: domain-specific UI, forms and components as modules are implemented.
- `router`: routes and screen metadata.
- `stores`: Pinia stores by domain, added when real state is introduced.
- `composables`: reusable Vue behavior, not a home for business rules.
- `services`: typed adapters to the preload bridge; no raw Electron IPC strings spread through screens.
- `types` and `styles`: renderer type augmentation and design tokens.

## Inventory module

- `src/shared/contracts/products.ts` defines product inputs/outputs and list query schemas used at the renderer/main boundary.
- `src/main/inventory/product-repository.ts` owns SQL queries; `product-service.ts` owns validation-adjacent business rules, transaction boundaries and audit events.
- `src/renderer/src/views/InventoryView.vue` owns the catalogue UI only; it calls the typed preload bridge and never queries SQLite directly.
- Product creation/editing preserves transaction history. Archiving deactivates the row rather than deleting it. SKU and barcode conflicts return actionable errors.
- Stock receipts, adjustments and write-offs are ledger entries, never direct quantity edits. Negative on-hand stock is blocked. Stock changes are audited and written to the sync outbox in the same transaction.
- Base-unit changes are blocked after stock movements or sale lines exist; a dedicated controlled conversion workflow is required.

## Backup and recovery

- A backup is created only after a successful WAL checkpoint; the exported database is reopened and checked with `PRAGMA quick_check`, foreign-key validation, schema version and store/counter identity.
- A SHA-256 checksum and file size are returned for the backup. Backups are not encrypted; store them in a controlled location or on a separate drive.
- Restore rejects backups from a different store/counter or a newer incompatible schema. It creates an automatic safety backup, validates a staged copy, closes the live connection, replaces the database and reruns migrations/integrity checks.
- If restore fails, the automatic safety copy is used to recover the prior database. The UI warns that restore replaces local records.

## Checkout rules

- The checkout service re-reads active product prices, tax rates and counter stock inside a write transaction; the renderer cart is never authoritative.
- Tax-exclusive and tax-inclusive pricing modes are configurable. Tax is rounded per line to the currency minor unit; tax mode must be confirmed with the business accountant before production.
- Applied payment amounts must exactly equal the sale total. Cash tendered may exceed its applied amount and change is recorded; non-cash tendered amount must match its applied amount. Split payments are supported.
- Every checkout request carries a UUID idempotency key and a request hash. A retry with the same key/payload returns the original sale; a different payload using that key is rejected.
- Sale, line snapshots, payments, stock movements, receipt snapshot, audit event and outbox event commit together or roll back together.
- Receipt snapshot data is stored, but direct printer selection/configuration and device-specific thermal printer acceptance tests remain outstanding; the saved receipt can be opened in the system print dialog. Schema migration v2 adds sale idempotency, cash tender/change fields and immutable receipt snapshot storage.

## Local persistence

- Database file lives under Electron `userData/data/counter.sqlite`; never put it in the install directory or share the file over a network filesystem.
- Configure foreign keys, WAL, `synchronous=FULL`, a bounded busy timeout, and `trusted_schema=OFF` on every connection.
- Migrations are ordered, run inside `BEGIN IMMEDIATE`, and record SHA-256 checksums. Never edit an already released migration; add a new version instead.
- Run `PRAGMA quick_check` at open and fail closed if integrity validation or migration fails.
- Keep transaction callbacks synchronous; do not perform network calls or asynchronous work inside a SQLite transaction.
- The first schema is a foundation, not proof that all POS business flows are implemented.

## Rules

1. Domain rules belong in services, not only in components.
2. Validate untrusted input at every IPC/API/database boundary.
3. Keep financial values in integer minor units or an explicitly selected decimal-safe representation.
4. Commit sale, sale-line snapshots, payments, receipt snapshot and outbox event atomically in the local database.
5. Historical sales and posted journals are immutable; corrections use explicit reversal/adjustment workflows.
6. Product stock changes flow through stock movement/count/adjustment services only.
7. Keep reusable components focused; do not make one giant universal component.
8. Avoid unnecessary dependencies and synchronous work on the renderer thread.
9. A success state is shown only after the relevant persistence operation succeeds.
10. Placeholders must be labelled as not implemented; they are not acceptance-test evidence.
