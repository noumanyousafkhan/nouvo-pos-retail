# NOUVO POS Cash & Carry

Offline-first Windows/Linux desktop POS built with Electron, Vue 3, TypeScript, Vite, Pinia and Tailwind CSS.

## Current milestone

**Phase 4 checkout and payment flow is implemented on top of the product/stock catalogue and local database; the POS is still under development.** The Electron main process initializes a per-counter SQLite database, runs checksum-verified versioned migrations, enables foreign keys/WAL/FULL synchronous durability, and checks database integrity. The initial schema includes stores, counters, users, products/barcodes, stock movements, sales and immutable line snapshots, payments, an outbox, branding revisions, and audit events. Product create/edit/archive, SKU/barcode validation, inventory search, counter stock balances, stock receiving/adjustments/write-offs, barcode-first checkout, split payments, cash change, immutable sale/receipt snapshots, idempotent checkout requests, searchable sales history, saved receipt preview/system print dialog, editable business identity, currency, timezone, tax mode and receipt settings, audit events and durable outbox events are implemented. Authentication/authorization, central synchronization, accounting, direct thermal-printer configuration, returns/voids and backup/restore are not yet implemented. Do not use this build for real transactions.

## Requirements

- Node.js 22.x (current inspected machine: v22.23.3)
- npm 10.x (current inspected machine: v10.9.9)
- Windows or Linux desktop environment
- Network access for first dependency installation; runtime checkout is intended to work offline

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

## Packaging

```bash
npm run build:app
```

Electron Builder targets Windows NSIS and Linux AppImage/DEB. Actual platform-specific packaging must be verified on the target OS. Windows packaging from Linux may require additional tools or a Windows build machine.

## Security and data

- Renderer Node integration is disabled and context isolation is enabled.
- Renderer IPC is exposed only through the narrow preload API.
- IPC payloads and returned contracts are validated with Zod.
- Logs are written under Electron's managed logs directory and redact common secret fields.
- The initial implementation uses Node’s built-in `node:sqlite` API; it has been smoke-tested inside Electron 44 on Linux. Node currently marks this API experimental, so selecting a stable native driver remains a release gate; evaluate `better-sqlite3` and verify native rebuilds for both Windows and Linux before production release.
- Do not commit credentials, real customer data, local databases or release artifacts.

## Current implementation milestone

- Local database path: Electron-managed user data directory at `data/counter.sqlite` (one file per counter/device).
- Migration 1 is checksum-verified; modified historical migration SQL causes startup to fail rather than silently drift the schema.
- Transaction helper uses `BEGIN IMMEDIATE` and rollback-on-error.
- Automated tests cover migration idempotency, persistence across close/reopen, rollback, foreign-key/barcode constraints, migration checksum tampering, product CRUD, audit snapshots, duplicate SKU/barcode rejection, archive preservation, unsafe base-unit change prevention, stock receipt/adjustment/write-off, negative-stock prevention, atomic checkout, split payment totals, cash change, idempotency and rollback tests.
- Verified on the development machine: typecheck, 31 unit tests, lint, formatting, production build, Electron runtime initialization, product/stock/checkout/sales-history UI smoke tests, inclusive/exclusive tax tests and settings persistence tests.
- Remaining gates: stable SQLite driver decision, normal sandboxed launch, Windows/Linux packaging, and business feature implementation.

## Requirements documents

See `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md`, `docs/MASTER_CODING_PROMPT_v1.1.md` and `docs/REQUIREMENTS_TRACEABILITY.md`.
