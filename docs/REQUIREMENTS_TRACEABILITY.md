# NOUVO POS Cash & Carry — Requirements Traceability

**Baseline:** `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, and `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md`.

This document separates implemented code from acceptance-tested behavior. A database table or a route alone does not count as a finished business workflow.

## Implemented and unit-tested

| Area                   | Implementation                                                              | Current evidence                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron foundation    | `src/main`, `src/preload`, `src/shared/contracts`                           | Electron/Vite production build and TypeScript checks                                                                                                                                                             |
| Renderer shell         | `src/renderer/src/layouts`, reusable base components, router and CSS        | Renderer production build, lint and format checks                                                                                                                                                                |
| Local database         | `src/main/database/connection.ts`, `migrations.ts`                          | Versioned migrations with checksums, rollback, restart persistence, foreign-key and integrity tests                                                                                                              |
| Product catalogue      | `src/main/inventory`, `InventoryView.vue`                                   | Product create/edit/archive, SKU/barcode validation, stock ledger integration and tests                                                                                                                          |
| Checkout               | `src/main/checkout`, `CheckoutView.vue`                                     | Price/tax calculation in main process, stock validation, split payments, cash change, idempotency and atomic sale records; tests cover success and failure paths                                                 |
| Sales history          | `src/main/checkout/sales-service.ts`, `SalesHistoryView.vue`                | Search/date filters and receipt retrieval/reprint preview                                                                                                                                                        |
| Returns and voids      | `src/main/checkout/returns-service.ts`, sale history modals                 | Partial returns, full void, refund records, stock restoration, original receipt snapshot, audit/outbox and net report calculations; service tests                                                                |
| Cashier shifts         | `src/main/checkout/cash-session-service.ts`, `CashSessionsView.vue`         | Open/close shift, one open session per counter, opening float, cash sales/refunds, cash-in/out, expected/count/variance, audit/outbox, permission-gated IPC and service tests                                    |
| Accounting foundation  | `src/main/accounting`, `AccountingView.vue`, `ACCOUNTING_POSTING_MATRIX.md` | Default chart of accounts, balanced sale/return/purchase journals, COGS and inventory reversal, source idempotency, journal list, migration v8 and posting tests; account policy still needs accountant sign-off |
| Purchasing             | `src/main/purchasing`, `PurchasingView.vue`                                 | Supplier directory, draft purchase orders, goods receiving, stock/cost updates, cancellation, audit/outbox; service tests                                                                                        |
| Store/receipt settings | `src/main/settings`, `SettingsView.vue`                                     | Validated store details, tax mode, paper width, footer, revision history, audit and outbox records                                                                                                               |
| Backup/restore         | `src/main/backup`, settings screen                                          | File validation, integrity/schema/store/counter checks, SHA-256 result and safety-copy recovery path; service tests                                                                                              |
| Authentication         | `src/main/auth`, auth IPC and setup/login screens                           | One-time owner setup, Argon2id password hashes, login throttling, sessions, roles, permissions and user administration service; unit tests cover setup/login/RBAC                                                |
| Reports                | `src/main/reports`, `ReportsView.vue`                                       | Date-filtered completed sales, payment mix, top products, and counter stock/cost estimate; report-service tests                                                                                                  |
| Application security   | `src/main/index.ts`, preload bridge, IPC handlers                           | Context isolation, renderer Node integration off, sandbox enabled, validated IPC inputs, main-process permission checks                                                                                          |

## Verification run during this work session

- `npm run typecheck`: passed after cashier-session IPC, renderer and database migration changes.
- `npm test`: **51 tests across 15 test files passed**, including cashier reconciliation and accounting posting tests.
- `npm run lint`: passed with zero warnings.
- `npm run format:check`: passed.
- `npm audit --omit=dev`: 0 production dependency vulnerabilities at last run.
- `npm run build`: passed with all 51 tests, TypeScript checks and renderer/main/preload production bundles.
- `npm run build:app -- --dir`: Linux unpacked app packaging passed after schema v7 and cashier shifts; schema v8 accounting is now implemented and must be repackaged. A dedicated packaged-app interaction smoke test is still required for cashier shifts, purchasing, returns and voids.
- Windows NSIS packaging was attempted; electron-builder failed while resolving `github.com` (`EAI_AGAIN`). The Windows installer has not been produced or verified; retry when network/DNS access is available.
- Previous packaged Electron smoke test under Xvfb passed first-run owner setup, dashboard, Reports, Inventory, Checkout and Settings routes, plus creating a staff account through authenticated IPC. The current schema-v8 package also stayed alive for an 8-second Xvfb launch smoke test; full interactive cash-session/accounting UI smoke testing remains outstanding.
- Node emits an experimental warning for `node:sqlite`. A stable driver and actual packaged Electron compatibility across target operating systems are not yet verified.

## Not yet complete — do not treat this build as production-ready

- Purchasing gaps: supplier purchase returns, supplier balance tracking, supplier invoice reconciliation and supplier payment settlement. Basic suppliers, draft purchase orders, receiving and cancellation are implemented and service-tested. Purchasing and return/void UI flows still need a dedicated packaged-app interaction smoke test after the latest schema migrations.
- Accounting gaps: manual journals/reversals, supplier settlement/aging, inventory valuation ledger, account-specific payment clearing, financial statements and accountant-approved tax/reporting policy. Default posting matrix remains provisional until signed off.
- Central service/database, counter provisioning/stock allocation, background sync worker, retry policy and conflict resolution. `outbox_events` is storage groundwork for these workflows, not a working sync system.
- Full branding acceptance: logo asset management, historical receipt branding verification and direct thermal-printer hardware testing.
- Report gaps: no cashier/category/gross-margin/accounting reports yet; stock value is an estimate using current purchase cost, not a posted accounting valuation. Purchases are not integrated into financial statements.
- End-to-end acceptance on real store data, Windows installer/update tests, Linux packaged install test, normal sandboxed launch verification and peripheral/hardware testing.
- Performance/accessibility acceptance against SRS target hardware and datasets.

## Release rule

Do not claim full SRS completion until each acceptance test in `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, and `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md` has implementation evidence and has passed. Do not use this current development build for real financial operations until the remaining workflows, accounting policy, backups, printer, packaged delivery and business acceptance are verified.
