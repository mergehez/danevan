# todos — findings and fix list

**Status:** 14 entries closed (T1, T3b, T4, T5, T6, T7, T9, T10, T13, T14, U1–U4) · 2 open
(T2 deferred, U5 bug) · 6 deliberately not planned (T3a, T8, the T10 settings blob, T11, T12,
T14's tree work) · the measured before-state is in `## Ground rules for whoever picks a task up` ·
severity framed for the developer's setup: local + 3 remote MySQL servers (portal, gateway, hetzner),
2 SQLite files, 2 MS Access files, databases up to 30 GB and 163 tables, 28 saved connections, grid
page sizes up to 2000 rows.

The audit that drove the closed entries ran on 2026-10-09 against the developer's real data sources:
four parallel read-only audits (backend DB layer, frontend state/data flow, startup/app-DB/packaging,
datagrid/rendering) plus direct measurements on this machine. The long survey is recoverable from git:
`git show 6139b00:todos.md`. `## Done` is what is already implemented and verified; `## Open` is what
is left; `## Not planned` records what was investigated and deliberately closed. Do not redo a Done or
Not planned entry without new evidence.

## Ground rules for whoever picks a task up

- Checks: `bunx vue-tsc --noEmit`, `bunx vitest run`, `bunx playwright test <spec> --reporter=line`.
- `vp run lint` currently fails on **pre-existing** oxlint TS7026 errors in `src/datagrid/DataGrid.tsx`
  (untouched by this list). Use oxlint on the files you changed plus vue-tsc for a full typecheck.
- Sandbox/e2e quirk: run Playwright with `APP_DATA_DIR="$(pwd)/.e2e-data" bunx playwright test ...`
  and delete `.e2e-data` afterwards. Without it the backend tries to write
  `~/Library/Application Support/danevan` and fails with `SQLITE_READONLY` outside the workspace.
  `bun run dev` kills stale listeners on 3263/3264, so stop other dev servers first.
- A full `bun run test:e2e` is green on a provisioned machine (verified at commit `6139b00`). The two
  specs this list used to flag as pre-existing failures now pass: `sql-editor-cursor.spec.ts` in the
  full run, and `sidebar-sticky.spec.ts` when it is run alone — it failed in a full run whose earlier
  specs had left extra sidebar sources behind, so re-run it in isolation before blaming a change.
- `bun` crashes on `better-sqlite3` (NAPI): inspect the app DB with `node`/`npx tsx`, not bun.
- Local test databases on `127.0.0.1:3306` (root, empty password): `tirsik3_test` (59 tables),
  `eezytool_e2e` (39), `etwp` (163 small tables), `wikiferheng` (23 huge tables, 30 GB).
- Repo rules from `AGENTS.md`: one logical change per commit, imperative subject ≤72 chars; never add
  test timeouts >10 s or blind inline timeouts; every user-facing change needs a browser spec under
  `src/mainview/tests/e2e`.
- New user-reported issues are appended as `U<n>` under `## Open` with a repro, `file:line` evidence, a
  fix sketch and a verification step; an entry moves to `## Done` only with the spec that catches it.

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

## Open

- **T2 — replace the metadata N+1 fan-outs with one batched call (large, deferred).** T1 removed the
  multiplier that made this hurt (one connection and one keychain spawn per `getTableInfo` instead of
  163 of each), so what remains is the fan-out itself: an FK peek on `etwp` (163 tables) is 163 backend
  round trips and ~650 `information_schema` queries in **0.92 s** locally, with `usages=0` — over the
  network, a connection storm against production servers. It was left out of the last pass
  deliberately: a batched `getTableInfos` per driver plus a session metadata cache is a larger change
  than the rest of this list.
    - _Sites_: `getPeekUsageRelations` (`src/backend/app.ts:140-147`,
      `Promise.all(tables.map((t) => dbTools.getTableInfo(connectionId, t.name)))`); `ensureTableDetails(…, force)`
      for every table on every "Compare database…" open (`src/mainview/composables/useComparison.ts:88`,
      `:122`, `:282`, which bypasses the `loaded` guard at `src/mainview/composables/useConnections.ts:182`);
      the first autocomplete of every editor instance (`src/mainview/components/MonacoEditor.tsx:119-122`);
      `ensureConnectionSchema` (`useConnections.ts:160-170`). There is no cross-request cache:
      `invalidateAllMetadataCaches` is an empty stub (`src/backend/db-tools.ts:456`) and `getTableInfo`
      always calls `getTableInfoFresh` (`:710-718`).
    - _Fix_: one batched backend method, e.g. `getTableInfos({ connectionId, tableNames? })`, answering
      from a single catalog query per driver (`information_schema.columns/statistics/key_column_usage`
      for MySQL, `pg_catalog` for Postgres, `sys.*` for SQL Server) — and for the FK peek specifically
      one query over `key_column_usage` + `referential_constraints` for the whole schema — plus a
      session-level `Map<connectionId, Map<tableName, TableInfo>>` in `db-tools` with explicit
      invalidation on `modifyTable`/`dropTable`/`applyTableChanges`/`refreshTableInfo`/
      `refreshConnectionSchema`. Point comparison, autocomplete and peek at the batched method.
    - _Verify_: count API calls while opening "Compare database…" and while triggering autocomplete on
      the `etwp` connection (target: ~1–2 calls, today 1 + N). `src/mainview/composables/useQuery.ts:112`
      already logs per-load timings and the backend logs `withTimedAppOperation` per request.
    - _Blocked for_: PostgreSQL and SQL Server verification — no reachable server on this machine, the
      same condition `TESTS-AUDIT.md` records as `e2e-13`. The batched call can be written for those
      drivers, but only the MySQL half can be proven here (SQLite is not in this task's scope: its
      metadata comes from pragmas, not from a catalog query).
- **U5 — Modify Table: Undo does not restore a changed column type (bug).** Repro: open a table's
  "Modify Table…" popup → **columns** → select `name` → change its type to `varchar(500)` → press
  **Undo**: the type input still shows `varchar(500)`. The Undo button is enabled and the click runs;
  only the column-type draft does not come back, and it reproduces on the pre-T10 code too, so it
  predates the history-snapshot rewrite.
    - _Evidence_: `src/mainview/composables/useModifyTable.ts`, the watcher around
      `captureHistorySnapshot`/`applyHistorySnapshot`. The browser spec "offers undo and redo while a
      draft change is pending" (`src/mainview/tests/e2e/modify-table-popup.spec.ts:185`) deliberately
      stops short of asserting the revert because of this bug — it clicks Undo then Redo and asserts
      the database, so the spec stays green while the bug lives.
    - _Fix_: check whether the type input keeps its own local copy of the value (the popup binds it
      through a component that may not re-read the draft after the columns array is replaced), or
      whether the type change is committed to a draft the snapshot does not carry.
    - _Verify_: browser spec — change the type, Undo, assert the input **and** the generated preview
      SQL show the original type; Redo brings the change back.

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
