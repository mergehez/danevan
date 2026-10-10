# Test audit

**Status:** 976 unit tests (76 files) · 103 browser tests (27 files) · 10 Electron shell tests
(dev build ×9 + packaged `.app`) · coverage over every source file **44.6 % statements / 36.8 % branches** ·
aggregate and per-area floors enforced in `vitest.config.js` · a run that skips a precondition fails.

The long survey that drove the earlier rounds is recoverable from git:
`git show 7e54f4c:TESTS-AUDIT.md`. `## Done` is what a green run already proves; `## Open` is what it
still does not.

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

Components exercised only by the browser suite show 0 % _unit_ coverage and are fine — do not add unit
tests for them; extend the browser spec instead. Genuinely uncovered and not worth a task:
`releaseHelpers.ts` (175), `vite-plugin.ts`, `executeCommand.ts`, `electronConfig.ts`,
`handleScripts.ts`, `Splitter*.tsx`, `DataTable.tsx`, `Select.tsx`, `SettingsModal.tsx` (a stub),
`loadingIndicatorState.ts`, `appDirectives.ts`. The Electron entry points (`src/electron/*`,
`mainProloadHelpers.ts`, `useDatabase.ts`) are not in that bucket — they ship to users, and the shell
tasks in `## Open` track them.

## Done

Each item is work a green run already proves; do not redo it.

- **App shell + sidebar controls**, add-source field swapping, a stored source with its tables, the
  server edit form and its numeric port, connection ordering / hide / error naming / schema popover.
- **Open table + loading state** and the huge-table row-count estimate.
- **Grid search**, the inline and modal cell editor (wrap, JSON prettify), add row with NULL columns,
  the grid toolbar (column visibility, paging, page size, reload, custom query).
- **Row mutations**: edit, preview and save a row; edit / duplicate / delete row with undo-redo;
  multi-row "Delete N Rows"; the two-change preview and the FK-violation dialog.
- **Foreign-key peek** (relation, usages, empty states) and **table comparison** (differences,
  identical filter, breaking changes, Markdown export).
- **Modify table** for MySQL (add / type / undo / redo / move / drag / delete column, API + popup) and
  for SQLite (the rebuild: a table rename goes through SQLite's own `RENAME` so child foreign keys and
  views follow it, the AUTOINCREMENT counter is preserved, and a table a view selects from can still be
  rebuilt — `useSqliteDriver.spec.ts`, `sqlite-modify-table.spec.ts`).
- **SQLite table DDL** (`sqliteTableDdl.ts`: statement splitting with quoted and nested commas, column
  definition lookup, AUTOINCREMENT/COLLATE detection, the `CREATE TABLE` for a modify plan, and the
  primary-key / AUTOINCREMENT derivation the rebuild shares).
- **Table create/delete, Copy as DDL, create database**, and the **HTTP API contract** (all 54 backend
  handlers, their input guards, the server/connection/script/settings round trips).
- **Mysqldump**: dump output and defaults, menu visibility, and the export from the modal with chosen
  options.
- **Run SQL script** (API + menu), the SQL editor run, draft reload and cursor stability, the SQL editor
  panels (save modal create/rename, Problems, per-script History, Format), and Monaco SQL completion
  (tables, columns, qualifiers, dialect quoting, keywords, snippets).
- **Tabs** (neighbour close, reopen, close all, drag reorder), sticky sidebar rows, and sidebar
  management (script create/delete, Collapse all, Clear metadata caches, collection filter, SQL history
  modal).
- **Tree and keyboard state machines** (`useTree`, `useFileTree`, `useKeyboardNavigation`, sidebar
  arrows), the **directives** (modifier parsing, tooltip, context menu panel, error, loading), the small
  leaf helpers (drag payload, formatter worker, native paths, min lifetime, confirm, toast, client
  lookup, MS Access manifest, SQL script runner), and the grid context-menu planning (cell peek items,
  row menu for single vs multi selection, header formatter menu, toolbar copy item, `useDbDataGrid`).
- **Sources added through the form** (SQLite, and MySQL with a password) and the **MySQL modify-table
  apply against a live server** — the two write paths the browser suite drives for real.
- **Dialect SQL** (`dialectSql.ts`: quoting per dialect, referential actions, TypeORM foreign keys,
  PostgreSQL statement preparation) and the Windows MySQL client lookup (`where.exe`, `Program Files`
  candidates, `bin\<command>.exe` scan).
- **The remote modify-table DDL builders** (`remoteTableDdl.ts`, `mysqlTableDdl.ts`,
  `postgresTableDdl.ts`: key and index signatures, primary-key and dropped-column derivation, the MySQL
  ALTER / ADD / CHANGE / option statements, and every statement PostgreSQL generates, including the
  collation and identity changes it refuses).
- **SQLite 64-bit integers** (`useSqliteDriver.spec.ts`, `sqlite-query-columns.spec.ts`): the driver
  reads with `safeIntegers`, so a value above 2^53 keeps every digit instead of arriving rounded and
  being written back rounded. Integers leave the driver as exact decimal text (JSON cannot carry a
  BigInt) and a pragma's schema metadata is downcast to a number, because TypeORM reads it as one.
- **SQLite column renames** (`useSqliteDriver.spec.ts`, `sqlite-modify-table.spec.ts`): the rename goes
  through `ALTER TABLE … RENAME COLUMN` before the rebuild, which is what makes SQLite rewrite the
  child foreign keys and the views that name the column. A rename whose target name another column
  still holds is refused with the reason instead of silently re-pointing a reference.
- **The kind of a remote statement** (`remote-driver-tools.spec.ts`, `sql-editor-run.spec.ts`): the
  leading comments are stripped before the first keyword is read, so `-- report` followed by `SELECT`
  returns rows on MySQL, PostgreSQL and SQL Server instead of reporting a mutation.
- **MySQL write paths** (`mysqlSchemaHelper.spec.ts`, `modify-table.spec.ts`, `keyless-table.spec.ts`,
  `row-mutations.spec.ts`): the catalog's own encoding no longer reaches the DDL — an index column's
  `A`/`D` becomes `ASC`/`DESC` (changing an existing index used to emit `ADD INDEX (col A)`, a parse
  error after the DROP INDEX had already committed) and a string default is quoted with MySQL's own
  backslash escaping (`DEFAULT guest` was rejected and `DEFAULT ''` collapsed to `DEFAULT NULL`).
  A table without a primary key refuses the edit instead of issuing `UPDATE … WHERE <first column>`,
  and the hand-built insert and delete statements escape their literals for the dialect that reads
  them, so `C:\temp` and a trailing backslash survive.
- **Failure modes**: a save against a dead connection keeps the pending change and says why; credentials
  the server rejects name the connection; an unreachable backend shows its "Request failed" panel
  instead of an empty shell and recovers on reload; a `mysqldump` path that is gone is reported in the
  export modal; an unwritable app data directory reports the path it could not use.
- **PostgreSQL and SQL Server table lists and row counts** (the read-only half of those dialects).
- **MS Access**: the bridge protocol (`msAccessProtocol.ts`: value tagging and decoding, bracket
  quoting, the line-delimited worker frames, Java version parsing, the inbound-foreign-key guard),
  runtime discovery (`msAccessRuntimeManifest.ts`: bundled versus downloaded runtime, JRE folders,
  `DANEVAN_MSACCESS_*` overrides), the modify-table contract (`getMsAccessExplicitPlanErrors`,
  `buildMsAccessModifyTableStatements`), the Java bridge itself (`msAccessBridge.spec.ts` spawns the JVM
  against `assets/test-access-db.mdb`), the column-type mapping, the stable currency metadata, and the
  `ps-probe` PowerShell lookup (`msAccessPsProbe.ts`).
- **The Electron shell** (`shell.spec.ts` launches the built `dist-electron/main.cjs`: window, preload
  bridge, IPC round trip, `App.tsx` window title) and **the packaged application**
  (`test:e2e:packaged` builds the electron-builder bundle and launches `build/mac-arm64/Danevan.app`, so
  the asar layout, the bundled `backend.cjs` and the externalised `better-sqlite3` are proven).
- **The app database's own upgrade path** (`appDbSchema.spec.ts`, `restart.spec.ts`): the DB records
  `PRAGMA user_version` and runs its steps in order inside their own transactions, a step is safe
  against a file whose previous upgrade was left half finished, and a file a newer build wrote is
  refused with both versions named. The shell specs kill the process and start it again against the
  same DB: the sources, scripts and selection of the last session are there when it comes back.
- **A second launch and the native shell surface** (`second-launch.spec.ts`, `shell-native.spec.ts`):
  a second launch takes the instance lock, brings the open window forward and exits 0 (it used to sit
  there with the EADDRINUSE nowhere), and a busy API port names itself. The app menu's Cmd+, item
  reaches the renderer as a native command, `pickDatabaseFile` / `pickSavePath` / the reveal and open
  helpers answer over stubbed dialogs, a renderer diagnostic reaches the main process on the channel
  both ends now share, and closing the last window keeps the process alive until `activate` draws a
  new one (that path used to re-register every IPC handler and leave a blank window).
- **The macOS keychain argv** (`auth.spec.ts`): the process boundary is injected, so the spec asserts
  the real `add-generic-password` / `find-generic-password` / `delete-generic-password` arguments —
  the service and account names, the `-U` update flag, exit code 44 — and reads a stored secret back
  through a fake keychain. Account names are namespaced per data dir, so a second installation or a
  test run cannot read, or delete, the first one's passwords.
- **A read-only connection** (`appApi.spec.ts`, `readonly-connection.spec.ts`): the add-connection
  form sets the flag, the sidebar row carries a lock, the row menu offers 'Make read-only' /
  'Allow writes', and every write path refuses with the connection named while reads keep running.
- **The foreign-key peek's own state** (`fk-peek.spec.ts`): the rows popover says it is loading or why
  it is empty instead of drawing an empty grid, and the spec polls that state and re-walks the arrows
  until the cell editor really opens (1 failure in 4 runs before, none in 11 after).
- **Test infrastructure**: a skipped precondition fails the run (`failOnSkipReporter.ts`); coverage
  floors are one point below the measured numbers and per-area (`src/backend`, `src/datagrid`,
  `src/shared`, `src/directives`); `test:e2e:electron` and `test:e2e:packaged` build and launch the shell
  and the packaged `.app` with separate configs, because `appConfig` hard-codes the API port. The
  browser suite and every shell spec boot a test-owned app DB under `.e2e-data` (only its DB files are
  wiped per run, so the provisioned runtimes survive) — never the developer's real one.

## Open

The audited list is empty: every unblocked item of the last round is closed. What this round turned
up and did not fix:

- **A failed save shows the backend's JSON envelope (small)** — the save bar prints
  `Backend error (500): {"error":"…"}` with the message inside escaped JSON
  (`readonly-connection.spec.ts` and `failure-modes.spec.ts` assert around it). The user can read the
  message, but it should be the message alone.
- **The formatter specs assume a provisioned SQLFluff runtime (small)** — `formatSql` creates
  `sqlfluff-runtime` under the app data dir on first use (a venv plus an install), so the first spec
  to format SQL on a fresh data dir fails while it installs, and the parser-problem count is wrong
  until it exists. They should require it like the MySQL specs require their database.

## Open (blocked)

- **e2e-13 · PostgreSQL and SQL Server write paths (medium)** — every spec that writes builds its source
  with `createFileSource` (SQLite) or `createMySqlServerAndConnection` (MySQL), so no test edits a row,
  saves a pending change or applies a DDL change on PostgreSQL or SQL Server. Add a spec that edits,
  inserts and deletes a row, saves, and re-reads the value through `post(request, 'getTableData', …)` for
  both dialects, behind a `require*` precondition that fails loudly. Applying a saved modify-table plan
  is the other server-bound path: the pure DDL builders and the PostgreSQL helper wrapper are unit-tested,
  but the driver orchestration around them (TypeORM memory-sql drops, foreign-key and primary-key changes,
  the rename) still only runs against a server.
    - _blocked by_: a reachable PostgreSQL and SQL Server — the Docker and Podman CLIs are installed here
      but no daemon is running, so the images, credentials and seeded test databases are missing too.
- **unit-10 · Windows runner verification (small)** — `findClientExecutable` now injects the process/fs
  boundary, so its Windows lookup (`where.exe`, the `Program Files` candidates and the
  `bin\<command>.exe` scan) is asserted on every platform, and the POSIX-only lookup that made the app
  unable to find `mysql`/`mysqldump` on Windows is fixed. `sqlScriptRunner.spec.ts` and
  `bunSubprocess.spec.ts` still wrap their real-spawn cases in `describe.skipIf(!hasPosixShell)`; run
  those on a Windows runner to prove the real process behaviour.
    - _blocked by_: a Windows runner for the real-spawn specs (the injected-boundary specs run anywhere).
