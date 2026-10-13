# NOUVO POS Cash & Carry — Requirements Traceability

**Baseline:** `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, and `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md`.

This document separates implemented code from acceptance-tested behavior. A database table or a route alone does not count as a finished business workflow.

## Implemented and unit-tested

| Area                   | Implementation                                                       | Current evidence                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron foundation    | `src/main`, `src/preload`, `src/shared/contracts`                    | Electron/Vite production build and TypeScript checks                                                                                                              |
| Renderer shell         | `src/renderer/src/layouts`, reusable base components, router and CSS | Renderer production build, lint and format checks                                                                                                                 |
| Local database         | `src/main/database/connection.ts`, `migrations.ts`                   | Versioned migrations with checksums, rollback, restart persistence, foreign-key and integrity tests                                                               |
| Product catalogue      | `src/main/inventory`, `InventoryView.vue`                            | Product create/edit/archive, SKU/barcode validation, stock ledger integration and tests                                                                           |
| Checkout               | `src/main/checkout`, `CheckoutView.vue`                              | Price/tax calculation in main process, stock validation, split payments, cash change, idempotency and atomic sale records; tests cover success and failure paths  |
| Sales history          | `src/main/checkout/sales-service.ts`, `SalesHistoryView.vue`         | Search/date filters and receipt retrieval/reprint preview                                                                                                         |
| Store/receipt settings | `src/main/settings`, `SettingsView.vue`                              | Validated store details, tax mode, paper width, footer, revision history, audit and outbox records                                                                |
| Backup/restore         | `src/main/backup`, settings screen                                   | File validation, integrity/schema/store/counter checks, SHA-256 result and safety-copy recovery path; service tests                                               |
| Authentication         | `src/main/auth`, auth IPC and setup/login screens                    | One-time owner setup, Argon2id password hashes, login throttling, sessions, roles, permissions and user administration service; unit tests cover setup/login/RBAC |
| Reports                | `src/main/reports`, `ReportsView.vue`                                | Date-filtered completed sales, payment mix, top products, and counter stock/cost estimate; report-service tests                                                   |
| Application security   | `src/main/index.ts`, preload bridge, IPC handlers                    | Context isolation, renderer Node integration off, sandbox enabled, validated IPC inputs, main-process permission checks                                           |

## Verification run during this work session

- `npm run typecheck`: passed after authentication and report changes.
- `npm test`: **43 tests across 12 test files passed**.
- `npm run lint`: passed with zero warnings.
- `npm run format:check`: passed.
- `npm audit --omit=dev`: 0 production dependency vulnerabilities at last run.
- `npm run build`: passed after the latest reports, dashboard and staff-management UI changes.
- `npm run build:app -- --dir`: Linux unpacked app packaging passed after schema v5 and the purchasing module were added.
- Windows NSIS packaging was attempted; electron-builder failed while resolving `github.com` (`EAI_AGAIN`). The Windows installer has not been produced or verified; retry when network/DNS access is available.
- Packaged Electron smoke test under Xvfb passed first-run owner setup, dashboard, Reports, Inventory, Checkout and Settings routes, plus creating a staff account through authenticated IPC.
- Node emits an experimental warning for `node:sqlite`. A stable driver and actual packaged Electron compatibility across target operating systems are not yet verified.

## Not yet complete — do not treat this build as production-ready

- Purchasing gaps: supplier purchase returns, supplier balance tracking, supplier invoice reconciliation and accounting journal posting. Basic suppliers, draft purchase orders, receiving and cancellation are implemented and service-tested. The latest purchasing UI still needs a dedicated packaged-app interaction smoke test.
- Returns, refunds, sale voids, shift/cashier sessions and cash reconciliation/variance.
- Double-entry accounting: chart of accounts, posting matrix, journal integrity, inventory valuation and financial statements.
- Central service/database, counter provisioning/stock allocation, background sync worker, retry policy and conflict resolution. `outbox_events` is storage groundwork for these workflows, not a working sync system.
- Full branding acceptance: logo asset management, historical receipt branding verification and direct thermal-printer hardware testing.
- Report gaps: no cashier/category/gross-margin/accounting reports yet; stock value is an estimate using current purchase cost, not approved moving weighted-average accounting valuation. Returns and purchases are excluded.
- End-to-end acceptance on real store data, Windows installer/update tests, Linux packaged install test, normal sandboxed launch verification and peripheral/hardware testing.
- Performance/accessibility acceptance against SRS target hardware and datasets.

## Release rule

Do not claim full SRS completion until each acceptance test in `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, and `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md` has implementation evidence and has passed. Do not use this current development build for real financial operations until the remaining workflows, accounting policy, backups, printer, packaged delivery and business acceptance are verified.
