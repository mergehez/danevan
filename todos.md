# todos — findings, fix list and test audit

**Status:** 35 fix-list entries closed (T1, T2a, T3b, T4, T5, T6, T7, T9, T10, T13, T14, U1–U11, then the
2026-10-11 audit: T16, T17, T18, T20, T21, T22, T23, T24, T26, T30, then T33–T35) · 8 open (T15, T19, T25,
T27–T29, T31, T32) · 3 blocked (T2b, e2e-13, unit-10) · 6 deliberately not planned (T3a, T8, the T10
settings blob, T11, T12, T14's tree work) · suite: **1063 unit tests (87 files) · 132 browser tests
(40 files) · 13 Electron shell tests** (dev build ×12 + the packaged `.app`) · coverage over every source
file **46.5 % statements / 38.6 % branches**, and unit-only: the browser suite is not instrumented (T19) ·
aggregate and per-area floors enforced in `vitest.config.js` · a run that skips a precondition fails · the
audit also measured the gate itself: neither Electron suite can fail it (T15), a complete browser run
could not be reproduced in the session that closed T18 (T31), and one unit spec sits close enough to the
10 s limit to time out under load (T32).

This file is the single source for the project's tasks and for what the tests already prove. It merges
the 2026-10-09 performance/fix list and the test audit, which used to live in two files; both long
surveys are recoverable from git — `git show a14a25d:todos.md` and `git show a14a25d:TESTS-AUDIT.md`
(that commit is the last one that still held the two files apart).

`## Done` is what is already implemented and verified, or work a green run already proves — do not redo
it. `## Open` is what is left. `## Open (blocked)` is what needs a machine this one is not.
`## Not planned` records what was investigated and deliberately closed. Nothing is open and unblocked:
the last one, T2, shipped as T2a for MySQL and SQLite, and what remains waits on a machine this one is
not (`## Open (blocked)`).

## Ground rules for whoever picks a task up

- Checks: `bunx vue-tsc --noEmit`, `bunx vitest run`, `bunx playwright test <spec> --reporter=line`.
- `vp run lint` reports **pre-existing** oxlint TS7026 errors in `src/datagrid/DataGrid.tsx` (untouched
  by this list); `vue-tsc --noEmit` is clean. Use oxlint on the files you changed plus vue-tsc for a
  full typecheck.
- Sandbox/e2e quirk: `playwright.config.ts` picks `APP_DATA_DIR=.e2e-data` itself and deletes only the
  app DB (`danevan.sqlite*`) before the run. **Omit the variable** so each run starts clean; setting it
  yourself (`APP_DATA_DIR="$(pwd)/.e2e-data"`) skips that reset and lets stale sources accumulate, which
  shows up as `unable to open database file` from long-dead `file:` sources. Do **not** `rm -rf
  .e2e-data` — it also holds the provisioned SQLFluff and MS Access runtimes.
  `bun run dev` kills stale listeners on 3263/3264, so stop other dev servers first.
- A full `bun run test:e2e` is green on a provisioned machine (verified at commit `6139b00`). The two
  specs this list used to flag as pre-existing failures now pass: `sql-editor-cursor.spec.ts` in the
  full run, and `sidebar-sticky.spec.ts` when it is run alone — it failed in a full run whose earlier
  specs had left extra sidebar sources behind, so re-run it in isolation before blaming a change.
  The 2026-10-11 audit found the full run red here on that order dependence rather than on the fixtures
  (T18), and on the same class of it in `failure-modes.spec.ts` (T17).
- `bun` crashes on `better-sqlite3` (NAPI): inspect the app DB with `node`/`npx tsx`, not bun.
- Local test databases on `127.0.0.1:3306` (root, empty password): `tirsik3_test` (59 tables),
  `eezytool_e2e` (39), `etwp` (163 small tables), `wikiferheng` (23 huge tables, 30 GB).
- Repo rules from `AGENTS.md`: one logical change per commit, imperative subject ≤72 chars; never add
  test timeouts >10 s or blind inline timeouts; every user-facing change needs a browser spec under
  `src/mainview/tests/e2e`.
- New entries are appended as `T<n>` (audit finding) or `U<n>` (user-reported) under `## Open` with a
  repro, `file:line` evidence, a fix sketch and a verification step; an entry moves to `## Done` only
  with the spec that catches it.

### Writing and verifying a test

**Browser** — one spec per user-facing feature, however small:

- New file: `src/mainview/tests/e2e/<feature>.spec.ts`.
- Setup comes from `src/mainview/tests/e2e/helpers.ts`:
  `createFileSource(request, { label, schema })` (a temp SQLite file + source; `schema` seeds tables),
  `createMySqlServerAndConnection(request, MYSQL.database, label)`, `post(request, method, data)`
  (throws with the endpoint and body on failure), `requireMySqlDatabase(db, 'spec file')`,
  `requireMySqlExecutable`, `requireSqlFluffRuntime('spec file')`, `requireFixtureData(value, message)`,
  `MYSQL`, `API`, plus the sidebar navigation helpers (`reloadSidebarRow`, `expandSidebarRow`,
  `openSidebarRowMenu`, `openSidebarTable`) —
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
`mainProloadHelpers.ts`, `useDatabase.ts`) are not in that bucket — they ship to users and the Electron
shell specs in `## Done` exercise them end-to-end.

### Baseline measurements (the before state, for verifying a fix)

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

### Verified clean — do not re-investigate

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

## Done

### Fix list (T1–T14, U1–U6)

- **T1 — one connection and one keychain read per backend call.** `remoteDataSourcePool` keeps one
  `DataSource` per target and hands each request its own query runner; keychain secrets are cached in
  `auth.ts` and dropped on store/delete; `updateServer`/`updateConnection`/`deleteServer`/
  `hideConnection`/`disconnectConnection` dispose the stale pool entries. Measured on local MySQL:
  `runQuery "SELECT 1"` **17.7 ms → 0.3 ms** median and the keychain read **17.2 ms → 0 ms**. Before,
  every request created a `DataSource` (`connectionLimit: 1`), initialised, queried, released and
  destroyed it and spawned `security find-generic-password` for the password
  (`src/backend/useMySqlDriver.ts:1051-1071`; same shape in the Postgres and SQL Server drivers) —
  20.2 ms for a local `SELECT 1` and 40–50 ms of overhead per call over the network, times the 3–7
  calls the UI issues per interaction. Guarded by
  `src/mainview/tests/backend/remoteDataSourcePool.spec.ts` and `auth.spec.ts`.
- **T2a — one batched metadata sweep for MySQL and SQLite.** `db-tools` gained
  `getTableInfos(connectionId, tableNames?, refresh?)` over a session cache
  (`Map<connectionId, Map<tableName, TableInfo>>`): a sweep reads only the tables it does not hold yet
  and answers them in one backend call. Every write path drops what it touched — `modifyTable` (the
  whole connection: a rename or a new foreign key can reach other tables), `dropTable`,
  `applyTableChanges` (row counts), `refreshTableInfo`, `refreshConnectionSchema`, `disconnect*`, any
  `runQuery` whose statement writes (that is how `CREATE TABLE`/`ALTER` arrive from the editor), and
  the `invalidateAllMetadataCaches` handler. MySQL answers a sweep from **four** `information_schema`
  queries — columns, statistics, the `key_column_usage` + `referential_constraints` join, and the
  table/estimate row — instead of five per table, grouped in JS through the existing mappers, with the
  catalog estimate as `rowCount`; SQLite loads every table with one `queryRunner.getTables()` plus one
  `sqlite_master` read (row counts stay per table — SQLite has no catalog estimate). PostgreSQL and
  SQL Server keep the per-table fallback inside one client (T2b). The FK peek (`app.ts`), the
  comparison dialog, the SQL autocomplete and the schema hydration now ask once
  (`useConnections.ensureTableDetailsBatch`). Guarded by
  `src/mainview/tests/backend/sqliteTableInfos.spec.ts` (the batched read equals the single-table read,
  for tables and for a view), the "batched metadata reads" tests in `appApi.spec.ts` (a sweep answers
  several tables; a writing `runQuery` drops the cached table — verified to fail without the
  invalidation), the batched-helper test in `remote-driver-tools.spec.ts`, and
  `src/mainview/tests/e2e/metadata-batching.spec.ts` (comparing two MySQL databases issues exactly
  **one** `getTableInfos` per side and no per-table request). Measured live against the local server: a
  whole-schema sweep of `tirsik3_test` (85 tables) and of `eezytool` took **4** catalog queries each,
  and every table's columns, indexes and foreign keys were identical to the per-table path.
- **T3b — table lists answer from the catalog, not from one `COUNT(*)` per table.**
  MySQL/PostgreSQL/SQL Server `getTableNames` now report `resolveListedRowCount`
  (`src/backend/useRemoteDriverTools.ts`) with `rowCountIsEstimated: true`, so the sidebar keeps its
  `~` marker; an exact count is still fetched when a table is opened (`readRowCount` → `resolveRowCount`,
  which keeps the catalog estimate above 100 000 rows). Verified: MySQL `getTableNames` runs one
  `information_schema.tables` query and no `COUNT(*)`
  (`src/mainview/tests/backend/tableListRowCounts.spec.ts`); `getTables` for `wikiferheng` is **27 ms**
  and every listed row is flagged estimated (`open-table.spec.ts`). The first sidebar expand of `etwp`
  used to take **820 ms** for 163 counts.
- **T4 — the canvas draws viewport-bounded.** The visual row index and the row selection are indexed
  once per change, the all-selected answer and the dirty/saved-cell lookups are cached per change,
  `isSelectedCell` returns early when no range exists, formatted text is memoised per render version
  (validated against the displayed value, so edits still show) and text widths are cached per font.
  Before, `isSelectedCell` scanned every visible cell each frame (O(total rows) `indexOf`),
  `areAllRowsSelected()` ran twice per frame at O(rows × selected) and `measureText` ran per cell and
  per text run — ~0.9 M `indexOf` steps per frame at 2000 rows and 100+ ms frames with Select All.
  Guarded by "answers selection queries without scanning the rows per cell", "keeps the
  all-rows-selected answer cached across frames", "does not re-measure the same text on every frame"
  and "formats each cell once and still shows an edited value" in
  `src/mainview/tests/dataGrid/DataGrid.spec.ts`.
- **T5 — grid search debounces and indexes instead of reformatting.** The input still updates
  `searchQuery` per keystroke, but matching runs against a 200 ms debounced `committedSearchQuery`
  (`DATA_GRID_SEARCH_DEBOUNCE_MS`) over a per-page index of lowercase cell texts (`searchIndex`), so a
  keystroke is a row-wide `includes` plus a cell scan on candidate rows; clearing is immediate. Before,
  every keystroke forced `searchMatches` synchronously and looped every row × every column through
  `getFormattedCellValue().toLocaleLowerCase()` — ~100 k formatted cells and 100–300 ms of blocking
  work per character at 2000 × 50. Guarded by "formats each cell once for a search instead of on every
  keystroke" and `src/mainview/tests/e2e/grid-search.spec.ts`.
- **T6 — the SQL-editor stack is out of the boot chunk.** The parsers, grammars, snippet lists and
  completion provider moved to `src/mainview/lib/monacoSqlLanguages.ts`, which `configureMonaco` (now
  async, idempotent) loads dynamically; `MonacoEditor` awaits it before creating its model, and the
  dead parser-based `getSqlDiagnosticMarkers` is gone. Measured with `vite build`: entry chunk
  **7,027.58 kB → 567.74 kB**, and the entry no longer contains
  `MySqlParser`/`PostgreSqlParser`/`monaco-aria-container` (they live in the 3,794.87 kB
  `monacoSqlLanguages-*.js` chunk). Guarded by `src/mainview/lib/monacoBootChunk.spec.ts`.
- **T7 — the Electron main bundle no longer carries a second backend.**
  `import type { app as backendApp }` and the redundant `useAppDb().configureDatabase(userDataDir)`
  (plus its `DANEVAN_DATA_DIR` resolver) are gone, so the DDL, migrations and all three sequence
  normalisers run once. Measured: `main.cjs` is **11,859 B** (was 2,587,107 B), holds only the
  `package.json` mention of typeorm/mysql2 and no `configureDatabase` call; the live copy stays
  `backend.cjs`. Guarded by `src/mainview/tests/backend/electronMainEntry.spec.ts`.
- **T9 — SQLFluff probes the managed runtime instead of running pip.**
  `ensureManagedSqlFluffRuntime` (`src/backend/sqlDiagnostics.ts`) probes
  `<pythonPath> -m sqlfluff --version` once the venv exists and reuses the runtime when it answers, so
  a provisioned runtime never reaches pip; the developer's runtime answers in **0.348 s**
  (sqlfluff 4.1.0) where every session's first diagnostics used to pay a pip resolution. Guarded by
  `src/mainview/tests/backend/sqlDiagnostics.spec.ts` (no `pip` on the reuse path, one on the
  broken-runtime path, one probe per process).
- **T10 — no persistence per pointer move, no double JSON snapshot.** (a) `setColumnWidth` updates the
  reactive layout and persists through a 200 ms trailing timer (`DATA_GRID_LAYOUT_SAVE_DEBOUNCE_MS`,
  `applyLayoutUpdate({ deferSave: true })`), flushed on unmount or a storage-key change, while every
  other layout change still writes at once — guarded by "writes the grid layout once at the end of a
  column resize" in `src/mainview/tests/dataGrid/DataGrid.spec.ts`. (b) the modify-table history
  serialises its snapshot once per change instead of cloning it for the capture plus serialising it
  twice for the comparison, and `applyHistorySnapshot` clones twice with `structuredClone` instead of
  five times — guarded by `src/mainview/tests/e2e/modify-table-popup.spec.ts`.
- **T13 — the orphaned `tableInfo:*` settings rows are cleaned once.** `cleanupLegacySettings`
  (`src/backend/appDbMaintenance.ts`) runs at the end of `configureDatabase`: it deletes the
  `tableInfo:%` rows, `VACUUM`s and truncates the WAL once, and warns about any remaining settings key
  this build does not read. Measured on a copy of the live app DB (1,514 rows / 1,823,764 B):
  **356 rows / 1,122 B**, file **4,399,104 B → 69,632 B**, with all 8 servers, 28 connections and 4
  scripts intact. Guarded by `src/mainview/tests/backend/appDbMaintenance.spec.ts`.
- **T14 — the persisted tree state is parsed once per server.** `getPersistedTreeState` keeps one
  parsed object per server and re-parses only when the stored string changed (still reading
  `collapseStateVersion` so callers stay reactive), and `TreeServer` shares that cache instead of
  re-implementing it. Before, every accessor call `JSON.parse`d the persisted state, reached per
  sidebar row. Guarded by `src/mainview/tests/composables/useDbCaches.spec.ts` (50 row reads →
  1 `JSON.parse`).
- **U1 — the in-cell editor keeps the arrow keys.** The editor's own keydown handler stops the arrows
  (without cancelling them) and handles `Enter` (commit + move down), `Escape` (cancel) and `Tab`
  (commit sideways); `src/datagrid/useDataGridView.ts` `handleEditingKeydown`,
  `src/datagrid/useDataGridNavigation.ts` `commitEditingCellAndMoveDown`. Guarded by
  `src/mainview/tests/e2e/cell-editor.spec.ts` and the unit test "keeps arrow keys and Enter in the
  inline cell editor".
- **U2 — closing the cell editor without typing stages nothing.**
  `startEditingCell`/`openModalEditingCell` snapshot the formatted draft (`initialDraftValue`) and both
  commit paths skip `applyCellChange` entirely when the draft is unchanged, before parsing; menu-picked
  values clear the snapshot so they still count as edits. Guarded by "does not stage a change when the
  inline editor is closed without typing" (binary + numeric + JSON text) and
  `src/mainview/tests/e2e/cell-editor.spec.ts`.
- **U3 — the modal editor's Text wrap survives.** The open-time reset watcher is gone and the flag is
  a global preference persisted with `useCache` in `src/datagrid/dataGridModalPreferences.ts` (detached
  scope so its watcher survives grid unmounts). Guarded by
  `src/mainview/tests/e2e/cell-editor-modal.spec.ts` (reopen and reload) and "remembers the modal
  editor text wrap preference across dialogs".
- **U4 — JSON Prettify/Compact in the "Edit cell value" dialog.** `openModalEditingCell` decides
  JSON-ness once (`isJsonObjectText`); the dialog header shows the two buttons only then, both
  re-serialise the draft through `setModalEditingValue` and no-op on invalid JSON, and `Save` is
  unaffected. Guarded by `src/mainview/tests/e2e/cell-editor-modal.spec.ts` and "offers JSON prettify
  and compact only for a value that is a JSON object".
- **U5 — Modify Table: Undo restores the column type.** The field is a `ListBox` with `freeEdit`,
  whose text is driven by the component's own `searchQuery`; a free-edit commit (or a pick from the
  list) left that query behind, so every later render re-applied the stale text over the selection the
  draft had restored — the draft and the preview were already correct, only the field disagreed. The
  `props.selection` watcher now takes the text back whenever the selection changes outside the field
  (`src/shared/components/ListBox.tsx`). Guarded by "shows a selection that changes after a free-edit
  value was committed" (`src/mainview/tests/components/ListBox.spec.ts`) and by the undo/redo test in
  `src/mainview/tests/e2e/modify-table-popup.spec.ts`, which now asserts the field reverts to
  `varchar(200)` and the preview reads "No change yet" before Redo re-applies the change.
- **U6 — an edit to a script result went to another table.** The result grid guessed its table by
  walking the connection's cached tables and taking the first whose primary-key columns appeared in
  the result (`DbScripts.tsx`), so `select * from people` on a schema that also holds `accounts (id, …)`
  built `UPDATE "accounts" …`; the data tab's custom query had the same hole from the other side, using
  the table open in the sidebar. The executed statement now travels with its rows
  (`QueryExecutionResult.sourceSql`, set in `useQuery.runSqlBatch`) and
  `src/shared/utils/sqlSourceTable.ts` names the one table a plain select reads, refusing a join, a
  derived table, a set operation, an unknown qualifier or a result whose columns the table does not
  carry; `useResultSourceTable` loads that table's metadata and the grid writes to it, or refuses the
  edit with a reason. Guarded by `src/shared/utils/sqlSourceTable.spec.ts` and
  `src/mainview/tests/e2e/result-save-target.spec.ts` (script editor and custom query, each asserting
  the preview names the table and only that table's row changed).

### 2026-10-13 user-reported grid-state fixes (U7–U10)

Four reports that made the grid feel unusable, all reproduced live before fixing (an isolated dev
server on :3263/:3364, so the developer's app on :3264 was untouched):

- **U7 — a custom-query edit was refused although the statement names one table.** The resolver
  matches the parsed name against the connection's table list, which a script tab never loads on
  its own — a result edited before the sidebar ever expanded that connection was refused as "not
  a single known table". `useResultSourceTable` now ensures the table list (not just the details)
  before concluding the table is unknown. The backticked `WHERE`/`ORDER BY` query from the report
  is covered end to end by `tab-grid-state.spec.ts` (custom rows stay editable).
- **U8 — navigating between tabs lost the grid state.** Two holes: (a) any reload (stale flag after
  a script run, a save, the toolbar Reload) restored the custom-query *flag* but left the base
  rows under the custom text — `loadSelectedTable` now re-runs the custom query when the restored
  cache says custom mode (`useQuery.spec.ts`, `tab-grid-state.spec.ts`); (b) the one shared grid
  instance reset pending edits, position and selection on every view change — they are now parked
  per tab key (`useDbDataGrid`'s `stateKey`: the active tab's hash in `DbData`, the script tab's in
  `DbScripts`) with the row identity they were staged on, and restored only while the grid still
  shows those rows (changed rows drop the stash, or an edit would attach to the wrong row — found
  live when the stash captured the incoming view's empty rows instead of the leaving view's).
  Guarded by `tab-grid-state.spec.ts` (custom rows, pending edit, active cell) and
  `useDbDataGrid.spec.ts` (park/restore/drop), with `restorePendingChanges` pinned in
  `DataGrid.spec.ts`. The same-key/same-rows watcher fire no longer resets at all.
  Follow-up (still reported after reinstall): a table-to-script switch unmounts the data panel,
  which can take the watcher with it before it parks — the panel now also parks on scope dispose
  under its last-seen key, a remount's viewport sync re-ensures the restored active cell (the
  ensure skips zero-size viewports, which a fresh sync would otherwise misread as off-grid
  scroll), guarded by `tab-grid-state.spec.ts` table-to-script cases, the `useDbDataGrid.spec.ts`
  unmount case and a `DataGrid.spec.ts` viewport case.
  Follow-up 2 (scroll still lost on mouse-scrolled tabs): only the active cell was parked, but a
  mouse wheel moves no cell — and the restored cell is only scrolled barely into view. The stash
  now also parks the viewport's pixel scroll (read off the grid element, with a per-fire
  last-known fallback) and restores it exactly after mount; same-table reloads remap the kept
  index to its row's primary key instead of pointing at whatever slid into it (pending edits
  still drop on changed rows — re-resolving them could target the wrong row). Guarded by a
  `tab-grid-state.spec.ts` pixel-scroll case and `useDbDataGrid.spec.ts` park/restore/remap
  cases.
- **U9 — after a save the custom query no longer applied.** The post-save table reload is what
  implements the refresh, so with U8 it re-runs the custom query and the filter stays on
  (`tab-grid-state.spec.ts`). A script result instead reloaded an unrelated table state and kept
  showing the pre-save snapshot: `saveChanges` now calls the grid's `onSaved` hook when one is
  passed, and `DbScripts` refreshes by re-running the result's own statement — but only a plain
  single-table select (anything else could repeat a side effect). Guarded by the new
  `result-save-target.spec.ts` case.
- **U10 — "change display type" did nothing with no feedback.** The switch persisted to the layout
  storage (and the search index rebuilt), but the canvas caches formatted text per render version
  and redraws off it — and the version never included display types. The db grid's `renderVersion`
  now carries the display-type signature, so the switch repaints immediately. Proven live on a
  `bigint` unix-timestamp column (the report's `moves.created_at` shape): the raw integer matched
  before, the ISO rendering after. Guarded by `display-type-timestamp.spec.ts` (viewport pixels for
  the repaint, search for the content) and a render-version unit test in
  `useDbDataGrid.spec.ts`. Each new spec was verified to fail with its fix reverted.
- **U11 — `ORDER BY x DESC` listed NULLs first on MySQL.** Answer: on MySQL (and SQLite, SQL
  Server, Access) NULL is the smallest value, so the server sorts it last on DESC and first on
  ASC; only PostgreSQL sorts it largest. The grid's client-side sort treated NULL as largest for
  every dialect and flipped it on DESC, so a header sort contradicted the server order the grid
  had just loaded. `useDataGrid` takes a `sortNullOrdering` (`useDbDataGrid` maps every dialect
  except `postgresql` to `nulls-low`), verified live against MySQL (`DESC 1,5,3 + NULLs`,
  `ASC NULLs + 3,5,1`). Guarded by `grid-sort-nulls.spec.ts` (header DESC/ASC on a nullable
  SQLite column, values read back in visual order) and `DataGrid.spec.ts` null-ordering cases
  for both rules, plus a `useDbDataGrid.spec.ts` mapping case.

### 2026-10-11 stability-audit fixes

- **T16 — the unit gate failed at random on an uncleaned `ListBox` timer.** `onFocus` scheduled a 100 ms
  `setTimeout` that read `document.activeElement`, `showDropdown` a second one at 0 ms, and nothing
  cleared either; a component unmounted before they fired touched a torn-down `document` and vitest
  exited 1 although all 997 tests passed (reproduced 1 run in 3). Both timers are now kept in the
  component and cleared on unmount and before re-scheduling
  (`src/shared/components/ListBox.tsx`). Guarded by "leaves no timer behind when it unmounts before the
  focus timer fires" (`src/mainview/tests/components/ListBox.spec.ts`, which counts the pending fake
  timers and fails without the fix) and by "selects the field text shortly after it is focused", which
  keeps the timer's job pinned. Three consecutive `bun run test:coverage` runs exit 0.
- **T24 — the read-only policy was only proven on SQLite.** A read-only server connection now has its own
  browser spec: the connection is switched from the sidebar menu, the save is refused with the target and
  the connection named exactly as the save bar prints them, the pending change is kept and the row in
  MySQL is unchanged; the second spec flips the flag back and proves the same save then reaches MySQL as
  a real `UPDATE … WHERE id = 1`. `src/mainview/tests/e2e/readonly-connection.spec.ts` (the file source
  cases stay). Writing it found T30.
- **T26 — SQLite driver surfaces no spec executed.** `testConnection` (success, a blank path and an absent
  file), `getTablesFresh` with the per-table row count and views, `validateSql` (a statement it can
  prepare and one it cannot), `getTableDdl` (a table with its index footer, a view, an unknown name), the
  batched save (every change, a non-atomic regression, and the foreign-key violation message with the row
  id) and the three rebuild refusals (partial index, trigger, populated table losing every column) are
  asserted against real temp files in `src/backend/useSqliteDriver.spec.ts`. The explicit `ROLLBACK` is
  not observable through the tools — `withSqliteTypeOrm` builds and destroys a `DataSource` per call, so
  the transaction dies with the connection — but the spec does fail when the save is made non-atomic,
  which is the contract that matters. Each new case was checked against a mutation of its branch.
- **T30 — a read-only server connection showed no lock in the sidebar.** `TreeCollection` renders
  `ReadOnlyLock` when `collection.readonly === 1`, but `buildCollectionItem`
  (`src/mainview/components/TreeServer.tsx:105-140`) never set that field and `TableCollectionTreeItem`
  has no such property, so `isReadOnlyCollection` could never be true; only a file source carried the lock
  (on its own row, `TreeServer.tsx:474`). A server connection's state was visible only in its context
  menu. The connection row now renders the lock from `connection.readonly`, the way the file source row
  does. Guarded by the lock assertions in `readonly-connection.spec.ts`, which fail with the branch
  removed.
- **T17 — the mysqldump export modal replaced the paths the user had typed.** The defaults watcher
  assigned `executable`, `outputPath`, `databases` and `tables` when the answer arrived, so a path typed
  while the request was in flight (the Browse buttons are disabled then, the inputs are not) was
  overwritten and Run used the default instead. A field that still holds the value it had when the
  request started is now filled in; one the user changed keeps its value, and an answer for a closed or
  switched modal is dropped. Guarded by the failure-mode spec, which now holds the response back with
  `page.route` and types first: on the old component it fails at the field assertion, with the fix it
  passes three runs in a row.
- **T20 — assertions in `open-table.spec.ts` that could not fail.** The wall-clock bound
  (`toBeLessThan(10_000)`), `tableList.length > 0` and `data.rows.length > 0` are gone. The huge-table
  spec now asserts that no per-table `getTableInfo`/`getTableData` request is made while the list is
  drawn, that the opened table reports exactly the catalog estimate the list did, that the page holds its
  100 rows, and that the toolbar prints an estimate above the exact-count limit (InnoDB's estimate moves
  between reads, so holding the toolbar to a fixed number would be flaky by design).
- **T18 — the browser suite let one spec bleed into the next, and could borrow the wrong app DB.** A run
  shares one `.e2e-data` app DB, so sources an earlier spec left behind (the two keychain specs fail
  before their cleanup here) pushed the sticky spec's first source out of the pinned stack: it failed in
  a full run with `top` 24 and passes alone. `sidebar-sticky.spec.ts` now clears the sources it did not
  create (`deleteAllServers` in `helpers.ts`) and asserts the whole first-depth list is its own three
  rows, so a leftover fails the spec instead of skewing it. `reuseExistingServer: false` replaces
  `!process.env.CI`, so a dev server the developer left running — with a different `APP_DATA_DIR`, i.e.
  the real `~/Library/Application Support/danevan` — can no longer stand in for this run's, and the
  resolved `APP_DATA_DIR` is exported to the spec processes as well. `post()` retries a refused
  connection for a few seconds, because the dev server answers on the renderer port before the vite
  plugin mounts the API. Guarded by the pair `failure-modes.spec.ts sidebar-sticky.spec.ts`: without the
  reset it fails at `expect(rowFor(server:first).top).toBeLessThan(1)` (received 24), with it the sticky
  spec passes; and the earlier full run reached spec 90/114 with only the two keychain failures.
  _Not verified_: two consecutive complete full runs — in this session every run of the whole suite was
  SIGTERM'd by the sandbox at an irregular point (spec 5, 15, 95, 61 s, 6 s), and reverting this branch
  did not change that (T31 records the one port-related suspect).
- **T21 — the MySQL driver tools had no unit spec.** `useMySqlDriver.spec.ts` drives the real
  `useMySqlDriverTools` over a faked pool entry (the socket boundary: `remoteDataSourcePool.withDataSource`
  hands back a recording query runner, and each catalog is answered by hand), instead of the
  `vi.mock('useMySqlDriver')` that made `db-tools.spec.ts` test its own fake. Ten cases: the catalog table
  list (estimate flagged, one query, no `COUNT(*)`), a page with `LIMIT`/`OFFSET` and the unbounded
  `limit < 0` form, the result columns of a read through the connection, the native DDL copy with
  `SHOW CREATE TABLE`/`VIEW`, `validateSql`'s `SET`/`PREPARE`/`DEALLOCATE` sequence plus the
  "not supported in the prepared statement protocol" and real-error paths, and the four-catalog metadata
  sweep with its name filter. Every case was checked against a mutation of the branch it covers
  (five mutations, five caught). `useMySqlDriver.ts` went from 16.6 % to **42.6 % lines / 35.8 % branches
  / 50.5 % functions**.
- **T22 — a MySQL failure now says what it means.** `describeMySqlError` (`useMySqlDriver.ts`) maps the
  driver's codes — duplicate key, rejected statement, lock wait/deadlock, refused credentials,
  unreachable, lost connection — to a sentence the user can act on, keeps mysql2's own text (which
  carries the key and the line), and leaves an error it does not know exactly as it was, so a read-only
  refusal or a "was not found" is not re-wrapped. It is applied at `testConnection` and at both pooled
  clients, which is every path a statement takes. `useMySqlDriver.spec.ts` covers each mapped family,
  the `driverError` nesting, a code carried only by the message, the unknown case and the tool-level
  path; the browser spec asserts the exact text the editor's History panel shows for a duplicate key and
  a syntax error, target prefix included.
- **T23 — a DATE/DATETIME/TIMESTAMP is the text MySQL holds.** It used to arrive as a JS Date, be
  serialised to an ISO instant and read back in the host's zone: on this machine (UTC+1)
  `2024-02-29 13:45:56.789` reached the grid as `2024-02-29T12:45:56.789Z` and a `date` column showed
  **2024-02-28**. `dateStrings: true` in the MySQL DataSource (next to the `supportBigNumbers` /
  `bigNumberStrings` the driver already set) hands over exactly what the server stored.
  `mysql-types.spec.ts` pins DECIMAL, DATE, DATETIME(3), TIMESTAMP(3), YEAR, JSON and NULL-versus-empty
  through the API and through the grid's editor; without the fix it fails on the shifted dates.

### 2026-10-12 stale-context audit (U6 follow-up)

Prompted by "the same thing happened with a connection once": a scan for actions whose target
(connection, server, table) came from global/selected state or from a response that outlived the
context that started it. All of these were reachable and are fixed in the working tree; each action now
names the entity its panel acts on, and a response whose context has moved on is not applied.

- **The data grid read and wrote the sidebar's selected connection, not the table's.** With a table
  open, double-clicking another source selects it without changing the tab, so Reload/sort/paging
  fetched that database's rows under the old tab and `applyTableChanges` sent the edits there.
  `DbData.tsx` now passes `query.loadedConnectionId` (set by `loadTables`/`loadSelectedTable`) to the
  grid, the FK-peek views, paging, sort, reload and the custom-query resolver; `rememberCustomQuery`
  and `runCustomQuery` use it too.
- **The script editor ran on the selected connection, not the tab's.** `query.runQuery` read
  `connections.selectedConnectionId` while the header showed the tab's own `editorConnectionId`.
  `runQuery(connectionId, …)` now takes the connection explicitly and `DbScripts` passes the tab's; the
  browser spec asserts the request body's `connectionId`.
- **A script result stayed bound to the tab's new database.** Changing the header's DB/server kept the
  previous connection's rows on screen while the grid targeted the new connection — a save wrote them
  into a same-named table there. `QueryExecutionResult.sourceConnectionId` (set in `runSqlBatch`)
  travels with the rows, the grid and the table resolver bind to it, and `updateTabConnection` clears a
  tab's cached result when its connection changes.
- **A query result landed in whichever script tab was active on arrival.** The run is now filed under
  the tab that started it (including its history entries) instead of `query.queryResult` + the active
  tab.
- **A slow table load overwrote the table loaded after it.** `loadSelectedTable` carries a sequence
  and only the newest load writes rows, metadata and the loading flag.
- **The comparison applied an earlier target's metadata** while the pickers were on a newer pair, so
  Apply could build the destination schema from the stale table. The load is keyed to the requested
  pair and sequence-guarded.
- **Format SQL could overwrite another tab's draft** when the tab changed while the formatter ran; the
  result is dropped unless the editor text is unchanged.
- **Modify Table's slow open filled the draft of the table opened after it** (Cancel then reopen);
  `openModal` carries a sequence.
- **A slow selection response reverted the whole app context.** `applySelectionBootstrap`
  (`dbCoreState.ts`) applies a connection/server/script selection only while it is the newest.
- **Smaller stale writes:** the server-schema popover keys its load to the server, the FK peek ignores
  a response for a cell that was replaced (and a closed popover invalidates it), the grid formatter
  context is sequence-guarded and loaded for the grid's own table, rapid settings toggles are
  serialized instead of rebuilding from the same old state, the Run-SQL-script dialog guards its
  defaults like the mysqldump modal does, the FK-peek menu uses the view's own connection, and a new
  scratch tab opens on the active tab's connection.

Guarded by `src/mainview/tests/e2e/connection-context.spec.ts` (grid save after selecting another
source, run after selecting another source, result dropped when the tab moves to another database) and
by `src/mainview/tests/e2e/result-save-target.spec.ts` for the table half.

The three structural follow-ups from that audit are fixed too:

- **T33 — the sidebar selection and the open tab agree.** Selecting a connection (tree row, file
  source, new connection) now activates a tab of that connection — the last one used for it, else the
  last in the tab list — or clears the active tab so the workspace shows its empty state instead of
  another database's panel. `useNavState` watches `selectedConnectionId`; activation selects the tab's
  connection, so the two settle instead of looping. Guarded by
  `src/mainview/tests/e2e/connection-context.spec.ts` (a source with no tab clears the workspace and its
  tab returns to it; a source with a tab brings that tab forward).
- **T34 — one query state per tab.** `useQuery` is no longer a singleton: `useQueryForTab(hash)` owns a
  state per tab and `useQuery()` is a proxy that resolves the active tab on every read and write, so a
  value captured at setup can no longer belong to whichever tab was open then. The editor text is
  seeded once per tab (`seedQueryTextForTab`, marked on typing), `isTableDataStale` is shared on purpose
  (a script anywhere can drop a table), a closed tab's state is dropped with its runtime state, and a
  scratch tab that becomes a saved script carries its state to the new hash. `DbScripts` lost the
  result routing: a run writes its result into its own tab's state. Guarded by
  `src/mainview/tests/e2e/tab-query-state.spec.ts` (a slow run is left behind, its result waits in its
  own tab, and the other tab keeps its text and shows no result).
- **T35 — a stale bootstrap cannot land at all.** `buildBootstrap` stamps every snapshot with a
  monotonic `version` and `_dbCoreState.applyBootstrap` ignores one that is not newer than the applied
  state, so a slow `hideConnection`/`updateConnection`/`deleteServer`/`deleteScript` response can no
  longer revert a selection made while it ran (they are all full snapshots, so the newer one already
  carries the change). The per-call `applySelectionBootstrap` wrapper is gone. Guarded by
  `src/mainview/tests/composables/dbCoreState.spec.ts`.

### 2026-10-12 quit the app when the last window closes
Reported from the dock: closing the window left the process resident (the macOS branch of
`window-all-closed` skipped `app.quit()`), and clicking the icon ran `activate`, which recreated a
window. The shell now quits on the last window close on every platform and the recreate path is gone,
so the dock icon starts the app afresh. Guarded by `src/mainview/tests/electron/shell-native.spec.ts`
(closing the only window ends the process with code 0).

The Electron suite had also been red since `7713834` (the bootstrap `version`), which no run after that
commit noticed:

- `shell.spec.ts` listed the bootstrap keys without `version`; the shared helper is now
  `withoutVolatileFields` (was `withoutTimestamps`) and drops that per-call field too.
- `packaged.spec.ts` compared two of its own snapshots through a copy of that helper, which had the
  same bug; it uses the shared one now, and it launches the artifact with the harness switches
  `shellArgs` documents (`--no-sandbox --disable-gpu --user-data-dir=…`) and an `APP_DATA_DIR` of its
  own, so it starts on a host without a Chromium sandbox instead of failing to launch and leaving its
  DB and profile in the developer's `~/Library/Application Support`.

### 2026-10-12 the packaged app could not start: it shipped unsigned

After the quit-on-close change the user reported the app "quits immediately — I see a white screen" on
a plain Dock launch, and it was reproducible: the same bundle opened and died about 1.5 s in. The
window and the quit handler were innocent — the process was being aborted by Chromium, not by
`window-all-closed` (`forcefullyCrashRenderer` leaves the window up, so a dead renderer cannot explain
it). The real chain, read off a failing launch:

```
sandbox initialization failed: Operation not permitted
GPU process exited unexpectedly: exit_code=6        (×5)
FATAL:content/browser/gpu/gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.
…/Danevan.app/Contents/MacOS/Danevan exited with signal SIGTRAP
```

`electronConfig` packs with `mac.identity: null`, so nothing signed the bundle, while packaging renames
`Electron Helper*.app` to `Danevan Helper*.app` and leaves Electron's signatures stale. macOS refuses
those helpers the `com.apple.security.inherit` sandbox, the GPU (and renderer) processes cannot start,
the page never paints — **the white screen the user had reported from the start** — and Chromium
aborts the app a second later. `activate`-recreated windows failed the same way, which is what made it
look like a reopen-only bug, and once closing a window quit the app, every launch ended in a prompt
exit. The 26 `Danevan Helper` crash reports on this machine are that GPU crash loop.

`afterPack` now runs `src/electronUtils/signMacApp.ts`, which signs the renamed helpers and the app
ad-hoc with the entitlements in `src/electronUtils/entitlements/` (`com.apple.security.inherit` for the
helpers, the JIT/library ones for the app) and verifies the result. Proven on this machine before
wiring it up: the unsigned bundle dies at ~1.5 s with GPU crash reports, the ad-hoc signed copy of the
same bundle runs indefinitely with none. Guarded by `src/mainview/tests/backend/signMacApp.spec.ts` (a renamed
Electron helper gets `inherit`) and by `packaged.spec.ts`, which now also asserts the artifact carries
a signature macOS accepts.

It still failed after the first reinstall, because the release flow's copy broke the signature again:
`fs.cp(builtAppPath, applicationsPath, { recursive: true })` resolved the bundle's relative framework
symlinks (`Electron Framework -> Versions/Current/Electron Framework`) into absolute paths into
`build/mac-arm64/Danevan.app/…`, so the installed app reported "unsealed contents present in the root
directory of an embedded framework" and died exactly like an unsigned one. `installMacApp.ts` now
copies with `ditto` (which preserves symlinks, xattrs and the signature) and `releaseHelpers.ts`
re-checks the installed signature, so a copy that breaks the bundle fails the release instead of the
user's next launch. Guarded by `src/mainview/tests/backend/installMacApp.spec.ts` (the installed framework
symlink is still relative) and by the existing launch checks.

### 2026-10-12 `src/electronUtils` is one copy again

The folder is meant to be copied between apps unchanged, but the two copies had drifted into forks: 9 files
differed, 4 existed only here and 2 only in gitvan, and each side held fixes the other lacked. It is now
byte-identical to `gitvan/src/electronUtils` (18 files), with the app-specific parts moved behind options:

- `helpers.ts` gained gitvan's env port overrides (prefix derived from `pkg.name`) and the API request
  timeout, and kept the `{error}` envelope reader — now in-folder as `apiErrorMessage.ts` — plus the
  empty-body handling gitvan was missing.
- `mainviewHelpers.ts` keeps the Vue-proxy unwrapping gitvan lacked; `executeCommand.ts`/`requestContext.ts`
  bring gitvan's timeouts and request-scoped cancellation here; `useDatabase.ts`/`appDataDir.ts` keep
  gitvan's statement cache and `transaction` with this app's data-dir seam; `vite-plugin.ts` adopts
  gitvan's tested `extractApiMethods`, the LISTEN-only port cleanup (T31) and the dev/build guards.
- `mainProloadHelpers.ts` unifies on gitvan's injectable `fileExists`/`loadBackend` plus this app's
  single-instance lock, handler replacement and diagnostic-listener cleanup; IPC channels are namespaced
  `api:<name>` on both ends.
- `browserOnlyHelpers.ts` keeps this app's robust `listen`/`Server` result and takes gitvan's request
  scoping, native stand-ins, `/health` handler-error report and `classifyError`; a void method now answers
  `null` instead of an empty body.
- `releaseHelpers.ts` runs `test:validate` only when the project has that script (gitvan does, this app
  does not); `handleScripts.ts` offers the `perf` task to both. `perfBaseline.ts` left the folder for
  `gitvan/scripts/`, and the folder's specs moved to `src/mainview/tests/backend/` so the copies match.

Verified: 1048 unit tests + typecheck here (the one MS Access failure was machine load; it passes alone),
1049 with `msAccessBridge.spec.ts` on its own, 12/12 Electron shell tests, and on the gitvan side 1135 unit
tests, 7/7 shell tests and its native-picker browser spec.

### What a green suite already proves

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
  form sets the flag, a file source carries a lock on its own row and a server connection on its
  connection row, the row menu offers 'Make read-only' / 'Allow writes', and every write path refuses
  with the connection named while reads keep running. On MySQL the refusal is asserted with the target
  the save bar prints (`name (host:port/database)`), the row in the database is unchanged, and allowing
  writes again lands the same save as a real `UPDATE … WHERE id = 1` (T24, T30).
- **The SQLite driver's own surfaces** (`useSqliteDriver.spec.ts`, T26): connecting to a file (and the
  blank-path and absent-file failures), listing tables and views with their row counts, validating a
  statement the database can and cannot prepare, the DDL copy including a table's index footer, the
  batched save (all changes in one transaction, a failed change leaving the file untouched, the
  foreign-key violation message naming the row) and the three rebuild refusals.
- **A `ListBox` that goes away mid-focus leaves no timer** (`ListBox.spec.ts`, T16): the pending fake
  timers are counted, so the 100 ms selection timer and the 0 ms scroll timer cannot outlive their
  component and throw after jsdom is torn down.
- **The foreign-key peek's own state** (`fk-peek.spec.ts`): the rows popover says it is loading or why
  it is empty instead of drawing an empty grid, and the spec polls that state and re-walks the arrows
  until the cell editor really opens (1 failure in 4 runs before, none in 11 after).
- **Test infrastructure**: a skipped precondition fails the run (`failOnSkipReporter.ts`); coverage
  floors are one point below the measured numbers and per-area (`src/backend`, `src/datagrid`,
  `src/shared`, `src/directives`); `test:e2e:electron` and `test:e2e:packaged` build and launch the shell
  and the packaged `.app` with separate configs, because `appConfig` hard-codes the API port. The
  browser suite and every shell spec boot a test-owned app DB under `.e2e-data` (only its DB files are
  wiped per run, so the provisioned runtimes survive) — never the developer's real one.
- **A failed request shows its message, not the API's JSON envelope** (`errorMessage.ts`,
  `readonly-connection.spec.ts`, `failure-modes.spec.ts`): a non-2xx answer is unwrapped where it is
  read, so the error carries the `{ "error": … }` message itself, and the
  `Error invoking remote method 'x': Error:` wrapper Electron puts around a rejected handler is peeled
  where the failure reaches the screen. The save bar prints the target and the refusal — the read-only
  spec asserts that text exactly — instead of `Backend error (500): {"error":"…"}` with its escaped
  quotes.
- **The formatter specs require a provisioned SQLFluff runtime** (`helpers.ts`,
  `sql-editor-panels.spec.ts`, `table-lifecycle.spec.ts`): `requireSqlFluffRuntime()` probes the same
  candidates the backend resolves (a system `sqlfluff`, `python3 -m sqlfluff`, `python -m sqlfluff`,
  then the managed venv) and fails with the command that provisions it. On a fresh data dir the first
  diagnostics or format request built the venv and ran `pip install` inside the spec — minutes under a
  15 s timeout — and the `Problems` count was wrong until the install finished.
- **The shipped shell's own flows** (`flows.spec.ts`, `playwright.electron.config.ts`): the built app
  opens a SQLite table, edits a cell, saves it and reads the row back through the API; it applies a
  modify-table change and reads the new column back; it runs a MySQL query in the editor and reads the
  result out of the grid. Every request a user makes goes over `electronAPI.invoke`, which had no flow
  coverage at all — the browser suite drives the dev server's HTTP API — so the shared
  `expectPreloadBridge` assertion comes first in each flow. The Electron config now uses the same
  fail-on-skip reporter as the browser config, because these specs share its `require*` preconditions.
- **Hostile values** (`hostile-input.spec.ts`): a reserved table name and reserved column names, quotes
  and statement separators in the text, CJK and an emoji outside the BMP, a newline, a BLOB, a trigger
  and a view — on SQLite and on a live MySQL. The grid edits a row and adds one, and every result is
  read back exactly: the text, the untouched binary column (byte for byte, straight out of the file on
  SQLite), the row the trigger recorded and the view that reports the new value.
- **The grid's copy menu** (`grid-clipboard.spec.ts`): the cell, row and column menus put the value
  their label promises on the system clipboard — `Copy`, `As JSON`, `As SQL Literal`,
  `As SQL INSERT`/`SELECT` for the dialect, `Copy Row`, `Copy Column Name` and `As CSV` over a
  multi-row selection — with the clipboard emptied before each copy so a copy that does nothing cannot
  read the previous value. (The grid has no paste counterpart; values come in through the cell editor.)
- **Column formatters** (`grid-formatter.spec.ts`, `useGridFormatters.spec.ts`,
  `gridFormatter.worker.spec.ts`): the manager creates and deletes a formatter, the column header
  assigns it and marks the assignment, the grid's search proves the displayed text became the formatted
  one (the raw value stops matching), and a reload keeps both. Writing this found a real bug: a request
  posted before the worker's script had run was thrown away, so the first render of every freshly
  assigned formatter kept the raw value. The worker now announces that it is listening and the page
  holds its requests until it does; the unit spec fails against the old code.
- **The editor with SQLFluff missing** (`sqlfluff-unavailable.spec.ts`, `sqlDiagnostics.spec.ts`): the
  backend's degraded answers are asserted directly (the lint reason comes back as a _warning_ marker,
  `formatSql` refuses with the reason), and the UI that renders them is driven over the network
  boundary: Problems names the reason without disabling Format, a Format click reports the failure and
  leaves the SQL alone, and Copy as DDL still copies the DDL.
- **The Monaco editor's settings** (`editor-settings.spec.ts`): the header's dropdown changes the font
  size the editor paints its text with, keeps its range and number controls in step, closes on Escape
  and survives a restart.
- **The sticky sidebar spec measures instead of assuming** (`sidebar-sticky.spec.ts`): it reads the
  rows the browser drew and uses the sidebar's own "this row is pinned" test (its section starts above
  it) instead of assuming a row height and a panel with no padding, which is why it failed on a clean
  checkout. Two mutations — pinned rows made to overlap, and a pinned click made to toggle instead of
  scrolling back — each make it fail. It also owns the list it measures now: `deleteAllServers` clears
  what earlier specs left, and the spec asserts the whole first-depth list is its own three rows (T18).
- **The MySQL driver tools against a faked pool** (`useMySqlDriver.spec.ts`, T21): the real
  `useMySqlDriverTools` records its statements and answers each catalog by hand — the table list with its
  estimate and no `COUNT(*)`, a page with `LIMIT`/`OFFSET` and the unbounded `limit < 0` form, the result
  columns of a read, the native DDL copy, `validateSql`'s `SET`/`PREPARE`/`DEALLOCATE` sequence and the
  four-catalog sweep. Five mutations of the branches it covers each fail it.
- **The MySQL failure text and its value fidelity** (`useMySqlDriver.spec.ts`, `sql-editor-panels.spec.ts`,
  `mysql-types.spec.ts`, T22, T23): every mapped error family and the unknown case (unit), the exact
  sentence the editor's History panel shows for a duplicate key and a syntax error on a live server, and
  DECIMAL, DATE, DATETIME(3), TIMESTAMP(3), YEAR, JSON and NULL-versus-`''` read through the API and the
  grid's editor, with the date text the server stored rather than an ISO instant.

## Open

The 2026-10-11 stability audit (SQLite + MySQL on macOS) asked whether "tests green" means "app stable"
and answered no, adding T15–T29. Four themes, in the order they weaken the signal: the gate does not run
the suites that prove the shipped macOS app (T15); the signal is not deterministic (T16–T18 closed, with
the one thing a sandbox could not verify recorded in T18 and a load-sensitive unit spec left in T32); the
browser suite contributes no coverage and `src/mainview` has no floor (T19 open, T20 closed); and the two
dialects had named holes, most of them now closed (T16, T17, T20–T24, T26, T30 in `## Done`; T25, T27,
T28 and the app database's own client at T29 still open). T27 is the one entry whose diagnosis changed
while being worked on: the failure happens before the rebuild, when the table's metadata cannot be read at
all. T31 and T32 are new findings from the sessions that closed T18 and T22/T23. T2b and the two earlier
test-audit items stay in `## Open (blocked)`.

- **T15 · `release:validate` does not run the shipped shell or the packaged app (medium)** — the gate is
  `bun run test:coverage && bun run test:e2e && bun run build` (`package.json:39`), so
  `test:e2e:electron` (`playwright.electron.config.ts`: `shell.spec.ts`, `flows.spec.ts`,
  `restart.spec.ts`, `second-launch.spec.ts`, `shell-native.spec.ts`) and `test:e2e:packaged`
  (`packaged.spec.ts`, the real `build/mac-arm64/Danevan.app`) cannot fail it. Those are the only specs
  that load `src/electron/main.ts` (0 % lines), the preload bridge (`src/electron/preload.ts`) and the
  externalised `better-sqlite3` out of `app.asar`, while the browser suite speaks plain `fetch`
  (`browserOnlyHelpers.ts`) where the app goes preload → IPC (`mainviewHelpers.ts`). `RELEASING.md:64` is
  stale besides: it documents the gate as `vitest run` + `vp run build`.
    - _fix_: add both suites to `release:validate` (build the shell first), correct `RELEASING.md`, and
      add the fail-on-skip reporter to `playwright.packaged.config.ts` (it is `'html'` only, so a skip
      there is green).
    - _verify_: rename a key in the preload bridge — `bun run release:validate` must fail now and pass
      with the current gate.
- **T19 · the browser suite contributes no coverage, and `src/mainview` has no floor (medium)** — no
  coverage instrumentation exists in `playwright.config.ts`, the specs or the helpers, so
  `coverage/coverage-summary.json` is unit-only: 52 of 182 files are at 0 % lines while the browser suite
  drives them (`App.tsx`, every modal, `DbSidebar.tsx`, `DbData.tsx`, `ModifyTableModal.tsx`), and the
  spec-driven ones look worse than the app is (`useModifyTable.ts` 1428 lines at 0.8 %, `useConnections.ts`
  5.6 %, `useMySqlDriver.ts` 16.6 %). The floors in `vitest.config.js` cover `src/backend`,
  `src/datagrid`, `src/shared` and `src/directives` only, so a new `src/mainview` component with no spec
  moves no number.
    - _fix_: instrument the Playwright run (v8/istanbul, e.g. monocart) and merge it with the vitest
      report; add `src/mainview/**` and `src/electronUtils/**` floors once the merged numbers exist.
    - _verify_: a component no spec imports appears in the merged report with browser-hit lines, and
      deleting its spec lowers a floor.
- **T25 · the MySQL half of the suite runs only on the developer's own fixtures (medium)** — `MYSQL`
  (`helpers.ts:12-20`) defaults to `127.0.0.1:3306` root with an empty password, and the specs need a
  pre-existing `tirsik3_test` with rows (`open-table.spec.ts:34-37`), a table estimated above 100 000 rows
  in the 30 GB `wikiferheng` (`:82-86`), a provisioned SQLFluff runtime (`helpers.ts:111`) and a writable
  keychain for a password (`connection-form.spec.ts:91`). A fresh Mac or CI runner cannot be green, so
  "green" is a property of this machine rather than of the product.
    - _fix_: seed what the specs shape their assertions around (create the schema and the rows, and make
      the estimate table with a recursive-CTE insert), or ship a seeding script plus a `require*` that
      names it; keep the `E2E_MYSQL_*` overrides for a real server.
    - _verify_: on a MySQL that holds none of these databases, the suite provisions them and is green.
- **T27 · a SQLite table with a generated column cannot be inspected at all (medium)** — the entry used to
  say the rebuild turned a `GENERATED` column into a plain one. Trying to write that spec showed the
  failure happens earlier: `getTableInfoFresh` calls TypeORM's `queryRunner.getTable`
  (`useSqliteDriver.ts:630`), and for a table that carries a generated column TypeORM asks a
  `typeorm_metadata` table that the app never creates (`grep typeorm_metadata src` = nothing), so the call
  throws `SqliteError: no such table: typeorm_metadata`. A user who opens such a table sees that error,
  and the Modify Table dialog cannot even build a plan for it — so the silent-rebuild path is not reachable
  today, and a refusal guard in `applyModifyTable` would be dead code (tried, reverted).
    - _repro_: a temp file with `CREATE TABLE people (n text, first text GENERATED ALWAYS AS (substr(n, 1, 1)) VIRTUAL)`,
      then `useSqliteDriverTools({...}).getTableInfoFresh(1, 'people')` → `no such table: typeorm_metadata`.
      `bunx vitest run src/backend/useSqliteDriver.spec.ts` has the harness to drive it.
    - _fix_: read a table that has a generated column without TypeORM's metadata query — build its info from
      `PRAGMA table_xinfo` plus `sqlite_master.sql` (the DDL module already parses collation and
      AUTOINCREMENT out of the create statement) and fall back to `getTable` for every other table. Creating
      the missing `typeorm_metadata` table in the user's file is not an option: it is their schema, and a
      read-only inspection must not write to it.
    - _verify_: a temp-file spec with one `STORED` and one `VIRTUAL` generated column that reads the info
      (`hidden` 2 and 3, the column names) and then rebuilds the table with the generation intact.
- **T28 · the SQLite environments a user hits are untested, and the TypeORM shim has no spec (medium)** —
  nothing mentions a busy or locked database (`busy_timeout` is set at `useSqliteDriver.ts:376`), WAL on
  an opened user database (`bunTypeOrmSqliteDriver.ts:74`; only the app DB's `journal_mode` is asserted),
  an OS-read-only file, `WITHOUT ROWID`, `ATTACH` or date handling. `bunTypeOrmSqliteDriver.ts` has no
  spec at all (`toPragmaNumbers` `:12-26`, `defaultSafeIntegers` `:73`, `pragma`/`exec` `:81-89` run
  incidentally).
    - _fix_: specs on real temp files: a second connection holding a write transaction, a read-only file
      on disk, a permission-denied write, a `WITHOUT ROWID` table and a `datetime` column across a save.
    - _verify_: removing `busy_timeout` or `defaultSafeIntegers` fails the spec that covers it.
- **T29 · the app database's own client is untested, and its specs fake it (small)** —
  `src/electronUtils/useDatabase.ts` (228 lines, including the accounts/groups/repositories schema at
  `:168-195`) has no spec and no production caller: `appDbSchema.ts:1` and `appDbMaintenance.ts:1` import
  its `DatabaseClient` **type**, `db-app.ts:4` imports `resolveAppDataDir`, and `appDbSchema.spec.ts:16-36`
  / `appDbMaintenance.spec.ts:14-25` hand-roll the client (`as unknown as …`) instead. Either the factory
  is dead code or it is the app store's real client with no coverage.
    - _fix_: decide — delete the unused factory (and the schema it carries) or make the app-DB specs
      drive it against a real temp file instead of the hand-rolled client.
    - _verify_: the app-DB specs use the production client, or the dead code is gone and the type lives
      with its users.
- **T31 · the dev server's port cleanup kills clients, not just listeners (small)** — `killStaleServers`
  (`src/electronUtils/vite-plugin.ts:74`) runs `lsof -ti:PORT | xargs kill -9`, and `lsof -i:PORT` matches
  every socket on that port: a spec run's request context, the browser, an editor tab. Only a stale
  *listener* should be killed, which is `lsof -tiTCP:PORT -sTCP:LISTEN`. Found while the whole browser
  suite kept being SIGTERM'd in this session (at spec 5, 15 and 95, and at 61 s and 6 s): the diagnostic
  showed the call resolves **no** listeners at dev-server startup (`listeners=[]`), so it is not proven to
  be the killer — the `-sTCP:LISTEN` change was made, could not be verified (that run died after 6 s
  instead) and was reverted rather than shipped blind.
    - _fix_: pass `-sTCP:LISTEN` and prove it: start a second process that holds a *client* connection on
      the port and assert it survives the cleanup while a stale listener does not.
    - _verify_: a stale dev server on 3263 is killed, a spec run talking to 3264 is untouched.
- **T32 · the MS Access bridge spec sits at its 10 s limit (small)** — `msAccessBridge.spec.ts:91`
  ("creates a table, reads its metadata and its rows back") spawns the JVM and took **8.2 s alone**
  (5.8 s on an earlier run) against the 10 s test timeout. In a full parallel `bun run test:coverage` it
  timed out — `Error: Test timed out in 10000ms` — while the other 82 files ran, and the whole run went
  red for load rather than for a change. `AGENTS.md` forbids raising the timeout; the cost is the JVM.
    - _fix_: stop paying a JVM start per case — reuse one bridge process across the file's four cases, or
      batch their probes into one worker session.
    - _verify_: the file's cases stay under a few seconds each and `bun run test:coverage` is green on a
      loaded machine, with the same metadata and rows asserted.

## Open (blocked)

- **T2b · the PostgreSQL and SQL Server half of T2 (medium)** — T2a batched the sweep for MySQL and
  SQLite; those two dialects still take the per-table fallback in `useRemoteDriverTools.ts` (with no
  `helper.getTableInfos`, `getTableInfosFresh` builds one `TableInfo` per table inside a single
  client), so a sweep there is one backend call but still five catalog queries per table. Implement
  `getTableInfos` for `usePostgresDriver.ts` from `pg_catalog` and for `useSqlServerDriver.ts` from
  `sys.*`, in the shape of the MySQL one: one query per catalog (columns, indexes, the foreign-key
  join, the table/estimate row), grouped in JS through the existing mappers, `rowCount` from the
  catalog estimate, and a `remote-driver-tools.spec.ts` case asserting the sweep costs a bounded
  number of queries.
    - _blocked by_: a reachable PostgreSQL and SQL Server to prove the queries against — the same
      condition the `e2e-13` entry below records. The code can be written blind, but `pg_catalog` and
      `sys.*` differ enough from `information_schema` that an unverified implementation would be
      guesswork.
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

## Not planned

- **T3a — SQLite and the macOS Access bridge still run `COUNT(*)` per table in a list.** Deliberately
  kept, because the fix is the same trade-off as T3b but the lists would lose their counts entirely:
  SQLite has no `estimateRowCount` (`src/backend/useSqliteDriver.ts:712-719`, and `getTableData` also
  counts per page at `:601`), and the JVM bridge counts in `listTables` and again in `getTableInfo`
  (`src/backend/msAccessBridgeSource.ts:193`, `:323`). Measured cost: the SQLite fixture
  (12 tables × 150 k rows, 114 MB) `getTables` is **68.5 ms**, dominated by its 12 counts. Revisit if a
  SQLite or Access schema grows enough for a list refresh to be felt.
- **T8 — MS Access: do not materialise whole tables, and batch metadata.** The measured half is
  Windows-only (`src/backend/useMsAccessWindowsDriver.ts`): `topClause` is used only when `offset === 0`
  and `$adapter.Fill($dt)` pulls `SELECT *` into a `DataTable` before `Select-Object -Skip`-style
  paging (`:626-657`), and four PowerShell processes are spawned per table info (`:471-489`) — page 2
  of a large `.accdb` reads the whole table into the PowerShell process, and a peek over a 23-table
  Access DB costs 92 spawns. It cannot be written or verified from this repository (macOS, no
  PowerShell, no `.accdb`), and shipping it blind would be speculative; the macOS bridge's per-table
  `COUNT(*)` is the T3a trade-off. The developer's two `.mdb` sources do use that bridge, so the fix
  sketch is kept for a Windows machine: push paging into the query (keyset paging by primary key with
  `TOP`), batch the four metadata calls into one invocation, and reuse a single long-lived PowerShell
  host — measured by counting spawns and by elapsed + peak memory for page 2 (the bridge already logs
  `[perf][msaccess] bridge.*`).
- **T10 (settings blob) — tab drafts stay in the persisted settings blob.** The existing 150 ms
  debounce already bounds those writes, drafts must survive a crash or a close, and the audit gave no
  measurement showing this path (rather than the column-resize path) was the problem.
- **T11 — the bootstrap is still built and shipped on every tab activation.** The payload half only
  bites with hundreds of scripts (344,244 B at 300 scripts; the developer has 4, so ~11 kB), and it
  cannot be made safe by itself: `selectScript` writes the selection back and `buildBootstrap`
  re-defaults `selectedScriptId` to the first script, so the suggested `selectedScriptId !== undefined`
  guard does not actually skip the call. The remaining per-table calls (`getTables`, `getTableInfo`,
  `getTableData`, `selectConnection`) are real work, not overhead. Opening a table costs **7 API calls**
  and switching 3; `src/backend/app.ts:475-514` builds the bootstrap from `appDb.listScripts()`
  (`src/backend/db-app.ts:429` selects `sql_text`) and **20** handlers return it, while
  `src/mainview/composables/useNavState.ts:502-506` (and `:554`) calls `scripts.selectScript(undefined)`
  unconditionally and `:659-663` rebuilds a string holding every script's SQL. Revisit if the script
  count grows or a profile still shows the tab switch.
- **T12 — prune the packaged app.** The change is `electron-builder` config and buys disk size only
  (no runtime effect), and its verification needs a full packaged build plus dmg, which belongs in a
  release/packaging pass. Kept for that pass: `.app` **525 MB** / dmg **176 MB**; the asar holds
  ~190 MB of `node_modules` already bundled into `dist/`/`dist-electron/` (`monaco-editor` 92.6 MB,
  `@azure` 23.3 MB, `typeorm` 17.9 MB, `dt-sql-parser` 15.0 MB, `@js-joda` 7.3 MB, `@vue` 6.4 MB,
  `@babel` 3.8 MB, `tedious` 2.6 MB), plus unused monaco workers (`ts.worker` 6.6 MB, `css.worker`
  1.0 MB, `html.worker` 740 kB, `json.worker` 420 kB) and a 12 MB `extraResources` payload including
  the 10 MB `assets/test-access-db.mdb`; `src/electronUtils/electronConfig.ts:8-23` excludes only
  `node_modules/electron`. Target: exclude the bundled-only packages, drop the unused workers and the
  sample `.mdb`, then check the dmg is < 60 MB.
- **T14 (rest) — sidebar tree virtualization and the "ids/flags" watcher source.** Virtualization and
  lazy tooltip DOM are not worth the risk yet: the same audit measures 163 rendered sidebar rows at
  **5 ms**. The watcher-source idea was **tried and reverted**: keying it on the table count instead of
  the names stopped expanded table details from loading and took `connections.spec.ts` from 22 s to
  15 min, so that sketch is wrong as written.
