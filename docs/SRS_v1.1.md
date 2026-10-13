# NOUVO POS Cash & Carry — Software Requirements Specification

**Version:** 1.1  
**Status:** Working baseline for implementation  
**Platform:** Windows and Linux desktop  
**Primary architecture:** Electron + Vue 3 + TypeScript + SQLite per counter + central Node.js service + PostgreSQL

## 1. Product vision

Build a reliable, offline-first, multi-counter cash-and-carry POS with premium visual design, quick checkout, accurate inventory and accounting, store-level business branding, safe updates, and auditable operations. The sample shop name “Nayyab Tuc Shop” is an example only; no customer name or branding may be hard-coded.

## 2. Core principles

1. Normal checkout must work without internet.
2. A sale must be durably saved locally before the UI confirms success.
3. Sync must be retryable and idempotent; no sale may be silently lost or duplicated.
4. Counters disconnected from the store service may sell only from stock allocated to them. Total counter allocations must not exceed allocatable stock. If a counter allocation is exhausted, block the sale by default; any emergency override must be separately authorized and audited.
5. Completed transaction lines, receipts, and posted accounting entries are historical records; later product edits must not rewrite them.
6. Money calculations must use integer minor units or a rigorously decimal-safe type, never ordinary imprecise floating-point arithmetic.
7. Permissions must be enforced by the service layer, not only by hiding UI controls.
8. Critical actions require explicit success/failure feedback, and no success message may precede durable persistence.

## 3. Scope

### Release 1

- One store, configurable number of checkout counters (1, 2, 3, 6, or custom).
- Product and barcode management; unit/packaging conversions; price and tax configuration.
- Sales, discounts, split payments, receipts/reprints, returns/refunds/voids, cashier shifts, cash reconciliation.
- Stock ledger, receiving/purchasing, supplier records, stock counts/adjustments, reorder thresholds.
- Core double-entry accounting and financial reports with defined posting rules.
- Offline local database, stock allocation, automatic reconnection sync, conflict handling.
- Store-level business branding and configurable thermal receipt layout.
- Users, roles, audit logs, backups/restoration, migrations, Windows/Linux packaging and safe updates.
- Premium, responsive UI and performance profiling.

### Explicitly out of release 1 unless approved

- Multi-store/warehouse operations beyond the initial store model.
- Cloud-only checkout, mandatory internet login, or shared SQLite files over a network share.
- Unreviewed automatic stock conflict resolution, unlogged edits, or deleting historical transactions.
- Universal hardware compatibility claims without model-specific tests.

## 4. Users and permissions

- Owner/Admin: store setup, branding, user/role management, inventory/pricing, reports, backups, accounting configuration.
- Manager: permitted operational overrides, stock adjustments, purchasing, price changes, returns, shift review.
- Cashier: checkout, assigned payment methods, own shift, permitted receipt reprints/returns.
- Accountant: accounting, reconciliation, reports, controlled journal review/posting.
- Technician/support: diagnostics only when explicitly authorized; no hidden bypass of permissions.
  All roles are configurable, least-privilege by default, and checked in service operations. Sensitive actions require actor, timestamp, before/after values where applicable, and a reason when specified.

## 5. Setup and counter provisioning

- First-run wizard captures store name, locale/currency, timezone, tax behavior, receipt paper width, owner credentials, backup location/policy, and counter count.
- Create stable store ID, counter IDs, device identity and secure pairing flow.
- Each counter has its own local SQLite database and durable sync outbox. Never share the SQLite database file over SMB/NFS.
- Provisioning downloads only the stock allocation assigned to that counter, along with product, price, tax and branding snapshots required for offline operation.
- A reset/reinstall must not silently create a second identity for an existing counter; pairing/recovery is authenticated and audited.

## 6. Product catalogue and editable inventory

### Product fields

- Stable product ID; name; description; category; brand; supplier link; SKU/internal code; multiple barcodes; image; active/archive status.
- Purchase cost; selling price; optional wholesale/price tiers; tax category and tax-inclusive/exclusive policy.
- Base unit; packaging units and conversion ratios; optional weighted/variable-quantity product behavior.
- Reorder threshold and other non-financial stock rules.
- Optional batch/lot and expiry tracking where enabled.

### Create, edit and archive

- Authorized users can create products and later edit existing products through a dedicated details/edit view.
- Editable fields include name, descriptions, category, brand, barcodes, prices, tax settings, supplier, permitted unit configuration, images, stock rules, and metadata.
- Validate SKU and barcode uniqueness with actionable messages.
- Changes to selling price affect new sales only. Completed sale lines retain their captured name/code, quantity, unit, price, discounts, taxes and totals.
- Purchase-cost changes do not rewrite historical purchase receipts or posted journals. Inventory valuation follows the approved costing method and stock movement ledger.
- A product referenced by transactions cannot be hard-deleted; archive/deactivate it instead.
- Do not edit stock quantity directly on the product form. Use a controlled stock count/adjustment with reason, permission, audit event and stock movement.
- Once a product has stock or transactions, changes to base unit, conversion ratio, or tracking method must be blocked or routed through an explicit, audited conversion workflow.
- Show before/after price when changing prices; unsaved changes prompt before navigation away.

### Inventory views

- Fast search by name, SKU, barcode and category; filter/sort; pagination or virtualization for large datasets.
- Detail sections: General, Barcodes, Pricing, Units & Packaging, Stock Rules, Tax, Supplier, and Activity/History.
- History records price changes, stock movements, counts, receiving, purchasing and relevant metadata edits.
- Bulk price changes may be added only with preview, row validation, explicit confirmation and audit history.

## 7. Barcode and checkout

- Support common USB/Bluetooth keyboard-wedge scanners without requiring internet.
- Barcode input must not be delayed by animation or debounce. Handle rapid scans and duplicate scan events deliberately.
- Product lookup must handle barcode, SKU and name search.
- Cart supports quantity changes, line removal, authorized line/order discounts, configured taxes, and clear subtotal/discount/tax/total display.
- Prevent accidental duplicate checkout/payment submission; provide clear pending, success and failure states.
- Persist finalized sale, line snapshots, payments and outbox event in a local transaction before showing success or printing a final receipt.
- If a sale cannot be committed locally, do not claim success; explain recovery steps without discarding the cart.

## 8. Payments, receipts and cashier sessions

- Support configurable cash and non-cash payment methods, split payments, amount tendered, change due, and payment references as appropriate.
- Open/close cashier shifts with opening float, cash movements, expected cash, counted cash, variance, and authorized reconciliation.
- Receipts must support 58 mm and 80 mm thermal widths, wrapping, readable text, totals, payment summary, transaction number, date/time, cashier/counter references, and applicable tax details.
- Reprint and return/refund flows must be clearly marked and permission-controlled. Return/refund transactions must reference the original sale where possible.
- Receipt layout must not clip or overlap long product names, quantities, prices, addresses or footer text.

## 9. Business branding

A dedicated **Settings → Business Branding** screen allows an owner/admin to configure the shop's identity independently of NOUVO POS software branding.

### Profile fields

- Required business/shop name before final receipt setup.
- Optional logo upload (PNG/JPEG, transparency supported), slogan/tagline, business type.
- Address lines, area/city, state/province, postal code and country.
- Phone, alternate phone, WhatsApp, email and website.
- NTN/STRN or other jurisdiction-specific tax registration IDs.
- Optional social links, custom receipt header/footer, return policy and custom label/value rows.
- All optional fields can be enabled/disabled for printing; unset values do not create blank labels or lines.

### Behavior and safety

- Provide logo preview, replace/remove, validation, Save/Cancel and live receipt preview.
- Store assets in managed application storage, preserving logo aspect ratio; do not depend on a removable source path.
- Print configured identity on sales receipts and applicable reprints/refunds. Keep NOUVO POS branding off customer receipts by default.
- Profile is store-level and shared consistently by paired counters. Changes sync when connected; each counter uses its last successfully synchronized profile offline.
- Profile has a revision and timestamp. Every finalized receipt stores a snapshot of the business identity and receipt configuration. Historical reprints use that snapshot; new sales use the latest locally available profile.
- Include profile and logo in backups. Log editor, timestamp and changed fields. Only authorized roles may change settings.

## 10. Stock and purchasing

- Maintain a stock movement ledger as the source of stock history; every receipt, sale, return, adjustment, write-off and transfer-like operation must be traceable.
- Supplier records, purchase orders, goods receiving, supplier invoice/cost details and purchase returns are supported within release scope.
- Partial receiving and discrepancy handling must be explicit.
- Stock adjustments/counts require permissions, reason codes, audit history and balanced inventory effects.
- Support reorder thresholds and low-stock reporting.
- Weighted/variable-weight goods and expiry/batch tracking are configurable capabilities; final weighing-device integrations require tested hardware models.

## 11. Offline-first sync and stock allocation

- Central store service maintains authoritative stock and per-counter allocations when reachable. Each disconnected counter can sell only within its own locally available allocation.
- Allocation total must not exceed available allocatable stock. Allocation and sale processing must be atomic on the central service.
- Local sale, payments, receipt snapshot and outbox event commit in a single SQLite transaction.
- Use globally unique transaction/event IDs, stable counter identity, monotonic local sequence where useful, payload schema versioning, server-side processed-event deduplication, and durable acknowledgements.
- Retries must be idempotent. Duplicate network delivery must not duplicate sales, stock movements, payments, or accounting journals.
- Sync handles interrupted connections, retry/backoff, partial batches, server restarts and client restarts.
- Show last sync time, pending event count and actionable sync failures. Failed events go to a visible conflict/error queue; never silently discard them.
- On allocation exhaustion, block new sales of that item by default. Any override is explicit, separately permissioned, warned and audited; never imply that independent offline counters can know each other's live sales.
- When connected, updated products/prices/tax/branding and new allocations propagate to counters with version checks. A disconnected counter clearly uses its last local snapshot.

## 12. Accounting and financial integrity

- Implement double-entry accounting with a documented chart of accounts and posting matrix before production transaction implementation.
- Each posted journal must balance: total debits equal total credits.
- Define posting rules for sales, discounts, taxes, each payment type, cash change, returns, refunds, purchase receiving, supplier balances, stock adjustments, cost of goods sold and inventory valuation.
- Select and document moving weighted-average costing as the proposed default; validate with an accountant/business owner before finalizing edge cases such as returns, negative stock prevention, purchase cost changes and offline allocation.
- Use decimal-safe arithmetic and explicit rounding rules for currency, quantity precision, tax and discounts.
- Never rewrite posted journals to reflect a later product edit; use reversal/correction entries with audit trail.
- Reports include sales by period/cashier/product/category, payment summaries, cashier variance, inventory on hand/value, stock movements, gross margin (only when costing data supports it), purchases, returns and core financial statements within the approved accounting scope.

## 13. Security and audit

- Electron: context isolation enabled, renderer Node integration disabled, sandbox where compatible, strict Content Security Policy, narrow validated preload IPC API, and no arbitrary shell execution from renderer.
- Validate IPC, API and database input using Zod or equivalent schemas at trust boundaries.
- Hash passwords using Argon2id with appropriate parameters; never store plaintext credentials.
- Enforce role/permission checks in service layer. Protect secrets and database backups appropriately.
- Pino logging with rotation/retention policy; avoid logging passwords, payment secrets or unnecessary personal data.
- Audit product edits, price changes, stock adjustments, returns/refunds, permissions, branding changes, backups/restores and administrative overrides.

## 14. Premium visual design and interaction

- Design for a premium, modern, fluid POS, inspired by the quality and visual composition of the supplied Pinterest reference without copying assets or assuming unseen details. Exact pin visuals remain unverified until a screenshot is available.
- Define design tokens for color, gradient, typography, spacing, border, radii, shadows, icons, focus rings and semantic states. Use cohesive color blending with accessible contrast; avoid random gradients and low-contrast text.
- Reusable components for navigation, product grids, inventory tables, forms, buttons, dialogs, tabs, dropdowns, toast messages, empty/loading/error states and receipt preview.
- Smooth micro-interactions for hover, press, focus, navigation, dialogs, saving and cart updates. Use motion that feels immediate and continuous; no unnecessary delay or blocking animation.
- Respect reduced-motion settings. Critical checkout, barcode scanning and payment must remain responsive and keyboard-friendly.
- Use vector/high-resolution assets where appropriate; 4K asset quality does not mean rendering the whole UI at 4K or scaling every asset to 4K.
- Use transform/opacity animations where practical; profile performance and avoid long main-thread tasks, excessive rerenders, blocking IPC and synchronous work on the UI thread.
- 200+ FPS is an aspiration, not a universal guarantee: display refresh rate, GPU, OS compositor and hardware constrain actual presentation. Target smooth 60 FPS on agreed baseline hardware and make good use of 120/144/165/200+ Hz displays when supported. Establish measurable budgets after baseline hardware is chosen.
- Animations must never delay persistence or claim success before storage confirms it. Provide loading/error recovery without losing user input.

## 15. Architecture and technology

- Electron desktop shell, Vue 3 + TypeScript + Vite renderer, Pinia state management, Tailwind CSS and reusable components.
- Node.js + TypeScript for main-process and central service code; use narrow service boundaries and shared validated domain types.
- SQLite database per counter; evaluate better-sqlite3 compatibility with selected Electron runtime and native rebuild workflow before locking implementation. PostgreSQL is the central store database.
- Zod validation, Argon2id authentication, Pino logging, Vitest unit/integration tests, Playwright and Electron-specific tests.
- Secure packaging for Windows/Linux, versioned migrations, safe in-place updates, recovery on interrupted update/migration, and backup/restore verification.
- Do not install arbitrary latest dependencies without checking Node/Electron compatibility. Pin versions through lockfile and document build environment.

## 16. Hardware support

- Barcode scanners, thermal printers, cash drawers, scales and optional customer displays are hardware integration targets.
- Define a device abstraction and graceful unsupported-device errors. Test exact supported models/driver paths on Windows and Linux before claiming compatibility.
- A printer failure must not lose a committed sale; allow safe retry/reprint without duplicating the transaction.

## 17. Backup, recovery and updates

- Scheduled/manual backup policy, retention, destination validation, restore wizard and post-restore integrity checks.
- Back up local counter data, central database according to deployment mode, branding/logo assets, and required configuration/secrets under a documented secure policy.
- Versioned migrations must be transactional where possible, idempotent where required, and tested for interruption/recovery. Never run destructive migrations without a verified backup/recovery plan.
- Support safe in-place updates so customers do not need to uninstall/reinstall for every routine update where platform packaging permits. Preserve data and configuration; provide rollback/recovery behavior and clearly report update outcome.

## 18. Non-functional requirements

- Offline checkout remains usable through internet outages and central service downtime within available local stock allocation.
- No acknowledged sale may be lost after process restart or power interruption, subject to verified storage durability guarantees.
- Large product/inventory lists must remain responsive via pagination/virtualization and efficient database queries.
- Set and measure startup, scan-to-cart, search, save-feedback, checkout, sync throughput and memory targets on declared baseline hardware; do not make unmeasured performance claims.
- Accessible contrast, keyboard focus, reduced-motion support, legible thermal receipts, useful error messages and data migration safety.
- No critical action may silently fail or silently overwrite conflicting data.

## 19. Core data model (initial)

Store, Counter, DeviceIdentity, User, Role, Permission, Product, ProductBarcode, Category, Unit, UnitConversion, PriceLevel, TaxCategory, Supplier, PurchaseOrder, GoodsReceipt, PurchaseReturn, Sale, SaleLineSnapshot, SalePayment, ReceiptSnapshot, SaleReturn, Refund, CashRegister, CashierSession, CashMovement, StockMovement, StockAllocation, StockCount, StockAdjustment, BusinessBrandingProfile, BrandingRevision, AuditEvent, AccountingEvent, JournalEntry, JournalLine, OutboxEvent, ProcessedEvent, SyncAcknowledgement, SyncFailure, BackupJob, MigrationVersion. Refine schema and constraints before implementation; avoid duplicating derived values without a consistency policy.

## 20. Acceptance test baseline

- AT-001: Checkout creates durable local sale while offline.
- AT-002: Restart after local commit preserves sale, payments, receipt snapshot and outbox.
- AT-003: Retry/resend cannot duplicate sale, payment, stock movement or journal.
- AT-004: Multiple offline counters cannot sell beyond their local allocated stock under the default policy.
- AT-005: Allocation sums cannot exceed allocatable stock; central sale/allocation updates are atomic.
- AT-006: Reconnection synchronizes queued sales and acknowledges them; failures remain visible and recoverable.
- AT-007: Duplicate barcode/SKU is rejected.
- AT-008: Product price edit affects new sales only; historic sale line and receipt stay unchanged.
- AT-009: Product with transaction history can be archived, not hard-deleted.
- AT-010: Stock correction creates an authorized adjustment and stock movement.
- AT-011: Unsafe unit conversion/tracking changes are blocked or use controlled conversion.
- AT-012: Journal posting balances debits and credits.
- AT-013: Returns/refunds preserve original sale reference and do not rewrite historical records.
- AT-014: Owner can configure branding/logo and receipt fields offline.
- AT-015: 58 mm and 80 mm receipts render without clipping/overlap and omit unset fields.
- AT-016: Historical receipt reprint uses its saved branding snapshot; new sale uses current local profile.
- AT-017: Branding changes sync to other counters and remain cached offline.
- AT-018: Unauthorized cashier cannot edit prices, branding or permissions.
- AT-019: Product/branding edits generate audit entries with before/after values where applicable.
- AT-020: Backup restore recovers database, branding and logo and passes integrity checks.
- AT-021: Interrupted migration/update is recoverable without data loss.
- AT-022: Printer failure does not duplicate or lose a committed sale.
- AT-023: Inventory lists remain responsive under representative load.
- AT-024: Reduced-motion settings are respected and animation does not block checkout.
- AT-025: Keyboard/barcode checkout is not delayed by visual effects.
- AT-026: Windows and Linux install/update/uninstall paths are tested with data preservation.
- AT-027: All critical flows have automated unit/integration tests and relevant end-to-end tests.
- AT-028: Performance reports record hardware, OS, display refresh rate, dataset size and measured results; no unsupported FPS guarantee is published.

## 21. Delivery gates

1. Finalize domain rules, accounting posting matrix, stock allocation policy, and baseline hardware.
2. Create scaffold, shared types, lint/format/typecheck/test commands and CI-ready scripts.
3. Implement secure Electron shell and UI foundation.
4. Implement local schema, migrations, persistence and recovery tests.
5. Implement products, editable pricing and inventory ledger.
6. Implement checkout, payments, receipt snapshots and branding.
7. Implement central service, stock allocations, sync/outbox and conflict queue.
8. Implement accounting posting and reconciliation tests.
9. Implement backup/restore, packaging, safe updates and hardware adapters.
10. Run full acceptance tests and document unsupported hardware/known limits before release.

## 22. Related requirement addenda

- `BRANDING_REQUIREMENTS.md`: detailed branding/receipt acceptance criteria.
- `DESIGN_AND_INVENTORY_REQUIREMENTS.md`: visual UX, performance and inventory editing criteria.
