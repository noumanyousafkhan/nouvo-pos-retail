# NOUVO POS Cash & Carry

Offline-first Windows/Linux desktop POS built with Electron, Vue 3, TypeScript, Vite, Pinia and Tailwind CSS.

## Current milestone

**Phase 1 foundation is in progress.** The current UI and desktop bridge are scaffolding only. Checkout, inventory persistence, SQLite migrations, central synchronization, accounting, printing and backup/restore are not yet implemented. Do not use this build for real transactions.

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
- SQLite driver selection is intentionally pending Electron/native-module compatibility verification.
- Do not commit credentials, real customer data, local databases or release artifacts.

## Requirements documents

See `docs/SRS_v1.1.md`, `docs/BRANDING_REQUIREMENTS.md`, `docs/DESIGN_AND_INVENTORY_REQUIREMENTS.md`, `docs/MASTER_CODING_PROMPT_v1.1.md` and `docs/REQUIREMENTS_TRACEABILITY.md`.
