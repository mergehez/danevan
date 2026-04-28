# Roadmap

This roadmap reflects the current state of Danevan after the first working app baseline. The project is no longer in pure scaffolding mode; the next work is mostly about workflow depth, release maturity, and trustworthiness for everyday use.

## Current Baseline

Danevan already ships a meaningful core:

- multi-driver support for SQLite, MySQL, PostgreSQL, SQL Server, and MS Access
- file-source and server-source connection flows
- saved connections, saved SQL scripts, scratch tabs, and persisted workspace tabs
- a Monaco-based SQL editor with diagnostics and formatting
- table and view browsing with pagination
- inline data editing and batched table data updates
- schema browsing for columns, indexes, keys, foreign keys, and table metadata
- modal-driven table creation and schema editing flows
- table DDL copy flows and foreign-key usage peek tools
- external editor routing and custom grid formatters
- a reusable datagrid and shared UI package structure

That means the biggest remaining work is no longer "build a database client at all." It is "make the current client more complete, safer, and faster to use."

## Near-Term Priorities

### 1. Query Workflow Maturity

Add the missing daily-driver SQL workflow pieces:

- automatic query history
- recent query recall
- per-tab or per-connection session restore
- execution timing and richer result metadata
- explicit affected-row counts and better mutation summaries

This is the highest-leverage product area because the editor, tabs, and result grid are already in place.

### 2. Export And Import

Add first-class data movement actions:

- export result sets and table data as CSV, TSV, and JSON
- copy with headers from the grid
- import CSV into existing tables
- preview and column-mapping support before import
- clear error feedback for type mismatches and rejected rows

The app already has strong grid and table primitives, so this is a natural next layer.

### 3. Connection And Sidebar Productivity

Improve the high-frequency browsing workflow:

- sidebar search and filtering
- duplicate connection
- favorites or pinned connections
- recent connections
- faster source-to-connection flows for repeated hosts
- clearer connection status and failure states

### 4. Grid Power Features

Extend the current datagrid into a stronger analysis tool:

- freeze columns
- lightweight filtering
- richer sort controls
- row-number awareness in more copy/export actions
- larger modal editing for wide or structured cell values
- more powerful copy/export formats directly from selections

### 5. Release And Trust Hardening

Keep improving the parts that make the app feel safe to install and maintain:

- tighter release audits
- better artifact verification and reproducibility
- clearer versioned release notes
- stronger test coverage around schema editing and IPC contracts
- bundle-size and startup-time monitoring

## Security And Transport Priorities

These are important enough to call out separately because they matter for serious remote-database use:

- SSL/TLS configuration for remote database connections
- SSH tunneling support
- more explicit credential-handling flows and failure messages
- clearer behavior around runtime downloads for optional tools
- continued focus on keeping the RPC surface narrow and stable

## Driver-Specific Depth

The app already spans several backends, so part of the roadmap is making each driver feel less "generic":

- better SQL Server-specific polish
- deeper MS Access runtime and packaging ergonomics
- more complete PostgreSQL schema and metadata handling
- more driver-specific DDL and migration ergonomics

## Longer-Term Product Work

Once the workflow and trust fundamentals above are stronger, the next big expansion areas are:

- schema compare between connections or databases
- data transfer between connections
- explain-plan and query profiling tools
- relationship visualization and dependency views
- richer administrative tools for supported remote drivers

## Not The Goal

The current direction is not to become a huge all-in-one workbench at any cost. The stronger goal is:

- keep the native shell small
- keep the UI compact and fast
- grow depth where it improves daily database work
- avoid turning the app into a slow, overly abstracted platform

## Best Next Milestone

The best next milestone from the current codebase is:

1. add query history and richer execution metadata
2. add export actions for results and table data
3. add sidebar search and connection productivity improvements

That combination would make the biggest user-visible difference without requiring a large architecture shift.
