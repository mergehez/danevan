# Test audit — what to test next

**Status:** 938 unit tests (74 files) · 94 browser tests (25 files) · 2 Electron shell tests
(dev build + packaged `.app`) ·
coverage over every source file **43.7 % statements / 36.0 % branches** · aggregate and per-area
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
AUTOINCREMENT/COLLATE detection, and the `CREATE TABLE` generated for a modify plan)** · **the SQLite
modify-table rebuild (`useSqliteDriver.spec.ts` and `sqlite-modify-table.spec.ts`: a table rename goes
through SQLite's own `RENAME` so child foreign keys and views follow it, the AUTOINCREMENT counter is
preserved instead of restarting at the highest surviving id, and a table a view selects from can
still be rebuilt)** · **a save against a dead connection keeps the pending change and says why in the save bar ·
credentials the server rejects name the connection · an unreachable backend shows its "Request
failed" panel instead of an empty shell and recovers on reload · a `mysqldump` path that is gone is
reported in the export modal · an unwritable app data directory reports the path it could not use** ·
**dialect SQL (`dialectSql.ts`: quoting per dialect, referential actions, TypeORM foreign keys,
PostgreSQL statement preparation) and the Windows MySQL client lookup (`where.exe`, `Program Files`
candidates, `bin\<command>.exe` scan)** · **the remote modify-table DDL (`remoteTableDdl.ts`,
`mysqlTableDdl.ts`, `postgresTableDdl.ts`: key and index signatures, primary-key and dropped-column
derivation, the MySQL ALTER / ADD / CHANGE / option statements, and every statement PostgreSQL
generates, including the collation and identity changes it refuses)** · **the MS Access bridge protocol (`msAccessProtocol.ts`:
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
Applying a saved modify-table plan is the other server-bound path: the pure DDL builders and the
PostgreSQL helper wrapper are unit-tested, but the driver orchestration around them (TypeORM
memory-sql drops, foreign-key and primary-key changes, the rename) still only runs against a server.

- _depends on_: a reachable PostgreSQL and SQL Server — the Docker and Podman CLIs are installed here
  but no daemon is running, so the images, credentials and seeded test databases are missing too.

---

## Unit tasks

### unit-13 · SQLite column renames and referenced foreign keys (small)

`applyModifyTable` now lets SQLite rewrite the references when the _table_ is renamed, but renaming a
_column_ still rebuilds the table without a native `ALTER TABLE … RENAME COLUMN`, so a child table's
`REFERENCES parent(old_column)` is left pointing at a column that no longer exists — the same silent
breakage, one level down. Apply the column renames through SQLite before the rebuild (3.25+ rewrites
the references with them), or refuse the rename with a clear message when a child references that
column. Needs nothing but a real SQLite file.

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
- `fk-peek.spec.ts` › "lists the referencing rows and shows what they point at" is flaky: it failed one
  of three isolated runs because the peek editor never appeared inside the 5 s locator wait, and passed
  the others. `retries: 0` means a flake fails the run, so the wait should key off the popover's own
  state instead of a fixed expectation timeout.
- `bun run test:e2e:electron` builds the shell (`build:shell`) and launches it;
  `bun run test:e2e:packaged` additionally runs `electron-builder` and launches the packaged `.app`.
  Separate configs are needed because `appConfig` hard-codes the API port every one of them binds.

---

## Verified defects with no failing test

Found while checking whether a green run means "stable" for SQLite + MySQL on macOS. Each was
reproduced or read out of the code path named; each needs a spec that fails first.

- **MySQL: editing a table without a primary key overwrites every row sharing the first column's
  value.** `useDbDataGrid.ts` falls back to `allColumns[0]` as the match column for an update, while
  the delete path refuses to run without a key. Every MySQL fixture declares a primary key.
- **SQLite: 64-bit integers are silently corrupted.** Neither `useSqliteDriver.ts` nor
  `bunTypeOrmSqliteDriver.ts` enables `safeIntegers`, so `9007199254740993` comes back as
  `9007199254740992`, and a saved edit writes the rounded value. No fixture uses a value above 2^53.
- **MySQL: changing an existing index emits an `ADD INDEX` with `A` as the sort order**.
  The catalog reports the index sort order as `A` or `D`, the driver passes it
  through, and MySQL rejects the statement with `ER_PARSE_ERROR` — after the
  `DROP INDEX` has already committed. Index fixtures only pass `order: null`.
- **MySQL: a column with a string default cannot be altered.** `column_default` comes back as the bare
  literal (`guest`) and is rendered unquoted (`DEFAULT guest`, rejected); `DEFAULT ''` becomes the empty
  string and is then normalised to `DEFAULT NULL`. Fixtures only use `DEFAULT NULL` / `DEFAULT 0`.
- **MySQL: inserts and deletes are hand-built text escaped for single quotes only**, so MySQL reads a
  backslash as an escape (`C:\temp` stores a tab) and a trailing backslash can break the statement. The
  same path is only verified on SQLite, where backslashes are literal.
- **A statement that starts with a comment runs as a mutation on the remote drivers** — `-- report` plus
  `SELECT …` matches no prefix in the read/mutation regex, so the editor reports rows affected instead of
  rows. The unit spec only ever passes SQL that starts with `SELECT`.
- **The connection `readonly` flag is stored and round-tripped but never enforced**: no form sets it and
  no write path checks it.

## Structural gaps for the SQLite + MySQL + macOS scope

- `src/electron/main.ts` is 0 % covered: the menu, `pickDatabaseFile`/`pickSavePath`/`revealPathInFileManager`/
  `openFileInEditor`, diagnostics and `activate`/`window-all-closed` are never invoked by a spec. The shell
  specs assert a window, the preload bridge keys and one `getBootstrap` round trip.
- Restart persistence is not tested: the suite's "restart" is `page.reload()` with the backend still alive,
  and no spec closes and reopens the app DB or the source file across a process boundary.
- The macOS Keychain is only asserted through mocks (`auth.spec.ts` mocks `executeTextCommand`,
  `appApi.spec.ts` mocks `auth`), so a wrong `security` argument list stays green.
- The app DB has one ad-hoc `ALTER` and no `PRAGMA user_version`/migration record, and Playwright runs the
  real `~/Library/Application Support/danevan` DB (no `APP_DATA_DIR` in `playwright.config.ts`), so neither
  a fresh nor a legacy app DB is booted by a test.
- A second app launch collides with the hard-coded API port: no listen `error` handler and no
  single-instance lock, so the second window never opens.

---

## Everything else still at 0 %

Components exercised only by the browser suite show 0 % _unit_ coverage and are fine — do not add unit
tests for them; extend the browser spec instead. Genuinely uncovered and not worth a task yet:
`releaseHelpers.ts` (175), `vite-plugin.ts`, `executeCommand.ts`, `electronConfig.ts`,
`handleScripts.ts`, `Splitter*.tsx`, `DataTable.tsx`, `Select.tsx`, `SettingsModal.tsx` (a stub),
`loadingIndicatorState.ts`, `appDirectives.ts`.

The Electron entry points (`src/electron/*`, `mainProloadHelpers.ts`, `useDatabase.ts`) are deliberately
not in that bucket: they ship to users and are tracked by e2e-12 and e2e-15.
