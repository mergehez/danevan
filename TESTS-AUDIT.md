# Test audit — what to test next

**Status:** 870 unit tests (70 files) · 91 browser tests (24 files) · 2 Electron shell tests
(dev build + packaged `.app`) ·
coverage over every source file **41.7 % statements / 33.7 % branches** · aggregate and per-area
floors enforced in `vitest.config.js` · a run that skips a precondition fails · **still a long tail
of 0 % files**.

The long survey that drove the last round of fixes is recoverable from git:
`git show 7e54f4c:TESTS-AUDIT.md`. This file is the work list.

---

## How to add a test

**Browser** — one spec per user-facing feature, however small:

- New file: `src/mainview/tests/e2e/<feature>.spec.ts`.
- Setup comes from `src/mainview/tests/e2e/helpers.ts`:
  `createFileSource(request, { label, schema })` (a temp SQLite file + source; `schema` seeds tables),
  `createMySqlServerAndConnection(request, MYSQL.database, label)`, `post(request, method, data)`
  (throws with the endpoint and body on failure), `requireMySqlDatabase(db, 'spec file')`,
  `requireMySqlExecutable`, `requireFixtureData(value, message)`, `MYSQL`, `API`, plus the sidebar
  navigation helpers (`reloadSidebarRow`, `expandSidebarRow`, `openSidebarRowMenu`, `openSidebarTable`) —
  sidebar rows are sticky, so navigation dispatches events instead of hit-testing a pinned row.
- Never `test.skip` — call a `require*` precondition so a missing dependency fails loudly.
- No `waitForTimeout`, no inline timeouts. Use `await expect(locator)…` or `await expect.poll(…)`.
- Assert the exact value the user sees. Never `length > 0`, `toBeTruthy()` or a screenshot alone.
- Verify: `bun x playwright test src/mainview/tests/e2e/<file>.spec.ts`, then `bun run test:e2e`. A run
  that skips a spec (a missing database downgraded to a skip) fails: fix the environment instead.

**Unit** — pure logic:

- Spec beside the module: `src/**/name.spec.ts`.
- Drive the real module; never `vi.mock` the module under test. Mock only the process/network edge.
- Verify: `node node_modules/vitest/vitest.mjs run <file>`, then `bun run test:coverage`.

Both: `bun run lint` (oxfmt + oxlint + vue-tsc) must stay clean. Coverage floors must not drop.

**Already covered — do not redo:** app shell + sidebar controls · add-source field swapping · stored
source + tables · server edit form / numeric port · connection ordering, hide, error naming, schema
popover · open table + loading state · huge-table estimate · grid search · inline + modal cell editor
(wrap, JSON prettify) · add row + NULL columns · modify table (add/type/undo/redo/move/drag/delete
column, API + popup) · mysqldump dump output/defaults/menu visibility · run SQL script (API + menu) ·
**edit / duplicate / delete row + undo-redo** · edit, preview and save a row · SQL editor run, draft
reload, cursor stability · sticky sidebar rows · **add source through the form (SQLite + MySQL with a
password)** · **multi-row "Delete N Rows"** · **two-change preview and the FK-violation dialog** ·
**grid toolbar (column visibility, paging, page size, reload, custom query)** · **table create/delete,
Copy as DDL, create database** · **foreign-key peek (relation, usages, empty states)** · **table
comparison (differences, identical filter, breaking changes, Markdown export)** · **the HTTP API
contract (all 54 backend handlers, their input guards and the server/connection/script/settings round
trips)** · **PostgreSQL and SQL Server table lists and row counts** · **tabs (neighbour close, reopen,
close all, drag reorder)** · **SQL editor panels (save modal create/rename, Problems, per-script
History, Format)** · **sidebar management (script create/delete, Collapse all, Clear metadata caches,
collection filter, SQL history modal)** · **mysqldump export from the modal with chosen options** ·
**Monaco SQL completion (tables, columns, qualifiers, dialect quoting, keywords, snippets)** · **tree
and keyboard state machines (`useTree`, `useFileTree`, `useKeyboardNavigation`, sidebar arrows)** ·
**directives (modifier parsing, tooltip, context menu panel, error, loading)** · **small leaf helpers
(drag payload, formatter worker, native paths, min lifetime, confirm, toast, client lookup, MS Access
manifest, SQL script runner)** · **grid context-menu planning (cell peek items, row menu for single
vs multi selection, header formatter menu, toolbar copy item, and the `useDbDataGrid` wiring)** ·
**the Electron shell (`src/mainview/tests/electron/shell.spec.ts` launches the built
`dist-electron/main.cjs`: window, preload bridge, IPC round trip, `App.tsx` window title)** ·
**the packaged application (`test:e2e:packaged` builds the electron-builder bundle and launches
`build/mac-arm64/Danevan.app`, so the asar layout, the bundled `backend.cjs` and the externalised
`better-sqlite3` are proven to work, not just the dev build)** · **SQLite table DDL
(`sqliteTableDdl.ts`: statement splitting with quoted and nested commas, column definition lookup,
AUTOINCREMENT/COLLATE detection, and the `CREATE TABLE` generated for a modify plan)** · **a save against a dead connection keeps the pending change and says why in the save bar ·
credentials the server rejects name the connection · an unreachable backend shows its "Request
failed" panel instead of an empty shell and recovers on reload · a `mysqldump` path that is gone is
reported in the export modal · an unwritable app data directory reports the path it could not use** ·
**dialect SQL (`dialectSql.ts`: quoting per dialect, referential actions, TypeORM foreign keys,
PostgreSQL statement preparation) and the Windows MySQL client lookup (`where.exe`, `Program Files`
candidates, `bin\<command>.exe` scan)** · **the MS Access bridge protocol (`msAccessProtocol.ts`:
value tagging and decoding, bracket quoting, the line-delimited worker frames, Java version parsing,
the inbound-foreign-key guard) and runtime discovery (`msAccessRuntimeManifest.ts`: bundled versus
downloaded runtime, JRE folders, `DANEVAN_MSACCESS_*` overrides) · the Access modify-table contract
(`getMsAccessExplicitPlanErrors` and `buildMsAccessModifyTableStatements`: what UCanAccess cannot
alter, the append-only statements and the rebuild through a temporary table) · **the Java bridge
itself (`msAccessBridge.spec.ts` spawns the JVM against `assets/test-access-db.mdb`: a real
CREATE TABLE/INSERT/read round trip, the metadata it reports back, and every column type the editor
offers** · **the Access column-type mapping: the eight spellings UCanAccess refuses are mapped to the
ones it accepts and no longer offered in the dropdown** · **stable Access column metadata: a currency
column reports `CURRENCY` from the file's own Jackcess type instead of a `DECIMAL` precision that
changed between reads, `NUMERIC` is folded into `DECIMAL`, and two reads of one table must agree** ·
**the `ps-probe` PowerShell lookup (`msAccessPsProbe.ts`: the native/bitness/`cmd.exe`-wrapper
candidate order, the `ConvertTo-Json` probe-answer parsing, the CLIXML transient retry and the
provider choice, all through an injected process boundary)**.

---

## Browser tasks (in priority order)

### e2e-13 · PostgreSQL and SQL Server write paths (medium)

Every spec that writes builds its source with `createFileSource` (SQLite) or
`createMySqlServerAndConnection` (MySQL); PostgreSQL and SQL Server only appear in the schema-helper
and table-list specs, so no test edits a row, saves a pending change or applies a DDL change on
either. Add a spec that edits, inserts and deletes a row, saves, and re-reads the value through
`post(request, 'getTableData', …)` for both dialects, behind a `require*` precondition that fails
loudly — the dialect where wrong SQL silently corrupts data is the one with no write coverage.

- _depends on_: a reachable PostgreSQL and SQL Server — the Docker and Podman CLIs are installed here
  but no daemon is running, so the images, credentials and seeded test databases are missing too.

---

## Unit tasks

### unit-8 · Remote driver DDL internals (medium)

`dialectSql.ts` now covers what was extractable without a server (identifier quoting, referential
actions, TypeORM foreign keys, PostgreSQL statement preparation); the rest of `useMySqlDriver.ts`
(6 %) and `usePostgresDriver.ts` (12 %) is schema and DDL builder code that runs against a live
server. Next slice: extract the pure DDL builders (index and ALTER statement generation) the way
`sqliteTableDdl.ts` was, and cover the server-bound remainder through the write-path specs instead of
unit tests. Extraction needs nothing; the remainder inherits e2e-13's dependency.

### unit-10 · Windows runner verification (small)

`findClientExecutable` now injects the process/fs boundary, so its Windows lookup (`where.exe`, the
`Program Files` candidates and the `bin\<command>.exe` scan) is asserted on every platform — and the
POSIX-only lookup that made the app unable to find `mysql`/`mysqldump` on Windows is fixed.
`sqlScriptRunner.spec.ts` and `bunSubprocess.spec.ts` still wrap their real-spawn cases in
`describe.skipIf(!hasPosixShell)`; run those on a Windows runner to prove the real process behaviour.

- _depends on_: a Windows runner for the real-spawn specs (the injected-boundary specs run anywhere).

---

## Test infrastructure

- A skipped precondition fails the run (`playwright.config.ts` → `failOnSkipReporter.ts`), so
  `E2E_SKIP_MISSING_DB=1` can no longer produce a green run that proves less.
- Coverage floors are one point below the measured numbers and per-area (`src/backend`, `src/datagrid`,
  `src/shared`, `src/directives`), so a gap cannot hide in the aggregate.
- `bun run test:e2e:electron` builds the shell (`build:shell`) and launches it;
  `bun run test:e2e:packaged` additionally runs `electron-builder` and launches the packaged `.app`.
  Separate configs are needed because `appConfig` hard-codes the API port every one of them binds.

---

## Everything else still at 0 %

Components exercised only by the browser suite show 0 % _unit_ coverage and are fine — do not add unit
tests for them; extend the browser spec instead. Genuinely uncovered and not worth a task yet:
`releaseHelpers.ts` (175), `vite-plugin.ts`, `executeCommand.ts`, `electronConfig.ts`,
`handleScripts.ts`, `Splitter*.tsx`, `DataTable.tsx`, `Select.tsx`, `SettingsModal.tsx` (a stub),
`loadingIndicatorState.ts`, `appDirectives.ts`.

The Electron entry points (`src/electron/*`, `mainProloadHelpers.ts`, `useDatabase.ts`) are deliberately
not in that bucket: they ship to users and are tracked by e2e-12 and e2e-15.
