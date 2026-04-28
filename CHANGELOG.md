# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [0.1.0] - 2026-04-29

First public app baseline for Danevan as a compact desktop database client built on Electrobun, Bun, Vue 3, and Vite.

### Added

- Initial desktop shell built around Electrobun with a Vue-first renderer, a narrow RPC bridge, renderer diagnostics plumbing, and a compact dark workspace layout.
- Multi-database connectivity for SQLite, MySQL, PostgreSQL, SQL Server, and MS Access.
- Support for both file-based and server-based data sources, including database-file picking, server definitions, named connections, connection reordering, and connection selection persistence.
- Connection testing flows for supported drivers before saving connection details.
- macOS Keychain-backed password storage for saved connection credentials.
- Sidebar-driven workspace for servers, connections, tables, views, and saved SQL scripts.
- Tabbed working model for table tabs, saved script tabs, and scratch tabs.
- Saved script management with grouping, reordering, last-run tracking, and reassignment to different connections.
- Monaco-powered SQL editor with dialect-aware behavior, SQL diagnostics, formatting support, and external editor preferences.
- Query execution pipeline with stable row and mutation result shapes across the IPC boundary.
- Query result viewing in the shared datagrid, including value formatting hooks and clipboard-friendly frontend behavior.
- Table browsing with row limits, pagination, and per-table data loading.
- Schema exploration for tables, views, columns, keys, indexes, foreign keys, row counts, comments, collations, and engine metadata where supported.
- Server-schema discovery and connection creation from discovered schemas.
- Metadata refresh controls for server schemas, table information, per-connection schema caches, and full cache invalidation.
- Table DDL retrieval for inspection and copy workflows.
- Inline data editing support for individual cell updates and batched table changes.
- Foreign-key usage peek tools for finding related rows and counting references from dependent tables.
- Table designer workflows for creating and modifying tables, columns, keys, foreign keys, and indexes from modal-driven UI flows.
- Schema change planning support with generated preview statements and optional table-rebuild allowance for drivers that require heavier table rewrites.
- Grid formatter management for custom value formatters and per-column formatter assignment.
- Settings flows for editor registration, default external editor selection, active navigation view, row-limit preferences, and collection visibility filters.
- Shared UI foundations across the workspace, including splitters, confirmation modals, context menus, popovers, tree controls, and reusable form components.

### Security

- Kept the native shell intentionally thin by concentrating product workflows in Vue and limiting Bun-side responsibilities to database access, credential handling, filesystem integration, and RPC hosting.
- Standardized app-facing request methods and stable payload contracts for bootstrap data, query execution, schema metadata, formatter state, and editor settings.
- Added SQL diagnostics and backend error handling paths intended to surface failures cleanly in the renderer instead of crashing the app.

### Tooling

- Added Vitest-based UI test support and opt-in remote driver checks for MySQL and PostgreSQL.
- Added Vite Plus, TypeScript, Tailwind CSS, shared packages, and reusable datagrid/directive packages to support a compact monorepo workflow.
- Added release helpers for canary and stable Electrobun builds, macOS release packaging, MS Access runtime bundling checks, and release auditing.
