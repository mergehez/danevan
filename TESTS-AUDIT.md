# Test audit — what to test next

**Status:** 694 unit tests (63 files) · 87 browser tests (23 files) · 1 Electron shell test ·
coverage over every source file **37.5 % statements / 29.6 % branches** · aggregate and per-area
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
`dist-electron/main.cjs`: window, preload bridge, IPC round trip, `App.tsx` window title)**.

---

## Browser tasks (in priority order)

### e2e-13 · PostgreSQL and SQL Server write paths (medium)

Every spec that writes builds its source with `createFileSource` (SQLite) or
`createMySqlServerAndConnection` (MySQL); PostgreSQL and SQL Server only appear in the schema-helper
and table-list specs, so no test edits a row, saves a pending change or applies a DDL change on
either. Add a spec that edits, inserts and deletes a row, saves, and re-reads the value through
`post(request, 'getTableData', …)` for both dialects, behind a `require*` precondition that fails
loudly — the dialect where wrong SQL silently corrupts data is the one with no write coverage.

### e2e-14 · Environment and connection failure modes (medium)

Three real failures have no spec. An unwritable app data directory (backend throws `SqliteError:
attempt to write a readonly database`, never listens on the API port, and every screen is dead with
no message) must surface an error the user can read. A connection that worked when the source was
added but is gone when a save runs must keep the pending change and show the failure where the result
would appear. Bad credentials and a missing `mysqldump` binary (`requireMySqlExecutable`) must each
name the problem on screen. Assert the message, not that the app stayed up.

### e2e-15 · Packaged application smoke (small)

The built entry points are now launched for real (`bun run test:e2e:electron`), but the artifact users
install is the electron-builder bundle in `build/mac-arm64/`, and its `files: ['dist/**/*',
'dist-electron/**/*']` list excludes `node_modules` while `main.cjs` and `backend.cjs` externalise
`better-sqlite3`. Nothing asserts that the packaged `.app` still starts, so a missing native module or
an asar layout problem ships green. Add a job that runs `electron-builder` and launches the built
`.app`, asserting the window and one IPC round trip — or, if packaging in CI is too slow, at least
`unzip` the asar and assert `backend.cjs`, `preload.cjs` and `better-sqlite3` are reachable.

---

## Unit tasks

### unit-8 · Driver SQL builders and value mapping (medium)

The drivers are the largest uncovered code in the backend: `useMsAccessDriver.ts` (654 statements,
0.6 %), `useMySqlDriver.ts` (417, 6.5 %), `useSqliteDriver.ts` (368, 10.3 %), `usePostgresDriver.ts`
(297, 11.8 %) and `useMsAccessWindowsDriver.ts` (213, 4.2 %). Extract the parts that decide what
reaches the database — identifier quoting, WHERE/LIMIT/OFFSET building per dialect, INSERT/UPDATE/
DELETE and DDL generation, value coercion (dates, binary, bigint, NULL versus empty string) and error
mapping — into pure helpers and cover them directly, the way the grid menus were extracted. No server
is needed, and this is the code where a wrong string corrupts data.

### unit-9 · MS Access driver and bridge (medium)

`useMsAccessDriver.ts` runs only through the Java bridge, which no spec drives: worker mode versus
direct mode, the JSON protocol frames, the JAR/runtime manifest and download path, the type mapping
for MEMO/OLEOBJECT/CURRENCY/DATETIME, and the `ps-probe` PowerShell lookup in
`useMsAccessWindowsDriver.ts`. Cover the frames, the mapping tables and the manifest/`clientExecutables`
interaction as units, injecting the process boundary for the Java and PowerShell spawns.

### unit-10 · Windows process boundary (small)

`clientExecutables.spec.ts`, `sqlScriptRunner.spec.ts` and `bunSubprocess.spec.ts` are wrapped in
`describe.skipIf(!hasPosixShell)`, so they disappear on Windows — exactly where client discovery,
`MYSQL_PWD`, exit handling and the PowerShell probes differ. Inject the spawn/fs boundary so both the
POSIX and win32 branches run on every platform, and keep one POSIX-only integration test for the real
shell behaviour.

---

## Test infrastructure

- A skipped precondition fails the run (`playwright.config.ts` → `failOnSkipReporter.ts`), so
  `E2E_SKIP_MISSING_DB=1` can no longer produce a green run that proves less.
- Coverage floors are one point below the measured numbers and per-area (`src/backend`, `src/datagrid`,
  `src/shared`, `src/directives`), so a gap cannot hide in the aggregate.
- `bun run test:e2e:electron` builds the shell (`build:shell`) and launches it; the browser suite and
  the shell suite need separate configs because `appConfig` hard-codes the API port they both bind.

---

## Everything else still at 0 %

Components exercised only by the browser suite show 0 % _unit_ coverage and are fine — do not add unit
tests for them; extend the browser spec instead. Genuinely uncovered and not worth a task yet:
`releaseHelpers.ts` (175), `vite-plugin.ts`, `executeCommand.ts`, `electronConfig.ts`,
`handleScripts.ts`, `Splitter*.tsx`, `DataTable.tsx`, `Select.tsx`, `SettingsModal.tsx` (a stub),
`loadingIndicatorState.ts`, `appDirectives.ts`.

The Electron entry points (`src/electron/*`, `mainProloadHelpers.ts`, `useDatabase.ts`) are deliberately
not in that bucket: they ship to users and are tracked by e2e-12 and e2e-15.
