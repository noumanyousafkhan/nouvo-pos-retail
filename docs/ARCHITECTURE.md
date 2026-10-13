# Architecture and module boundaries

## Runtime boundaries

- `src/renderer/src`: Vue UI only. No Node.js, filesystem, shell or direct database access.
- `src/preload`: small allowlisted bridge exposed through `contextBridge`. Only typed application operations are exposed.
- `src/main`: Electron lifecycle, IPC handlers, logging and privileged desktop integrations.
- `src/shared`: schemas and types shared across trusted process boundaries.
- `src/server`: reserved for the central Node.js/PostgreSQL service; not yet implemented.
- `database`: reserved for local SQLite schemas, versioned migrations and repositories; native SQLite dependency is not selected yet.
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
