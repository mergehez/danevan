# Danevan

Danevan is a compact desktop database client built with Electrobun, Bun, Vue 3, and Vite.

The project follows a thin-shell architecture: the native layer stays focused on windowing, IPC, database access, credential handling, and a few OS integrations, while the renderer owns the product experience.

## Current State

The app is already usable as a daily local database client and currently includes:

- Multi-database support for SQLite, MySQL, PostgreSQL, SQL Server, and MS Access.
- Server and file-source management for both remote and local database workflows.
- Named connections with test-before-save flows.
- Saved SQL scripts, scratch tabs, and persisted workspace tabs.
- A Monaco-based SQL editor with diagnostics, formatting, and dialect-aware autocomplete hooks.
- Table and view browsing with row counts, pagination, inline data editing, and batched value updates.
- Schema exploration for columns, indexes, keys, foreign keys, comments, collations, and table metadata where supported.
- Modal-driven table design flows for creating and modifying tables, columns, indexes, keys, and foreign keys.
- Foreign-key usage peek tools for tracing related rows from table data.
- Table DDL retrieval and copy workflows.
- Custom grid formatters and per-column formatter assignment.
- External editor registration and "open in editor" support.
- A compact dark desktop UI built with Vue, Tailwind CSS, shared UI packages, and a custom datagrid.

## Architecture

### Thin Native Shell

The Electrobun/Bun side is intentionally small. It hosts the app window, owns the RPC surface, talks to databases, stores app metadata, and exposes a few platform integrations such as file pickers and editor launching.

### Vue-First Product Logic

Dialogs, menus, state flows, table editing, script management, and workspace behavior live in the renderer whenever possible. This keeps the backend smaller and makes most product work easier to reason about and test.

### Stable App Contracts

IPC methods and payload shapes are centralized so the frontend can evolve without constant cross-boundary churn. Shared app-facing types live in `packages/shared/src/utils/appClient.ts`.

## Supported Platforms

The documented build and release path currently targets:

- macOS on Apple Silicon

Other environments may work for development, and parts of the backend already include Windows-specific handling for MS Access support, but the maintained packaging flow in this repository is the macOS path above.

## Repository Layout

- `apps/app/electrobun`: Electrobun entrypoint, window setup, menu wiring, and RPC handlers.
- `apps/app/backend`: database drivers, schema/query logic, app metadata storage, SQL diagnostics, and secure credential helpers.
- `apps/app/mainview`: Vue renderer, composables, styles, and UI components.
- `packages/shared`: shared UI primitives and frontend utilities.
- `packages/datagrid`: reusable datagrid used for query results and table data.
- `packages/directives`: shared Vue directives and overlay helpers.

## Build From Source

This repository uses Bun as the package manager and script runner.

### Prerequisites

- Bun
- macOS on Apple Silicon for the documented release flow

Install dependencies:

```bash
bun install
```

Start development mode:

```bash
bun run dev
```

This builds the shared packages, starts the Vite renderer, and launches the Electrobun app in watch mode.

## Validation And Tests

Run the Vitest suite:

```bash
bun run test:ui
```

Run linting and type checks:

```bash
bun run lint
```

Run the stronger maintainer validation pass:

```bash
bun run ready
```

That runs workspace checks, tests, and production builds together.

## Optional Driver Checks

Run opt-in remote database checks:

```bash
DANEVAN_TEST_MYSQL_URL=mysql://user:pass@localhost:3306/db \
DANEVAN_TEST_POSTGRES_URL=postgres://user:pass@localhost:5432/db \
bun run test:remote
```

If either URL is missing, that driver's checks are skipped.

## MS Access Runtime Support

MS Access support uses a Java-based bridge runtime. The app can work with:

- a bundled offline runtime in `assets/msaccess-runtime`
- a downloaded runtime in app data
- a locally available Java installation when a bundled JRE is not present

To bundle the runtime into the repository assets for release builds:

```bash
bun run bundle:msaccess-runtime
```

The helper script also accepts `--java-home`, `--darwin-java-home`, and `--win32-java-home` to bundle matching JREs.

## Build Commands

Build the app:

```bash
bun run build
```

Build Electrobun distribution variants directly:

```bash
bun run build:canary
bun run build:stable
```

Build a macOS release bundle and DMG:

```bash
bun run release:mac
```

Signed build:

```bash
bun run release:mac:signed
```

Signed and notarized build:

```bash
bun run release:mac:notarize
```

The release wrapper prepares icon assets, runs the stable Electrobun build, verifies artifacts where applicable, and installs the app into `/Applications` unless you pass `--no-install`.

## Maintainer Docs

Release-related and operational docs live here:

- [CHANGELOG.md](CHANGELOG.md)
- [RELEASING.md](RELEASING.md)
- [ROADMAP.md](ROADMAP.md)
- [SECURITY.md](SECURITY.md)

Generated outputs such as `build/`, `artifacts/`, `dist/`, `.vite/`, local databases, and local `.env` files should stay out of source control.

## Tech Stack

- Electrobun
- Bun
- Vue 3
- Vite Plus
- TypeScript
- Tailwind CSS
- Monaco Editor
- Vitest

## Roadmap

The current roadmap is maintained in [ROADMAP.md](ROADMAP.md). The project has moved past the "blank starter" phase; the next milestones are now focused on workflow maturity, release hardening, export/import, history, and security/transport polish rather than core app scaffolding.

## Contributing

Contributions are welcome, especially while the product surface is still settling.

Please keep changes focused, add or update tests when behavior changes, and update the relevant docs when workflows, release steps, or public capabilities change.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
