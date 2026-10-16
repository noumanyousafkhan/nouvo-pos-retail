# NOUVO POS Cash & Carry

Offline-first desktop point-of-sale software for small cash-and-carry and retail shops. Built with Electron, Vue 3, TypeScript, Vite, Pinia, Tailwind CSS, SQLite and Zod.

> **Release status:** The repository includes automated unit and desktop end-to-end tests. Run the checks below before distributing a build. Windows installation and upgrade behavior must still be verified on a real Windows machine; Linux/Wine testing is not a substitute.

## Features

- Local-first operation with a SQLite database managed per counter/device.
- User authentication and role-aware application navigation.
- Product catalogue, SKU/barcode lookup, categories, stock receipts, adjustments and write-offs.
- Configurable pack/single-unit selling with shared stock, separate unit prices, safe stock conversion and unit-aware returns.
- Barcode-first checkout, cart quantities, payment methods, split payments and cash change.
- Safe product deletion for unused products; archive products with business history to preserve reports and audit trails.
- Cashier shifts, sales history, receipt preview/printing and sale/line snapshots.
- Returns and void workflows, purchasing and supplier payments.
- Sales, stock, margin and accounting reports; accounting journal and reconciliation workflows.
- Store branding, receipt settings, database backup/restore and audit history.
- Durable sync outbox and an optional PostgreSQL central sync service for multi-counter deployments.
- Responsive layout for smaller counter displays and larger monitors.

Feature availability and role permissions should be checked against the current UI and requirements documents; the optional central service is not a turnkey production-hosted deployment.

## Requirements

- Node.js 22.x
- npm 10.x or compatible
- Windows or Linux for development; Linux end-to-end tests use Xvfb
- Network access for installing dependencies and building Windows prerequisites; normal local checkout is designed to work offline

## Get started

```bash
npm ci
npm run dev
```

If you have an existing local working copy and intentionally changed the lockfile, use `npm install` instead of `npm ci`.

## Quality checks

Run from the repository root:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

The build runs type-checking, unit tests and the Electron/Vite production build. The current test suite includes database migrations and persistence, authentication, inventory and stock movements, checkout and payments, returns, purchasing, cash sessions, reporting, accounting, backup/restore and sync behavior.

### Packaged end-to-end tests (Linux)

```bash
npm run build
npx electron-builder --linux dir
npm run test:e2e:auth:linux
npm run test:e2e:retail:linux
npm run test:e2e:linux
npm run test:e2e:responsive:linux
```

These tests launch the packaged Linux application and use isolated test data. They are not a replacement for manually testing receipt printers, barcode scanners, Windows installation/upgrade, or the actual shop hardware.

## CI/CD and versioned releases

GitHub Actions is configured in `.github/workflows/desktop-build.yml`.

- Pull requests and pushes run lint, formatting, type-checking, unit tests and the production build.
- Pushes to `main` also build Windows x64 NSIS installers and Linux AppImage/`.deb` packages; download them from the workflow run's **Artifacts** section.
- Pushing a version tag such as `v0.2.6` builds both platforms and publishes the installers as a GitHub Release. The tag must match `package.json`'s version.
- CI artifacts are temporary workflow downloads (14-day retention); tagged GitHub Releases are the versioned distribution point.
- Builds run on native Windows and Linux GitHub-hosted runners to avoid cross-platform native-module packaging problems.

To publish a release after committing the version in `package.json` and `package-lock.json`:

```bash
git tag v0.2.6
git push origin v0.2.6
```

Only create a tag once that version is ready to distribute. Test the downloaded installers on clean target machines before production use.

## Build installers

### Windows (NSIS x64)

On a Linux build machine with network access:

```bash
npm run build:win
```

The build prepares the Windows x64 Argon2 native binding and downloads the official Microsoft Visual C++ x64 redistributable into the ignored `build/` directory when it is missing. The installer uses that prerequisite only if the required runtime is not already installed. Do not commit the downloaded redistributable or generated installers.

Output: `release/NOUVO POS Cash and Carry Setup <version>.exe`

### Linux

```bash
npm run build:linux
```

Output is written to the ignored `release/` directory. On a native Windows build runner, use `npm run build:win:ci`; `build:win` is the Linux cross-build path. Always install and launch the resulting package on a clean target machine before distribution.

## Optional central sync server

The server lives in `sync-server/` and uses Node.js, TypeScript and PostgreSQL. Read [the sync-server guide](sync-server/README.md) before running it. Local integration tests require Docker Compose and a disposable development database.

The sync service binds locally by default. Production deployment requires HTTPS/TLS, protected secret storage, backups, monitoring, recovery procedures and end-to-end acceptance testing. Never expose the development admin UI or a plain-HTTP sync endpoint to the public internet.

## Project structure

- `src/main/` — Electron main-process services, persistence, IPC and business logic
- `src/preload/` — narrow, context-isolated renderer API
- `src/renderer/` — Vue UI and styles
- `src/shared/contracts/` — shared, validated contracts
- `tests/` — unit and packaged end-to-end tests
- `sync-server/` — optional central PostgreSQL sync service
- `docs/` — requirements, architecture, accounting and release documentation
- `build/` — application icons and installer resources (generated prerequisites are ignored)
- `release/` — generated installers and packaged applications (ignored)

## Data and security

- Keep real shop data, local SQLite databases, backups, credentials, tokens and environment files out of Git.
- Renderer Node integration is disabled; context isolation and the preload bridge limit renderer access.
- Validate IPC inputs and outputs; review permission checks whenever adding a new command or screen.
- Keep counter tokens separate from the central sync admin token. Store production secrets in the deployment environment/secret manager.
- Test backup restoration before relying on a backup for recovery.
- Report suspected security vulnerabilities privately to the repository owner rather than opening a public issue with exploit details.

## Documentation

Start with `docs/ARCHITECTURE.md`, `docs/SRS_v1.1.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/ACCOUNTING_POSTING_MATRIX.md`, and the branding/inventory requirements documents. Pack/single-unit stock conversion and safe deletion are described in `docs/PACK_AND_SINGLE_UNIT_INVENTORY.md`. Product and opening-stock data are intentionally kept out of this application repository; new installations should start with an empty inventory.

## License

No open-source license is declared in this repository yet. All rights remain with the copyright holder unless a license is added explicitly.
