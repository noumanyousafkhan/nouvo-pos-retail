# NOUVO POS Cash & Carry — Requirements Traceability

**Baseline:** SRS v1.1  
**Purpose:** Tie requirements to implementation and test evidence. Never record a test as passing unless it has actually run.

| Requirement area              | SRS section | Implementation location                                     | Verification evidence                                                             |
| ----------------------------- | ----------: | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Secure desktop foundation     |      13, 15 | `src/main`, `src/preload`, `src/shared/contracts`           | IPC contract tests, security review, typecheck and build                          |
| Renderer shell and navigation |      14, 15 | `src/renderer/src/layouts`, `components/layout`, `router`   | Vue component tests and renderer build                                            |
| Reusable UI and design tokens |  14; UX-001 | `src/renderer/src/components/base`, `styles/main.css`       | Component tests, visual review, lint                                              |
| Product create/edit/archive   |           6 | Planned: inventory feature and main domain services         | CRUD, uniqueness and audit tests                                                  |
| Price history and snapshots   |        6, 8 | Planned: inventory and sales domain services                | Old sale remains unchanged after price edit                                       |
| Stock movement and adjustment |       6, 10 | Planned: inventory/stock services and database repositories | Permissions, balance and audit tests                                              |
| Offline local checkout        |       7, 11 | Planned: checkout service, SQLite repositories, outbox      | Offline/restart persistence tests                                                 |
| Stock allocations             |          11 | Planned: central service and local stock allocation service | Concurrent allocation/oversell tests                                              |
| Idempotent synchronization    |          11 | Planned: central sync module and local outbox               | Duplicate/retry/restart tests                                                     |
| Payments and cashier sessions |           8 | Planned: payments and cashier-session services              | Split-payment and cash-variance tests                                             |
| Business branding             | 9; addendum | Planned: branding module and receipt profile repository     | BR-001 to BR-010                                                                  |
| Receipt layout and reprints   |        8, 9 | Planned: receipt renderer and snapshot service              | AT-015, AT-016, AT-022                                                            |
| Accounting                    |          12 | Planned: accounting domain and posting matrix               | Debit/credit balancing tests                                                      |
| Permissions and audit         |       4, 13 | Shared authorization and audit services (planned)           | Unauthorized-operation and audit tests                                            |
| Local schema and migrations   |      15, 17 | `src/main/database/connection.ts`, `migrations.ts`          | Migration idempotency/checksum, restart persistence, rollback and integrity tests |
| Backup and restore            |          17 | Planned: backup service                                     | Restore integrity and interruption tests                                          |
| Performance and accessibility |      14, 18 | Renderer components and profiling suite (incremental)       | UX-002 to UX-004; AT-023 to AT-028                                                |
| Windows/Linux delivery        |      15, 17 | Electron Builder configuration                              | Actual target-platform install/update tests                                       |

## Phase 1 implementation checklist

- [x] Requirement documents preserved under `docs/`.
- [x] Repository initialized with Git after confirming there was no existing `.git` directory; default branch renamed to `main`.
- [x] Exact dependency versions pinned in `package.json` and `package-lock.json`.
- [x] Electron/Vite/Vue/TypeScript configuration and project scripts created.
- [x] Secure BrowserWindow settings specified: context isolation on, renderer Node integration off, sandbox on.
- [x] Narrow preload bridge defined; no arbitrary filesystem, shell or database API exposed.
- [x] Zod contracts created for desktop IPC requests/responses.
- [x] Pino file logger scaffold includes redaction for common secret fields.
- [x] Reusable base button/card/page header and shared layout components created.
- [x] Hash router and module entry screens created.
- [x] Reduced-motion CSS support added.
- [x] Initial IPC contract and reusable button tests written.
- [x] Dependency installation and lockfile completed.
- [x] Typecheck passed: `npm run typecheck`.
- [x] Unit tests passed: 2 test files, 6 tests.
- [x] Lint passed: `npm run lint`, zero warnings.
- [x] Formatting passed: `npm run format:check`.
- [x] Production build passed: `npm run build`.
- [x] Electron development runtime loaded the dashboard under Xvfb; Playwright verified the document title, six navigation links, and preload app-info/runtime-status IPC responses.
- [ ] Normal sandboxed Electron launch and packaged app launch still require verification on a desktop environment with correctly configured Linux sandbox-helper permissions.
- [ ] Windows/Linux installer creation and in-place update tests remain pending.

## Phase 2 local database checklist

- [x] Local per-counter SQLite file under Electron-managed user data.
- [x] Foreign-key enforcement, WAL mode, `synchronous=FULL`, busy timeout and `trusted_schema=OFF`.
- [x] Versioned migration ledger with SHA-256 checksum verification and transactional application.
- [x] Initial schema for stores, counters, users, categories, products, barcodes, stock movements, sales, sale-line snapshots, payments, outbox events, branding revisions and audit events.
- [x] Synchronous transaction helper with rollback on failure.
- [x] Quick integrity check when opening the database.
- [x] Five database tests; total suite currently 11 tests.
- [x] Electron 44 Linux smoke test created the database; application log confirmed initialization; `PRAGMA quick_check` returned `ok`.
- [ ] Node `node:sqlite` remains experimental; evaluate stable native driver and test Electron rebuilds for Windows/Linux before production.
- [ ] Database schema does not yet imply implemented checkout, inventory workflows, accounting, sync or backup features.

## Phase 3 product catalogue checklist

- [x] Product list and search by name, SKU and barcode.
- [x] Product create/edit UI with category, description, unit, cost, selling price, tax and multiple barcodes.
- [x] SKU and barcode uniqueness enforced by the database and reported as actionable errors.
- [x] Product changes and archive actions create audit events with before/after snapshots.
- [x] Products are archived rather than hard-deleted.
- [x] Base-unit changes blocked after stock movement or sale history exists.
- [x] Counter on-hand balance derived from stock movement ledger; stock receipt, adjustment and write-off are separate movement types.
- [x] Negative on-hand stock blocked; movement reason, audit event and outbox event commit atomically.
- [x] Transactional service tests cover create, update, archive, duplicate identifiers, audit history and rollback.
- [x] Electron UI smoke test created a product via preload IPC and verified that it remained visible after app restart.
- [ ] Role-based authorization is not yet implemented; do not use this build for production operations.

## Security audit note

- `npm audit --omit=dev`: **0 vulnerabilities** in production dependencies at the last verification.
- Full development dependency audit reports **8 moderate findings** in the Electron Builder toolchain. A non-forced `npm audit fix` cannot resolve them; forcing the suggested downgrade to Electron Builder 26.5.0 introduces high/critical findings in its older dependency tree. Do not use `npm audit fix --force`; revisit when a compatible patched dependency set is available.

## Current status

Phase 1 source foundation, Phase 2 local database foundation and Phase 3 product catalogue CRUD are implemented. Typecheck, 21 unit tests, lint, formatting, production build, Electron 44 Linux database initialization, product/stock UI smoke tests and restart-persistence smoke tests have passed. This is not a production POS yet. Stable SQLite driver selection, checkout, payments, central synchronization, accounting, full branding setup, receipt printing, backup/restore, role-based authorization, hardware and packaging still require implementation and acceptance testing.
