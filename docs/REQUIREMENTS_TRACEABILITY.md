# NOUVO POS Cash & Carry — Requirements Traceability

**Baseline:** SRS v1.1  
**Purpose:** Tie requirements to implementation and test evidence. Never record a test as passing unless it has actually run.

| Requirement area              | SRS section | Implementation location                                     | Verification evidence                                    |
| ----------------------------- | ----------: | ----------------------------------------------------------- | -------------------------------------------------------- |
| Secure desktop foundation     |      13, 15 | `src/main`, `src/preload`, `src/shared/contracts`           | IPC contract tests, security review, typecheck and build |
| Renderer shell and navigation |      14, 15 | `src/renderer/src/layouts`, `components/layout`, `router`   | Vue component tests and renderer build                   |
| Reusable UI and design tokens |  14; UX-001 | `src/renderer/src/components/base`, `styles/main.css`       | Component tests, visual review, lint                     |
| Product create/edit/archive   |           6 | Planned: inventory feature and main domain services         | CRUD, uniqueness and audit tests                         |
| Price history and snapshots   |        6, 8 | Planned: inventory and sales domain services                | Old sale remains unchanged after price edit              |
| Stock movement and adjustment |       6, 10 | Planned: inventory/stock services and database repositories | Permissions, balance and audit tests                     |
| Offline local checkout        |       7, 11 | Planned: checkout service, SQLite repositories, outbox      | Offline/restart persistence tests                        |
| Stock allocations             |          11 | Planned: central service and local stock allocation service | Concurrent allocation/oversell tests                     |
| Idempotent synchronization    |          11 | Planned: central sync module and local outbox               | Duplicate/retry/restart tests                            |
| Payments and cashier sessions |           8 | Planned: payments and cashier-session services              | Split-payment and cash-variance tests                    |
| Business branding             | 9; addendum | Planned: branding module and receipt profile repository     | BR-001 to BR-010                                         |
| Receipt layout and reprints   |        8, 9 | Planned: receipt renderer and snapshot service              | AT-015, AT-016, AT-022                                   |
| Accounting                    |          12 | Planned: accounting domain and posting matrix               | Debit/credit balancing tests                             |
| Permissions and audit         |       4, 13 | Shared authorization and audit services (planned)           | Unauthorized-operation and audit tests                   |
| Backup and migrations         |          17 | Planned: database migrations and backup service             | Restore integrity and interruption tests                 |
| Performance and accessibility |      14, 18 | Renderer components and profiling suite (incremental)       | UX-002 to UX-004; AT-023 to AT-028                       |
| Windows/Linux delivery        |      15, 17 | Electron Builder configuration                              | Actual target-platform install/update tests              |

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

## Security audit note

- `npm audit --omit=dev`: **0 vulnerabilities** in production dependencies at the last verification.
- Full development dependency audit reports **8 moderate findings** in the Electron Builder toolchain. A non-forced `npm audit fix` cannot resolve them; forcing the suggested downgrade to Electron Builder 26.5.0 introduces high/critical findings in its older dependency tree. Do not use `npm audit fix --force`; revisit when a compatible patched dependency set is available.

## Current status

Phase 1 source foundation is implemented and the typecheck, unit tests, lint, formatting, production build, and development-runtime bridge smoke test have passed. This is not a production POS yet. SQLite driver selection, migrations, business domain services, checkout, inventory, central synchronization, accounting, branding, receipts, backup/restore, hardware and packaging still require implementation and acceptance testing.
