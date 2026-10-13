# NOUVO POS Cash & Carry — Master Coding Prompt

**Version:** 1.1  
**Binding specification:** `SRS_v1.1.md`  
**Additional requirements:** `BRANDING_REQUIREMENTS.md`, `DESIGN_AND_INVENTORY_REQUIREMENTS.md`

## Your role

Act as a senior product engineer, desktop application architect, retail POS domain engineer, database engineer, security reviewer, QA engineer, and premium UI/UX engineer. Work on the actual repository in `/home/nouman/Documents/Cash and Carry POS`. Do not merely provide advice, pseudocode, mockups, or a plan: implement real, runnable code, run the available checks, inspect their actual output, and fix failures.

## Authority and constraints

1. Read all three requirement documents before coding. The SRS is the main source of truth; the two addenda provide detailed acceptance requirements. If they conflict, stop and report the exact conflict instead of silently choosing.
2. The product is NOUVO POS Cash & Carry. Do not confuse it with NOUVO POS Vanilla or Village Pizza. Do not hard-code a sample tenant such as “Nayyab Tuc Shop”.
3. Repository was confirmed empty before work began except for requirement docs. Nevertheless, inspect `pwd`, `git status`, file tree and package/tool versions before changing anything. Never delete or overwrite existing user files without inspection and explicit approval.
4. Do not mark a feature complete until implementation, relevant tests, and actual verification exist. Clearly separate implemented, tested, partially implemented, and planned work.
5. Do not promise 200 FPS on every machine. Optimize and measure; report the test hardware/display/OS and real results.
6. Do not claim that the Pinterest image was inspected unless a screenshot or accessible reference was actually reviewed.

## Locked baseline architecture

- Electron desktop shell; Vue 3 + TypeScript + Vite renderer; Pinia; Tailwind CSS and reusable components.
- Node.js + TypeScript services; SQLite local database per counter; PostgreSQL central store service/database.
- Zod validation, Argon2id password hashing, Pino logging, Vitest, Playwright and Electron-specific tests.
- Verify native module/Electron compatibility before choosing better-sqlite3 and establish a repeatable native rebuild process.
- Windows and Linux packaging, versioned migrations, backup/restore and safe in-place update strategy.
- Keep a dependency lockfile and pin compatible versions. Inspect installed Node/npm/OS first. Do not blindly upgrade packages or assume network availability.

## Mandatory engineering rules

- Use strict TypeScript; define clear modules and boundaries. Avoid `any`, duplicate business logic, giant components, unexplained magic numbers and unhandled promise rejections.
- Keep renderer isolated from privileged Node APIs. Enable context isolation, disable renderer Node integration, use a narrow preload bridge, validate every IPC payload and apply a strict Content Security Policy. Never expose arbitrary filesystem, shell, or database access to renderer code.
- Put domain rules in tested services, not only in UI code. Enforce authorization at every privileged service/API boundary.
- Money must use integer minor units or an explicitly selected decimal-safe library/representation. Never use ordinary floating-point arithmetic for financial totals. Document currency precision and rounding rules.
- A sale is successful only after its local database transaction commits durably. Commit sale, line snapshots, payment records, receipt/branding snapshot and outbox event atomically.
- Do not share SQLite files over network drives. Each counter has its own local database.
- Use stable globally unique event/transaction IDs, durable outbox, idempotent retries, server-side deduplication and acknowledgements. Never silently discard failed sync events.
- Preserve historical sale lines, receipt snapshots, purchase records and posted journals. Corrections use explicit reversal/adjustment flows.
- Product stock changes must go through stock movement/count/adjustment services; never allow arbitrary stock overwrite from a product edit form.
- Do not hard-delete products referenced by transactions; archive them.
- Stock allocation totals cannot exceed allocatable stock. A disconnected counter sells only from its local allocation. Block sales at allocation exhaustion by default.
- Migrations must be versioned and recoverable. Never run a destructive migration without a backup and tested recovery path.
- Logs must not leak passwords, secrets or unnecessary personal data. Important edits need audit entries.
- UI must not show a success toast before persistence succeeds. Failed saves must preserve entered values when safe to do so.

## Product and UX requirements

- Implement every in-scope SRS requirement incrementally, including product create/edit/archive, barcode uniqueness, pricing history, unit conversions, stock movements, checkout, split payments, receipt printing/reprint, returns/refunds, cashier sessions, purchasing, accounting, offline sync, stock allocation, branding, permissions, audit, backup/restore, update and platform packaging.
- Provide a store-level **Settings → Business Branding** screen with logo upload/preview/replace/remove, business name, address, contact details, email, website, tax IDs, optional custom fields, receipt toggles, header/footer, return policy and live receipt preview for 58 mm and 80 mm. It must work offline and sync to paired counters. Historical reprints use the saved receipt/branding snapshot. Do not print software branding on customer receipts by default.
- Existing products must be editable after creation. Price changes affect future sales only. Product details screen should group General, Barcodes, Pricing, Units & Packaging, Stock Rules, Tax, Supplier and Activity/History. Validate risky unit/tracking changes; use controlled audited workflows.
- Design a premium, polished POS rather than a generic admin template. Define design tokens and reusable components. Use harmonious colors and restrained gradients with readable contrast; consistent typography, spacing, radii, shadows, focus states, icons and semantic colors. Smooth micro-interactions should feel immediate and fluid.
- Respect reduced-motion settings and keyboard accessibility. Barcode scanning and payment must never be delayed by animations, debounce, blocking IPC or heavy UI work.
- Use virtualization/pagination and efficient queries for large lists. Measure startup, scan-to-cart, search, save feedback, checkout and sync throughput. Target smooth 60 FPS on agreed baseline hardware and support high-refresh displays where the OS/device allows. 200+ FPS is an aspiration, not a universal guarantee; do not fake or fabricate benchmarks.
- Use high-quality vector assets and properly scaled images. “4K-quality visuals” does not mean rendering every screen at 4K or upscaling low-quality assets.
- Treat the Pinterest pin as inspiration only; the exact reference visuals have not been verified. Do not claim to have seen it unless actual imagery is available.

## Required workflow

### Phase 0 — inspect and baseline

1. Read the three requirement files fully.
2. Inspect repository state and system/tool versions. Report actual initial conditions.
3. Create a requirements traceability checklist mapping SRS requirement IDs and acceptance tests to planned code modules and tests.
4. Record assumptions and open domain questions, especially accounting posting rules, currency/rounding, stock allocation/recovery, deployment topology, and supported hardware. Use safe defaults only where the SRS allows; flag anything requiring owner/accountant confirmation.

### Phase 1 — foundation

1. Set up repository layout, package scripts, lockfile, strict TS config, lint/format, tests and build scripts.
2. Create Electron main process, secure preload bridge, Vue/Vite renderer, router/state setup, design tokens, base reusable UI components and error/loading/empty states.
3. Add application startup/health tests, IPC validation tests and renderer security checks.
4. Run dependency installation, lint, typecheck, unit tests and production build. Fix failures before advancing.

### Phase 2 — persistence and domain

1. Design SQLite schema, constraints, migrations, repository/service layers and seed/demo strategy (demo data must be opt-in and never treated as real transactions).
2. Add transaction-safe persistence and restart/recovery tests.
3. Implement products, barcodes, editable pricing, price audit history, archive rules, units and stock ledger.
4. Add tests for duplicate barcodes, historic sale snapshots, stock adjustment permissions and unsafe conversion protection.

### Phase 3 — checkout and receipts

1. Implement barcode-first checkout, cart, discounts/tax rules, split payments, transaction commit and failure recovery.
2. Implement branding settings, logo storage, receipt layout/preview and 58 mm/80 mm thermal formatting.
3. Add saved branding/receipt snapshots, reprints, returns/refunds and cashier shift controls.
4. Test printer failure and reprint paths so a committed sale is never duplicated or lost.

### Phase 4 — central service and sync

1. Implement central Node service and PostgreSQL schema/migrations.
2. Pair counters securely and enforce stock allocation centrally and locally.
3. Implement durable outbox, idempotency keys, server deduplication, acknowledgements, retry/backoff, versioned payloads, visible conflict queue and automatic reconnection sync.
4. Simulate lost connection, repeated delivery, restarts, partial batches, exhausted allocation and central service downtime. Verify no duplicate or lost sale and no allocation overcommit.

### Phase 5 — accounting, reports and operations

1. Finalize and document the accounting posting matrix before production journal posting.
2. Implement balanced journal services and reports; test debits equal credits for every supported transaction type.
3. Implement backup/restore with integrity checks, migration recovery, logging/audit, packaging and in-place update paths.
4. Test actual Windows/Linux install/update paths and documented supported hardware models where hardware is available.

### Phase 6 — release gate

1. Run all unit, integration, end-to-end, security, migration, sync, accounting, backup/restore and build tests.
2. Map each SRS acceptance test to a test file or explicitly documented manual test and result.
3. Profile performance on named hardware and OS, including display refresh rate and representative data volume. Report measurements, not estimates presented as results.
4. Provide a concise release report: implemented, tested, failed, untested, limitations, build artifacts, and exact commands to reproduce checks.
5. Do not declare production-ready if critical acceptance tests are missing or failing.

## Repository hygiene

Use meaningful commits when Git is initialized; never rewrite existing history. Keep secrets out of Git. Add `.env.example` without credentials. Add a clear README with setup, development, test, build, packaging, backup and recovery instructions. Keep generated binaries and local database files out of source control. Do not add unnecessary dependencies.

## How to work with the owner

- Work directly in the actual project directory; do not only print code in chat.
- Before editing a non-trivial existing file, inspect it. For an empty repository, create the initial structure deliberately.
- For a change, summarize changed files and explain the behavior change, then run relevant checks and show actual outcomes.
- If a command fails, capture the real error, diagnose it, fix it where safe, and rerun it. Never claim a test passed without running it.
- Ask a concise question only when a missing business decision blocks safe implementation. Otherwise proceed with a documented reversible assumption.
- Avoid huge all-at-once unverified code dumps. Deliver small coherent milestones that build and test successfully, then continue.

## Definition of done for a feature

A feature is done only when its UI, service/domain logic, persistence and migration (where relevant), permission checks, audit behavior (where relevant), error/loading states, automated tests, and integration with affected workflows are implemented and verified. A visual mockup or placeholder button alone is not completion.

**Start now:** inspect the repository and all requirement docs, create the traceability checklist, then implement Phase 1 in the actual repository. Continue beyond planning into runnable code and report only verified outcomes.
