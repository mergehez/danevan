# todos — findings and fix list

Pending work for this repo, in two parts:

1. **Performance audit** (sections "Quick wins", "Tasks T1–T14", "Baseline measurements",
   "Verified clean") — a read-only audit of this app (Electron + Vue 3 + canvas datagrid + TypeORM
   drivers) run on 2026-10-09 against the developer's real data sources.
2. **User-reported issues and ideas (`U1`, `U2`, …)** at the end — filed by the developer while
   using the app. Append new ones there.

**Nothing in the performance audit is implemented yet.** Each entry has a `- [ ]` checkbox, evidence
with `file:line` pointers, a fix sketch, and a way to verify the fix. The `U` entries record their
status inline.

Evidence comes from four parallel read-only audits (backend DB layer, frontend state/data flow,
startup/app-DB/packaging, datagrid/rendering) plus direct measurements on this machine. Numbers
marked _(audit)_ come from a sub-audit and were not re-measured here; numbers marked _(measured)_
were reproduced directly — see "Baseline measurements" for method.

Severity is expressed for the developer's setup: local + 3 remote MySQL servers (portal, gateway,
hetzner), 2 SQLite files, 2 MS Access files, databases up to 30 GB and 163 tables, 28 saved
connections, grid page sizes up to 2000 rows.

## Ground rules for whoever picks a task up

- Checks: `bunx vue-tsc --noEmit`, `bunx vitest run`, `bunx playwright test <spec> --reporter=line`.
- `vp run lint` currently fails on **pre-existing** oxlint TS7026 errors in `src/datagrid/DataGrid.tsx`
  (untouched by this list). Use oxlint on the files you changed plus vue-tsc for a full typecheck.
- Sandbox/e2e quirk: run Playwright with `APP_DATA_DIR="$(pwd)/.e2e-data" bunx playwright test ...`
  and delete `.e2e-data` afterwards. Without it the backend tries to write
  `~/Library/Application Support/danevan` and fails with `SQLITE_READONLY` outside the workspace.
  `bun run dev` kills stale listeners on 3263/3264, so stop other dev servers first.
- Pre-existing e2e failures (also fail on commit `dcbea96`): `sidebar-sticky.spec.ts`,
  `sql-editor-cursor.spec.ts`. Do not chase them as regressions.
- `bun` crashes on `better-sqlite3` (NAPI): inspect the app DB with `node`/`npx tsx`, not bun.
- Local test databases on `127.0.0.1:3306` (root, empty password): `tirsik3_test` (59 tables),
  `eezytool_e2e` (39), `etwp` (163 small tables), `wikiferheng` (23 huge tables, 30 GB).
- Repo rules from `AGENTS.md`: one logical change per commit, imperative subject ≤72 chars;
  never add test timeouts >10 s or blind inline timeouts; every user-facing change needs a browser
  spec under `src/mainview/tests/e2e`.

## Quick wins (small, low risk)

| ID  | Task                                                                                    | Effort | Status |
| --- | --------------------------------------------------------------------------------------- | ------ | ------ |
| T7  | `import type` in `src/electron/main.ts:6` + drop the duplicate `configureDatabase`      | 5 min  | done   |
| T9  | Probe the managed SQLFluff venv before running `pip install`                            | 15 min | done   |
| T13 | One-time cleanup of orphaned `tableInfo:*` settings rows                                | 15 min | done   |
| T3b | Always use catalog estimates for table _lists_ (keep exact counts for the opened table) | 30 min | done   |
| T5  | Debounce the grid search + cache formatted cell text                                    | 1–2 h  | done   |

## Tasks

### T1 — Reuse one connection and one keychain read per backend call — CRITICAL, high confidence

- [ ] Not started

Evidence: `src/backend/useMySqlDriver.ts:1051-1071` (`withMySqlClient`) creates a `DataSource`
(`connectionLimit: 1`), `await dataSource.initialize()`, then `queryRunner.release();
dataSource.destroy()` for **every** request; inside it, `const password = (await
deps.readConnectionPassword(connectionId)) ?? ''` → `src/backend/db-tools.ts:336-343` →
`src/backend/auth.ts:22-37` spawns `security find-generic-password` as a process. Same shape in
`src/backend/usePostgresDriver.ts:676-695` and `src/backend/useSqlServerDriver.ts:396-415`.

Why it matters _(measured)_: `runQuery "SELECT 1"` on the **local** MySQL costs **20.2 ms** with
the app's keep-alive fetch client; a bare keychain lookup is **15.9 ms** per spawn, and TCP connect
to the remote servers used here is **26.8 ms** (hetzner), **23.8 ms** (portal), **18.7 ms**
(gateway) vs **0.3 ms** local. The UI issues 3–7 backend calls per interaction _(measured: 7 to open
a table, 3 to switch)_, so remote work pays ~40–50 ms of pure overhead per call. `Promise.all`
fan-outs (T2) open N simultaneous sessions and N `security` processes.

Fix sketch: keep a per-connection `DataSource` in a session map (a `queryRunner` per request from
the shared pool), invalidate on `updateConnection`/`updateServer`/`deleteServer`/
`disconnectConnection`; cache the password in-process keyed by `serverId`, invalidate on
store/delete password and server update.

Verify: instrument `dataSource.initialize()` count per session (expect ~1 per connection, not 1 per
call) and re-measure `runQuery "SELECT 1"` for local MySQL (target <5 ms) and for one remote server.

### T2 — Replace metadata N+1 fan-outs with one batched call — CRITICAL, high confidence

- [ ] Not started

Evidence (each site issues one request per table, and each request is a full T1 connection):

- `src/backend/app.ts:140-147` `getPeekUsageRelations`: `dbTools.getTables()` then
  `Promise.all(tables.map((t) => dbTools.getTableInfo(connectionId, t.name)))` — used by
  `peekFkUsages`/`peekFkUsageRows`.
- `src/mainview/composables/useComparison.ts:88` `ensureTableDetails(..., force)` for every table,
  with `force` true on every dialog open (`useComparison.ts:122`, set cleared at `:282`) which
  bypasses the `loaded` guard in `src/mainview/composables/useConnections.ts:182`.
- `src/mainview/components/MonacoEditor.tsx:119-122` loads details for every table on first
  autocomplete per editor instance, then flattens all columns (`:131-136`).
- `src/mainview/composables/useConnections.ts:160-170` `ensureConnectionSchema` (non-forced) loads
  details for all tables.
- There is no cross-request metadata cache: `src/backend/db-tools.ts:456` `invalidateAllMetadataCaches`
  is an empty stub and `getTableInfo` (`db-tools.ts:710-718`) always calls `getTableInfoFresh`.

Why it matters _(measured)_: one FK peek on `etwp` (163 tables) = 163 `getTableInfo` calls
(≈650 `information_schema` queries, 163 connections, 163 keychain spawns) in **0.92 s** locally,
with `usages=0`. Over the network this is a connection storm against production servers.

Fix sketch: add one batched backend method, e.g. `getTableInfos({ connectionId, tableNames? })` that
answers from a single catalog query per driver (`information_schema.columns/statistics/
key_column_usage` for MySQL, `pg_catalog` for Postgres, `sys.*` for SQL Server), and for the FK peek
specifically one query over `key_column_usage` + `referential_constraints` for the whole schema; add
a session-level `Map<connectionId, Map<tableName, TableInfo>>` in `db-tools` with explicit
invalidation on `modifyTable`/`dropTable`/`applyTableChanges`/`refreshTableInfo`/
`refreshConnectionSchema`. Point comparison/autocomplete/peek at the batched method.

Verify: count API calls while opening "Compare database…" and while triggering autocomplete on the
`etwp` connection (target: ~1–2 calls, today 1 + N). `src/mainview/composables/useQuery.ts:112`
already logs per-load timings; the backend logs `withTimedAppOperation` per request.

### T3 — Stop counting rows per table on the drivers that still do it — HIGH, high confidence

- [x] T3b done; T3a not started
- **T3b (done)**: MySQL/PostgreSQL/SQL Server table lists now answer from the catalog only
  (`resolveListedRowCount` in `src/backend/useRemoteDriverTools.ts`, used by each driver's
  `getTableNames`), with `rowCountIsEstimated: true` so the sidebar keeps the `~` marker. Exact
  counts are still fetched when a table is opened (`readRowCount` → `resolveRowCount`).
  Verified: MySQL `getTableNames` runs one `information_schema.tables` query and no `COUNT(*)`
  (unit test `src/mainview/tests/backend/tableListRowCounts.spec.ts`); `getTables` for `wikiferheng`
  is 27 ms and every listed row is flagged estimated (`open-table.spec.ts`).

Evidence:

- SQLite: `src/backend/useSqliteDriver.ts:712-719` builds the table list with
  `rowCount: await queryRowCount(queryRunner, name)` per table, and the driver has **no**
  `estimateRowCount`, so `resolveRowCount` (`src/backend/useRemoteDriverTools.ts:46-52`) always takes
  the exact path. `getTableData` also counts per page (`useSqliteDriver.ts:601`).
- MS Access (macOS JVM bridge): `src/backend/msAccessBridgeSource.ts:193` does
  `queryRowCount(connection, tableName)` per table in `listTables`, and again in `getTableInfo`
  (`:323`). Access `COUNT(*)` scans through the ACE engine.
- Windows MS Access: `src/backend/useMsAccessWindowsDriver.ts:471-489` performs 4 separate
  PowerShell invocations (columns, indexes, foreign keys, `COUNT(*)`) per table info.
- Remote SQL drivers: `src/backend/useMySqlDriver.ts` (getTableNames) now uses the catalog estimate
  only above 100 000 rows, so a schema of many small tables still runs one `COUNT(*)` **per table**
  on every table-list refresh.

Why it matters _(measured)_: `getTables` for `etwp` (163 tables) is **62–71 ms** warm with the
keep-alive client, but the first sidebar expand of that connection takes **820 ms** (first-touch I/O
for 163 counts) and repeats in **17 ms** once cached; the list is refetched once per connection per
session and again after every raw SQL run (`src/mainview/composables/useNavState.ts:605-609`).
SQLite fixture (12 tables × 150 k rows, 114 MB): `getTables` **68.5 ms** via curl (includes ~20 ms
per-connection overhead), i.e. dominated by the 12 counts.

Fix sketch: (T3b) always use the catalog estimate for table _lists_ on the remote drivers — mark
those rows `rowCountIsEstimated` (the `~` marker already exists in the sidebar and grid header) and
pay for an exact count only when a table is opened; (T3a) do the same for SQLite by shipping
`rowCount: 0`/estimated in the list and counting when opened, and for the Access bridge by replacing
the per-table `COUNT(*)` with a metadata row count (or omitting it in lists).

Verify: re-measure `getTables` for `etwp` (expect one query, no `COUNT(*)` per table) and the first
expand in the UI (expect ≈ the API time); check `wikiferheng.words2` still shows `~765K` and an
opened table still shows an exact count for small tables.

### T4 — Make the canvas draw viewport-bounded in data work — HIGH (grid jank), high confidence

- [ ] Not started

Evidence _(audit, spot-checked)_:

- `src/datagrid/useDataGridCanvasRuntime.ts:667` calls `isSelectedCell(sourceRowIndex, columnIndex)`
  for every visible cell each frame; `src/datagrid/useDataGridNavigation.ts:263` calls
  `getVisualRowIndexForSourceRowIndex` unconditionally, which is
  `args.sortedRowIndexes.value.indexOf(sourceRowIndex)` (`:35`) — O(total rows) per cell.
- `src/datagrid/useDataGridCanvasRuntime.ts:326` and `:573` call
  `gridState.value.areAllRowsSelected()` every frame; that is
  `sortedRowIndexes.every((row) => selectedRowIndexes.includes(row))`
  (`useDataGridNavigation.ts:273-275`) — O(rows × selected) twice per frame.
- No per-cell memoization: `runtime:109` re-formats every visible cell each frame, `useDataGrid.ts:322-330`
  allocates a fresh cell object, `useDataGrid.ts:39` allocates a key string, and
  `runtime:470` → `ellipsizeText` (`:253-270`) runs `measureText` per cell plus per text run
  (`:489-496`).
- Related per-row scans: `src/mainview/composables/useDbDataGrid.ts:732` (pending deletes) and
  `src/datagrid/useDataGridMenus.ts:469` (`savedCellKeys`).

Why it matters _(audit)_: at 2000 rows with ~35×13 visible cells that is ~0.9 M `indexOf` steps per
frame, and after "Select All" ~2×4 M proxy `includes` steps per frame — frames of 100+ ms, i.e. the
grid freezes while scrolling.

Fix sketch: keep selected rows in a `Set`, build a `Map<rowIndex, visualRowIndex>` once per draw
pass, early-return from `isSelectedCell` when no range/column selection exists, keep an O(1)
all-selected flag, and memoize formatted text per `(rowIndex, columnName, renderVersion)` plus a
`measureText` cache keyed by text+font; resolve each cell once in `drawBody` and pass it down.

Verify: count `measureText`/`getFormattedCellValue` calls per frame (~455 today, target ~0 warm) and
record a Performance trace while scrolling a 2000-row page with Select All applied.

### T5 — Grid search must not reformat the whole result set per keystroke — HIGH, high confidence

- [x] Fixed — the input still updates `searchQuery` per keystroke, but matching runs against a
  200 ms debounced `committedSearchQuery` (`DATA_GRID_SEARCH_DEBOUNCE_MS`) over a per-page index of
  lowercase cell texts (`searchIndex`), so a keystroke is a row-wide `includes` plus a cell scan on
  candidate rows. Clearing is immediate. Verified by "formats each cell once for a search instead of
  on every keystroke" (9 format calls once, unchanged across keystrokes) and
  `src/mainview/tests/e2e/grid-search.spec.ts`.

Evidence: `src/datagrid/DataGrid.tsx:110` → `src/datagrid/useDataGridNavigation.ts:569-571` sets
`searchQuery` and synchronously forces `args.searchMatches.value` (no debounce exists anywhere in
`src/datagrid`); `src/datagrid/useDataGrid.ts:457-465` loops every row × every column calling
`getFormattedCellValue(rowIndex, columnName).toLocaleLowerCase()`.

Why it matters _(audit)_: 2000 × 50 = ~100 k formatted cells and 100–300 ms of blocking main-thread
work per typed character; keystrokes stop echoing on large pages.

Fix sketch: debounce the query 150–250 ms, do not force `searchMatches` synchronously, and build one
lowercase haystack string per row when the page loads so a query is `String.includes` over rows.

Verify: Performance trace while typing five characters into search on a 2000 × 50 page (5 long tasks
today, 0 afterwards); count `formatValue` calls per keystroke.

### T6 — Keep the SQL-editor stack out of the boot chunk — HIGH, high confidence

- [x] Fixed — the parsers, grammars, snippet lists and completion provider moved to
  `src/mainview/lib/monacoSqlLanguages.ts`; `monaco.ts` no longer imports any of them and
  `configureMonaco` (now async, idempotent) loads that module dynamically. `MonacoEditor` awaits it
  before creating its model. The parser-based `getSqlDiagnosticMarkers` was dead code and is gone.
  Measured with `vite build`: entry chunk **7,027.58 kB → 567.74 kB**, and the entry no longer
  contains `MySqlParser`/`PostgreSqlParser`/`monaco-aria-container` (the parsers live in the
  3,794.87 kB `monacoSqlLanguages-*.js` chunk). Guarded by `src/mainview/lib/monacoBootChunk.spec.ts`.

Evidence _(measured sizes, audit analysis)_: the entry chunk is `dist/assets/index-*.js`
**7,024 kB**; `src/mainview/lib/monaco.ts:2-11` statically imports `dt-sql-parser` deep parsers and
`monaco-sql-languages`, and `:51-52` constructs `new MySQL()` / `new PostgreSQL()` at module scope;
that module is reached eagerly through `src/mainview/App.tsx:8` → `src/mainview/components/DbData.tsx:21`
→ `src/mainview/components/MonacoEditor.tsx:18`. Monaco core is hoisted into the entry chunk because
`monaco-sql-languages` statically imports `monaco-editor`, so the `import('monaco-editor')` at
`lib/monaco.ts:651` does not defer it. Parser sources are 3.45 MB (MySQL) and 3.83 MB (PostgreSQL).

Why it matters _(audit)_: ~250 ms of module evaluation plus 6.7 MB parse/disk before first paint, for
users who only browse table data and never open a script tab.

Fix sketch: move the parser instances, language registration and snippets behind the existing dynamic
import/`defineAsyncComponent` path so `MonacoEditor` pulls them only when mounted; keep
`lib/monaco.ts` import-free at module scope.

Verify: rebuild and check the entry chunk no longer contains `monaco-aria-container`/`MySqlParser`
and drops well under 1 MB; compare first-paint time.

### T7 — Remove the duplicate backend from the Electron main bundle — HIGH, high confidence (quick win)

- [x] Fixed — `import type { app as backendApp }` and the redundant
  `useAppDb().configureDatabase(userDataDir)` (plus its `DANEVAN_DATA_DIR` resolver) are gone.
  Verified by building the target with rolldown: `main.cjs` is **11,859 B** (was 2,587,107 B), holds
  only the `package.json` mention of typeorm/mysql2 and no `configureDatabase` call; the single
  execution now lives in `backend.cjs`. Guarded by
  `src/mainview/tests/backend/electronMainEntry.spec.ts`.

Evidence _(measured)_: `src/electron/main.ts:6` `import { app as backendApp } from '../backend/app.ts';`
is used only in a type position at `:30`; because it is not `import type`, the bundle keeps it —
`dist-electron/main.cjs` is **2,587,107 B** and contains typeorm ×351, mysql2 ×4, pg-pool ×2 (the live
copy is `dist-electron/backend.cjs`, 3,615,945 B, loaded at
`src/electronUtils/mainProloadHelpers.ts:138-145`). `src/electron/main.ts:144` then configures the app
DB in that dead copy while `src/backend/devServer.ts:18` → `src/electronUtils/browserOnlyHelpers.ts:10`
configures it again for the live copy, so the DDL, migrations and all three sequence normalisers run
twice (two SQLite connections).

Why it matters _(audit)_: ~157 ms of duplicated driver module init + ~21 ms extra parse + 2.5 MB in
the app bundle on every launch, before the window is created.

Fix sketch: `import type { app as backendApp } from '../backend/app.ts';` and drop the redundant
`useAppDb().configureDatabase(userDataDir)` in `main.ts` (the backend configures the DB itself).

Verify: `main.cjs` drops to well under 100 kB; count `configureDatabase` executions per launch
(expect 1); measure cold start to window.

### T8 — MS Access: do not materialise whole tables, and batch metadata — HIGH for Access sources

- [ ] Not started

Evidence: Windows driver `src/backend/useMsAccessWindowsDriver.ts:626-657`: `topClause` is only used
when `offset === 0`, and `$adapter.Fill($dt)` fills a `DataTable` from `SELECT * FROM ...` with no
`TOP`, paging afterwards with `Select-Object -Skip`; `src/backend/useMsAccessWindowsDriver.ts:471-489`
spawns four PowerShell processes per table info (`:83-168` writes a `.ps1`, spawns `powershell.exe`,
reads a result file, deletes it). macOS JVM bridge: `src/backend/msAccessBridgeSource.ts:193` counts
every table when listing, `:323` again per table info (the worker itself is persistent, no per-request
spawn).

Why it matters: page 2 of a large `.accdb`/`.mdb` on Windows reads the entire table into the
PowerShell process (memory blow-up); peek usages over a 23-table Access DB costs 92 process spawns.
The developer has two `.mdb` sources (macOS bridge) and uses them.

Fix sketch: never `Fill`-then-slice — push paging into the query (keyset paging by primary key with
`TOP`), batch the four metadata calls into one PowerShell invocation, and reuse a single long-lived
PowerShell host; for the JVM bridge replace the per-table `COUNT(*)` with a metadata estimate.

Verify: count PowerShell spawns and measure elapsed + peak memory for page 2 of a large table
(the bridge already logs `[perf][msaccess] bridge.*`).

### T9 — SQLFluff: probe the managed runtime instead of always running pip — MEDIUM (quick win)

- [x] Fixed — `ensureManagedSqlFluffRuntime` probes `<pythonPath> -m sqlfluff --version` after the
  venv exists and reuses the runtime when it answers, so a provisioned runtime never reaches pip
  (`src/backend/sqlDiagnostics.ts`). Verified by
  `src/mainview/tests/backend/sqlDiagnostics.spec.ts` (no `pip` call on the reuse path, one on the
  broken-runtime path, one probe per process); the developer's managed runtime answers in **0.348 s**
  with sqlfluff 4.1.0.

Evidence: `src/backend/sqlDiagnostics.ts:172-175` runs
`python -m pip install --disable-pip-version-check sqlfluff` whenever the managed path is taken; the
`existsSync(pythonPath)` branch (`:143`) only skips venv creation. Resolution is memoised in-process
(`:189-218`) but the memo is cleared on any error (`:213-216`), so a failing runtime retries pip on
every diagnostics request. `:235-256` spawns a fresh `python -m sqlfluff lint` per call.

Why it matters _(measured + audit)_: the developer's managed runtime already works — a read-only
`.../sqlfluff-runtime/bin/python3 -m sqlfluff --version` returns 4.1.0 in **0.36 s** — yet each
session's first diagnostics/format pays a pip resolution (audit: 325 ms floor even with `--no-index`
and everything installed; the real call contacts PyPI). Each lint is 509–618 ms _(audit)_, triggered
350 ms after typing pauses (`src/mainview/components/MonacoEditor.tsx:207-251`).

Fix sketch: before installing, run `<pythonPath> -m sqlfluff --version` and reuse the runtime when it
answers; persist a version marker next to the venv; do not clear the memo on transient lint errors.

Verify: time the first `getSqlDiagnostics` per launch (expect ~0.4 s, no pip process) and count `pip`
processes spawned while typing.

### T10 — Stop persisting everything on every keystroke and pointer move — MEDIUM, high confidence

- [~] Partly fixed — the grid layout is no longer written on every pointermove: `setColumnWidth`
  updates the reactive layout and persists through a 200 ms trailing timer
  (`DATA_GRID_LAYOUT_SAVE_DEBOUNCE_MS`, `applyLayoutUpdate({ deferSave: true })`), flushed
  immediately on unmount or a storage-key change; every other layout change still writes at once.
  Covered by "writes the grid layout once at the end of a column resize". The settings blob
  (drafts) and the modify-table JSON snapshot are unchanged.

Evidence: typing path `src/mainview/composables/useNavState.ts:97-107` (150 ms debounce) →
`replaceTab`/`setTabs` → `src/mainview/composables/useSettings.ts:16-34` (cache key `settings`,
including every tab's `draftSql`) → `src/shared/utils/useCache.ts:63-75`
`watch(state, (v) => storage.setItem(key, JSON.stringify(v)), { deep: true })`. Column resize:
`src/datagrid/useDataGridCanvasPointerHandlers.ts:404` (per pointermove) →
`src/datagrid/useDataGrid.ts:162-165` `applyLayoutUpdate` → `saveLayout()` →
`src/datagrid/dataGridLayoutStorage.ts:44` `setItem(JSON.stringify(layout))`. Modify-table:
`src/mainview/composables/useModifyTable.ts:3357-3394` deep watcher with two `JSON.stringify` compares
plus a `JSON.parse(JSON.stringify(...))` clone (`:2126-2128`).

Why it matters: typing and dragging block the main thread on synchronous storage writes whose size
grows with the total draft SQL / open tabs / table definition size.

Fix sketch: keep drafts out of the persisted settings blob (separate, longer debounce, or write on
blur/tab close); write the grid layout on pointerup or a 200 ms trailing timer; replace the
modify-table JSON snapshot/compare with a revision counter.

Verify: count `localStorage.setItem` calls while typing a long script and while dragging a column
border (target: 0 during typing, ≤1 per drag); Performance trace of the modify-table modal.

### T11 — Stop shipping the full bootstrap on every tab click — MEDIUM, high confidence

- [ ] Not started

Evidence: `src/backend/app.ts:475-514` builds the bootstrap from `appDb.listScripts()`
(`src/backend/db-app.ts:429` selects `sql_text`), and **20** handlers `return buildBootstrap()`
(including `selectScript`, `selectConnection`, `createScript`, `updateScript`).
`src/mainview/composables/useNavState.ts:502-506` calls `scripts.selectScript(undefined)`
unconditionally on every table-tab activation, and `:554` for scratch tabs; after each bootstrap
`useNavState.ts:659-663` rebuilds a string containing every script's SQL text. Per table activation
the app also fetches `getGridFormatterState` (`useNavState.ts:519`) and `loadFormatters` on mount
(`src/mainview/composables/useDbDataGrid.ts:171`).

Why it matters _(measured)_: opening a table costs **7 API calls** (getTables, getGridCustomFormatters,
selectConnection, selectScript, getTableInfo, getTableData, getGridFormatterState) and switching
tables costs 3; with 300 saved scripts a bootstrap response is **344,244 B** (1.7 ms server-side, but
it is JSON-stringified, sent over HTTP/IPC and cloned each time). With the developer's 4 scripts the
payload is ~11 KB, so today this is mostly the extra round trips, not the bytes.

Fix sketch: guard `selectScript(undefined)` on `selectedScriptId !== undefined`; return only script
metadata plus the selected script's `sql_text`; memoise the scripts-derived string on ids; load
formatters once per connection.

Verify: wrap the renderer request proxy with a counter — a table-tab click should be ~2–3 calls
instead of 7; log response bytes of `selectScript` with N scripts.

### T12 — Prune the packaged app — MEDIUM (quick win, packaging only)

- [ ] Not started

Evidence _(measured sizes, audit breakdown)_: `.app` **525 MB**, dmg **176 MB**
(`build/mac-arm64/Danevan.app`, `build/danevan-0.1.0-macos-arm64.dmg`). The asar holds ~190 MB of
`node_modules` that is already bundled into `dist/`/`dist-electron/` (`monaco-editor` 92.6 MB,
`@azure` 23.3 MB, `typeorm` 17.9 MB, `dt-sql-parser` 15.0 MB, `@js-joda` 7.3 MB, `@vue` 6.4 MB,
`@babel` 3.8 MB, `tedious` 2.6 MB), plus unused monaco workers (`ts.worker` 6.6 MB, `css.worker`
1.0 MB, `html.worker` 740 kB, `json.worker` 420 kB) and an `extraResources` payload of 12 MB
(including `assets/test-access-db.mdb`, 10 MB). `src/electronUtils/electronConfig.ts:8-23` excludes
only `node_modules/electron`.

Fix sketch: add `node_modules` excludes for the bundled-only packages, drop the unused workers from
`dist/assets`, and remove the sample `.mdb`/iconset from `extraResources`.

Verify: re-dump asar top-level sizes and the dmg size (target <60 MB).

### T13 — Clean the orphaned app-DB settings — LOW (quick win)

- [x] Fixed — `cleanupLegacySettings` (`src/backend/appDbMaintenance.ts`) runs at the end of
  `configureDatabase`: it deletes the `tableInfo:%` rows, `VACUUM`s and truncates the WAL once, and
  warns about any remaining settings key this build does not read. Measured on a copy of the live
  app DB (1,514 rows / 1,823,764 B before): **356 rows / 1,122 B after**, file **4,399,104 B →
  69,632 B**, with all 8 servers, 28 connections and 4 scripts intact. Covered by
  `src/mainview/tests/backend/appDbMaintenance.spec.ts`.

Evidence _(measured on the live app DB)_: 1,512 settings rows totalling 1.83 MB, of which **1,158
rows / ≈1.82 MB are `tableInfo:*` keys that no code reads or writes** (a cache removed from an
older build); the DB file is 4.4 MB with 473 free pages. `src/mainview/composables/useDbCaches.ts`
persists schema caches to localStorage instead; the renderer's whole Local Storage is 240 KB, so the
localStorage quota risk is not acute today.

Fix sketch: a one-time migration in `configureDatabase` (or a startup task) that deletes
`tableInfo:%` rows and `VACUUM`s, plus a guard so unknown settings prefixes are reported rather than
kept forever.

Verify: `SELECT COUNT(*), SUM(LENGTH(value)) FROM settings` before/after, and the file size.

### T14 — Sidebar: cache collapse state, and window very large schemas — LOW–MEDIUM

- [~] Partly fixed — `getPersistedTreeState` keeps one parsed object per server and re-parses only
  when the stored string changed (still reading `collapseStateVersion` so callers stay reactive), and
  `TreeServer` now shares that cache instead of re-implementing it. Virtualization, the lazy tooltip
  DOM and the watcher-source change are not done: keying that watcher on the table count instead of
  the names stopped expanded table details from loading (the sidebar went from seconds to minutes in
  `connections.spec.ts`), so it was reverted. Covered by
  `src/mainview/tests/composables/useDbCaches.spec.ts` (50 row reads → 1 `JSON.parse`).

Evidence: `src/mainview/composables/useDbCaches.ts:90-103` reads and `JSON.parse`s the persisted
tree state on **every** accessor call, reached per row from `src/mainview/components/TreeTableRow.tsx:333`,
`src/mainview/components/TreeCollection.tsx:31`, `src/mainview/components/TreeServer.tsx:478`, and
`setPersistedTreeState` bumps `collapseStateVersion` (`:105-108`) so one toggle invalidates every row.
No virtualization exists anywhere in `src/` (`src/mainview/components/FileTreeButton.tsx:219`
recursively maps all children; `src/shared/components/ListBox.tsx:479` maps all items).
Tooltips add three detached DOM nodes plus a document-level click listener in
`mounted` (`src/directives/VTooltip.ts:183`, `:218`).

Why it matters _(measured)_: rendering 163 sidebar table rows takes **5 ms** and the persisted state
is small, so today this is minor; it becomes real with thousands of tables or a large persisted tree.

Fix sketch: keep one parsed, reactive collapse object per server in memory (re-parse only on external
change), make the watcher source use ids/flags instead of joining every table name, window the
flattened tree with fixed row height, and create tooltip DOM lazily on first hover.

Verify: count `JSON.parse` calls per sidebar toggle (target ~1) and measure expand → first paint plus
`document.querySelectorAll('[data-sidebar-row]').length` with a ~2000-table schema.

## Baseline measurements (before state, for verification)

Method notes: "keep-alive" numbers come from a Node script using the global `fetch` (undici, what
`src/electronUtils/helpers.ts` uses), so they exclude TCP setup; "curl" numbers start a new
connection per request and therefore include ~20–25 ms of connection setup — do not compare the two
directly. All timings from one machine (macOS arm64, local MySQL 8.1.0).

| Measurement                                                             | Value                                                  | Method                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `runQuery "SELECT 1"`, local MySQL                                      | 20.2 ms                                                | keep-alive fetch, 7 runs               |
| `getTableInfo`, local MySQL (5 queries)                                 | 33.8 ms                                                | keep-alive fetch                       |
| `getBootstrap` (300 scripts, 344 KB)                                    | 1.7 ms                                                 | keep-alive fetch                       |
| no-op handler / `getEditorSettings`                                     | 0.8 / 0.5 ms                                           | keep-alive fetch (HTTP/IPC floor)      |
| keychain lookup (spawn `security`)                                      | 15.9 ms                                                | Node `execFile`, 6 runs                |
| TCP connect hetzner / portal / gateway / local                          | 26.8 / 23.8 / 18.7 / 0.3 ms                            | Node `net.connect`, 4 runs each        |
| `getTables` etwp (163 tables)                                           | 62–71 ms warm, 820 ms first UI expand, 17 ms re-expand | keep-alive fetch + Playwright          |
| `peekFkUsages` etwp (163 tables)                                        | 0.92 s                                                 | keep-alive fetch                       |
| API calls to open / switch one table                                    | 7 / 3                                                  | Playwright request counting            |
| SQLite fixture 12 × 150 k rows: getTables / getTableInfo / getTableData | 68.5 / 33.0 / 31.2 ms                                  | curl (includes ~20 ms connect)         |
| Renderer entry chunk / main.cjs / backend.cjs                           | 7,024 kB / 2,587,107 B / 3,615,945 B                   | `dist/`, `dist-electron/`              |
| `.app` / dmg                                                            | 525 MB / 176 MB                                        | `du -sh build/mac-arm64/*`             |
| Live app DB settings                                                    | 1,512 rows / 1.83 MB (1,158 `tableInfo:*` = 1.78 MB)   | better-sqlite3 read-only               |
| Managed SQLFluff runtime probe                                          | 0.36 s (sqlfluff 4.1.0)                                | direct `python3 -m sqlfluff --version` |

## Verified clean — do not re-investigate

- No `setInterval` polling in `src/mainview`, `src/shared`, `src/datagrid`; only debounce/timeout timers.
- Paging is exactly one `getTableData` call; table info comes from the `loaded` guard
  (`src/mainview/composables/useConnections.ts:182`) and tab activation is coalesced
  (`src/mainview/composables/useNavState.ts:576-628`) — no duplicate load per click.
- Canvas geometry (column widths/offsets, row range) is memoized and hit-tested with binary search;
  draw scheduling uses a single-rAF guard and the backing store is resized only on size change
  (`src/datagrid/useDataGridCanvasRuntime.ts:198-207`, `:234-237`).
- Listeners, observers, rAF and timers are cleaned up on unmount (`src/datagrid/useDataGridView.ts:634-643`,
  `src/directives/VTooltip.ts:227-251`, `src/directives/VContextMenu.ts:180-197`).
- Row-count estimates are correct for MySQL/PostgreSQL/SQL Server (`src/backend/useRemoteDriverTools.ts:46-52`
  plus each driver's `estimateRowCount`), and `wikiferheng.words2` reports `~765K` instead of scanning.
- App-DB startup normalisation is O(rows) with a statement per row, but measured at 0.4/0.2/0.1 ms for
  8 servers / 28 connections / 4 scripts — only material in the thousands of rows (and currently
  doubled by T7).
- `mysql` client detection is memoised (`src/backend/sqlScriptRunner.ts:50-62`); only
  `findMysqldumpPath` (`src/backend/app.ts:258`) probes per export-modal open (~4.8 ms, low impact).
- SQL history is bounded at 100 and not persisted; FK relation grouping runs per context-menu open,
  not per cell; `toIpcCloneable` walks request params only (no large payloads).

## User-reported issues and ideas

Filed by the developer while using the app. Append new entries here as `U<n>`, each with a checkbox,
what happens, the repro, `file:line` evidence, a fix sketch and a verification step.

### U1 — In-cell editor: arrow keys move the grid cell instead of the text cursor — bug

- [x] Fixed — the editor's own keydown handler now stops the arrows (without cancelling them) and
  handles `Enter` (commit + move down), `Escape` (cancel) and `Tab` (commit sideways);
  `src/datagrid/useDataGridView.ts` `handleEditingKeydown`, `src/datagrid/useDataGridNavigation.ts`
  `commitEditingCellAndMoveDown`. Covered by `src/mainview/tests/e2e/cell-editor.spec.ts` and the
  unit test "keeps arrow keys and Enter in the inline cell editor".
- **Repro**: double-click a cell in the data grid to edit it, then press `ArrowRight` (same for
  `ArrowUp`/`ArrowDown`): the active cell jumps to the neighbouring cell instead of moving the caret
  inside the editor. `ArrowLeft` is broken the other way — the caret cannot move left at all.
- **Evidence**: the in-cell editor is a `<textarea>` (`src/datagrid/DataGrid.tsx:200-216`) whose keydown
  handler only swallows the left arrow — `src/datagrid/DataGrid.tsx:213`
  `onKeydown={preventedKeys(() => {}, ['left'])}` — and `preventedKeys` calls `preventDefault()` +
  `stopPropagation()` only for matched keys (`src/shared/utils/tsxHelpers.tsx:244-258`). Every other
  arrow bubbles up to the viewport handler (`src/datagrid/DataGrid.tsx:167` →
  `src/datagrid/useDataGridCanvasPointerHandlers.ts:292-303` → `src/datagrid/useDataGridMenus.ts:115-133`
  → `tryNavigate`, which `preventDefault()`s and moves the active cell:
  `src/shared/utils/useKeyboardNavigation.ts:150-190`).
- **Fix sketch**: while the in-cell `textarea` has focus the grid must not navigate. Either stop
  propagation for all navigation keys in the editor's own `onKeydown` (keep `Enter` = commit,
  `Escape` = cancel, `Tab` = commit and move right), or make `handleViewportKeydown`/`handleGridKeydown`
  bail out when the event target is the editor (`(event.target as HTMLElement).closest('[data-editor-key]')`)
  instead of the current single `'left'` special case.
- **Verify**: browser spec — open a table, double-click a multi-word text cell, press `ArrowRight` and
  `ArrowLeft` and assert `selectionStart` changed while the active cell stayed put; then `Enter`
  commits and moves down.

### U2 — Closing the cell editor without typing marks the cell as changed — bug

- [x] Fixed — `startEditingCell`/`openModalEditingCell` snapshot the formatted draft
  (`initialDraftValue`) and both commit paths skip `applyCellChange` entirely when the draft is
  unchanged, before parsing. Menu-picked values clear the snapshot so they still count as edits.
  Covered by the unit tests "does not stage a change when the inline editor is closed without
  typing" (binary + numeric + JSON text) and `src/mainview/tests/e2e/cell-editor.spec.ts`.
- **Repro (as reported)**: `hetzner (server) → peyvdank_test (db) → games (table) → board (column)`.
  Double-click the cell (large text), click somewhere else to close the editor: the save bar appears
  as if a change was made, although nothing was typed.
- **Evidence / path**: the in-cell editor commits on blur — `src/datagrid/DataGrid.tsx:212`
  `onBlur={() => props.state.commitEditingCell()}` → `commitEditingCell`
  (`src/datagrid/useDataGridNavigation.ts:395-420`) parses the draft via `parseEditingValue` and calls
  `applyCellChange` (`src/datagrid/useDataGrid.ts:530-556`), which returns early only when
  `gridValuesEqual(previousValue, nextValue)`. A false "changed" means the
  format → edit → parse round-trip is not identity for that value. Check, in order:
    1. `src/datagrid/useDataGridCoreUtils.ts:9-25` `formatDefaultEditingValue`: for any **object** it
       returns `JSON.stringify(value)` (a `Buffer`/`Uint8Array` becomes `{"0":137,…}`) and returns `''`
       for other non-primitives; `gridValuesEqual` special-cases `Uint8Array` only (`:27-33`), so those
       round-trips are lossy. Check whether `board` (or a binary sibling) hits this.
    2. `src/mainview/composables/useDbDataGrid.ts:493-518` `parseEditingValue` coerces by the original
       value's type (`number` → `Number(draft)`, `bigint` → `BigInt(draft)`) and returns the **original**
       value when the draft is not a finite number — so a no-op edit of a huge integer, of `1e21`-style
       floats, of `NaN`/`Infinity`, or of any numeric cell whose draft does not re-parse to the exact
       same value marks the cell dirty.
    3. Double-click ordering can commit a stale draft: `handleBodyDoubleClick`
       (`src/datagrid/useDataGridCanvasPointerHandlers.ts:63-79`) starts editing on the second click,
       while the first click already focused the viewport and set the active cell;
       `startEditingCell` (`src/datagrid/useDataGridNavigation.ts:285-316`) refocuses the textarea in
       `nextTick`. Check whether a blur commits between the two clicks, or whether `draftValue` is
       replaced after `previousValue` was captured.
    4. The modal editor shares the same format/parse pair: `startModalEditingCell`
       (`useDataGridNavigation.ts:355-370`) and `commitModalEditingCell` (`:375-393`) — if large values
       are routed to the modal, reproduce there too.
- **Fix sketch**: capture the raw value once when editing starts and compare the parsed draft against
  that raw value, never against a formatted/coerced one; keep object/binary values intact (or make
  those cells non-editable inline) instead of `JSON.stringify`; and skip `applyCellChange` entirely
  when the draft string is unchanged, before parsing.
- **Verify**: reproduce the exact path above; then a unit test in
  `src/mainview/tests/dataGrid/DataGrid.spec.ts` — open the editor, commit without typing, assert
  `pendingChangeCount === 0` / `hasPendingGridChanges === false`. Cover a `longtext`/JSON cell, a
  binary column and a numeric column.

### U3 — "Text wrap" in the "Edit cell value" dialog is not remembered — bug

- [x] Fixed — the open-time reset watcher is gone and the flag is a global preference persisted with
  `useCache` in `src/datagrid/dataGridModalPreferences.ts` (detached scope so its watcher survives
  grid unmounts). Covered by `src/mainview/tests/e2e/cell-editor-modal.spec.ts` (reopen and reload)
  and the unit test "remembers the modal editor text wrap preference across dialogs".
- **Repro**: open "Edit cell value", toggle **Text wrap**, close the dialog, reopen it — wrap is off
  again (and it is off after every app restart).
- **Evidence**: the toggle flips `_state.isModalEditTextWrap`
  (`src/datagrid/useDataGridView.ts:246` and `:524-526`) and a watcher resets it to `false` **every time
  the dialog opens** (`src/datagrid/useDataGridView.ts:625-632`); nothing persists it. The dialog markup
  is `src/datagrid/DataGrid.tsx:58-88` (button + `wrap={vs.isModalEditTextWrap ? 'soft' : 'off'}`).
- **Fix sketch**: drop the reset and persist the flag as a global UI preference — the repo convention
  for persisted UI state is `useCache` (`src/shared/utils/useCache.ts`); the per-table
  `src/datagrid/dataGridLayoutStorage.ts` is the wrong scope for it.
- **Verify**: browser spec — toggle wrap, close and reopen the dialog (and reload), assert the button
  state and the textarea's `wrap` attribute are preserved.

### U4 — JSON "Prettify" / "Compact" buttons in the "Edit cell value" dialog — feature

- [x] Implemented — `openModalEditingCell` decides JSON-ness once (`isJsonObjectText`); the dialog
  header shows `Prettify`/`Compact` only then. Both re-serialise the draft through
  `setModalEditingValue` and no-op on invalid JSON, and `Save` is unaffected. Covered by
  `src/mainview/tests/e2e/cell-editor-modal.spec.ts` and the unit test "offers JSON prettify and
  compact only for a value that is a JSON object".
- **Request**: when the dialog opens, check **once** whether the value is JSON (trimmed text starts
  with `{` and ends with `}`); if yes, show `Prettify` and `Compact` buttons. Explicitly not a
  watcher/computed on the draft: evaluate it imperatively at open time so typing does not re-evaluate
  JSON-ness.
- **Where**: the dialog header next to the Text wrap button (`src/datagrid/DataGrid.tsx:69-74`); the
  open-time check belongs with the modal editing state in `startModalEditingCell`
  (`src/datagrid/useDataGridNavigation.ts:355-370`, mirroring where the wrap flag lives in
  `useDataGridView`); both actions write the draft through `setModalEditingValue`
  (`src/datagrid/useDataGridNavigation.ts:326-328`).
- **Behaviour**: `Prettify` → `JSON.stringify(JSON.parse(text), null, 2)`, `Compact` →
  `JSON.stringify(JSON.parse(text))`. Show the buttons only when the open-time text parses as JSON
  (`{not json}` therefore shows nothing, or a disabled pair — decide in the PR and keep `Save` working
  either way). The draft stays freely editable afterwards; the in-cell editor is unchanged.
- **Verify**: browser spec — open the dialog on `{"a":1,"b":[2,3]}`: both buttons visible, `Prettify`
  indents, `Compact` collapses to one line; open on `hello` and on `{not json}`: no buttons; `Save`
  still commits the (possibly prettified) value.
