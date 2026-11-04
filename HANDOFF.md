# HANDOFF — orientation for a fresh agent

**Maintained by AI agents.** This is the map: what the project is, how a request flows, which state is
fragile, the bug classes this codebase has actually hit, and the traps in the test suites. Read it
before scanning the tree. Update it in the same session that changes the commands, the architecture, a
known failure or the open-task snapshot.

Two files split the job: **this one is orientation**, `todos.md` is the task ledger (what is done, what
is open, and what a green run proves). Git history is the changelog — do not duplicate it here.

_Last verified: 2026-10-27, after the data tab's query bar gained its interactive control set. Before
that today: the sidebar row count was wired to the rows that are measured. On 2026-10-26: foreign-key
target suggestions; on 2026-10-25 a `_by` foreign-key column pointing at `users`;
2026-10-24 database short codes (migration v3) and table-tab grouping (a row per server/database, the tag
once on the row header); 2026-10-23 the Modify Table split, generated index/foreign-key names and the
grid's last-column resize fix._

## 1. What this is

**Danevan** — a desktop database client (Electron + a Vite-served renderer) for **SQLite, MySQL,
PostgreSQL, SQL Server and MS Access**. It browses schemas, runs SQL, edits grid rows and writes the
changes back, compares schemas, modifies tables, exports with `mysqldump`, and runs `.sql` scripts. The
app's own state (servers, connections, scripts, settings) lives in its own SQLite file; the user's
databases are reached through TypeORM-backed drivers.

Stack: Vue 3 + TSX (no SFCs), Tailwind (theme tokens in `src/mainview/css/tw.css`), Monaco for SQL,
`dt-sql-parser` for autocomplete, TypeORM + `mysql2`/`pg`/`mssql`/`better-sqlite3`, Express for the
browser dev API, Vite + Electron, Bun as runtime/package manager.

## 2. Commands (verified)

| What | Command |
| --- | --- |
| Dev (browser) | `bun run dev` — Vite on **3263**, the backend API mounted inside the Vite process on **3264** |
| Dev (Electron) | `bun run dev2` — Vite in `desktop` mode, spawns `electron .` |
| Typecheck | `bunx vue-tsc --noEmit` (clean; this is the real gate) |
| Unit | `bunx vitest run` · coverage gate: `bun run test:coverage` |
| One browser spec | `bunx playwright test src/mainview/tests/e2e/<spec>.ts --reporter=line` |
| Whole browser suite | `bunx playwright test` (~1.7 min, 122 tests) |
| Electron shell suite | `bun run test:e2e:electron` (builds the shell first) |
| Packaged app | `bun run test:e2e:packaged` (builds the `.app`) |
| Release gate | `bun run release:validate` = coverage + browser suite + build. It does **not** run the Electron suites (T15). |
| Lint | `bun run lint` — `oxfmt && oxlint --fix && vue-tsc --noEmit`; oxlint has pre-existing TS7026 in `src/datagrid/DataGrid.tsx` |

## 3. Repo map

| Path | What lives there |
| --- | --- |
| `src/backend/` | `app.ts` (~47 async handlers, the whole API), `db-tools.ts` (driver dispatch + metadata caches), `useMySqlDriver.ts` / `usePostgresDriver.ts` / `useSqliteDriver.ts` / `useSqlServerDriver.ts` / `useMsAccessDriver.ts`, `useRemoteDriverTools.ts` (shared remote query/exec), `remoteDataSourcePool.ts` (one pooled DataSource per server/connection), `db-app.ts` (the app's own SQLite store), `auth.ts` (keychain secrets), `sqlScriptRunner.ts`, `devServer.ts` (Express mount for browser mode) |
| `src/mainview/` | `App.tsx` (shell), `components/` (`DbSidebar`, `DbTabs`, `DbData`, `DbScripts`, `MonacoEditor`, modals…), `composables/` (all renderer state, see §5), `lib/` (Monaco setup, menus, formatting), `tests/` (unit, components, e2e, electron). **Modify Table** is a folder each: `composables/modifyTable/` (types, drafts, column DDL, create/alter previews per dialect, validation, apply, history, navigation) with `useModifyTable.ts` as the store, and `components/modifyTable/` (sidebar with its item menu, form helpers, one form per entity) with `ModifyTableModal.tsx` as the shell |
| `src/datagrid/` | The data grid: real DOM rows and cells (`DataGrid.tsx` + `DataGridSurface.tsx`, styled by `css/dataGrid.css`), a render model that mounts only the rows and columns in view (`useDataGridRenderModel.ts`), the state (`useDataGrid.ts`), navigation, clipboard, layout persistence. The in-cell editor is a textarea overlay; an offscreen canvas measures text widths only. |
| `src/shared/` | Types (`types.ts` — `AppBootstrapApi`, `QueryExecutionResult`, …), components (`Button`, `CenteredModal`, `Splitter`, `ListBox`, the colour picker in `components/colorPicker/`…), utils (`sqlStatements`, `sqlSourceTable`, `sqlIdentifiers`, `valueFormatting`, `dbColor`, `tsxHelpers`, `useCache`…) |
| `src/electron/` | `main.ts` (window + native handlers), `preload.ts` (IPC bridge), `bridge.ts` |
| `src/electronUtils/` | **Project-agnostic: byte-identical to `gitvan/src/electronUtils`** (see AGENTS.md). `vite-plugin.ts` (mounts `devServer` in browser mode, auto-generates `apiMethods.ts`, dev ports), `mainviewHelpers.ts` (`createAppClientPpc`), `browserOnlyHelpers.ts` (browser dev server; app specifics come in as options), `helpers.ts`/`appDataDir.ts`, `useDatabase.ts`, `executeCommand.ts`/`requestContext.ts`, `signMacApp.ts`/`installMacApp.ts` and `releaseHelpers.ts`/`electronConfig.ts` (release chain, loaded by Node's ESM loader — keep `.ts` extensions there) |
| `src/directives/` | `v-tooltip`, `v-context-menu`, `v-loading`, `v-error` |
| `todos.md` | The task ledger: Done / Open / Open (blocked) / Not planned, with the specs that guard each fix |

## 4. How a request flows

1. The renderer calls a method through `appClientRpc.request.<method>(params)` (`src/mainview/appClient.ts`
   → `createAppClientPpc`). In Electron it goes over IPC (`window.electronAPI`, structured-clone safe);
   in a plain browser `window.electronAPI` is absent and the same call falls back to
   `POST http://127.0.0.1:3264/api/<method>`.
2. `useTasks.ts` wraps every method in an async task (`run`, `isRunning`, per-method error) and exposes
   `tasks.<method>.run(...)` plus global `isBusy`/`reportError`/`dismissError`.
3. `src/backend/app.ts` handles it against the app DB (`db-app.ts`) or a user database through
   `db-tools.ts` → `getConnectionDriverTools(connectionId)` → the driver. Remote drivers share pooled
   DataSources (`remoteDataSourcePool`); metadata sweeps are batched and cached, and a writing statement
   invalidates the metadata cache for that connection.
4. Writes that change servers/connections/scripts/settings return a **full bootstrap snapshot**
   (`buildBootstrap()`), now stamped with a monotonic `version`; the renderer applies it only if it is
   newer than the state it already has.

## 5. Renderer state — the fragile part

Everything below is a **singleton** (module-level `useX()` cache). State that belongs to a tab must not
live in one of them unless it is keyed by the tab.

| Store | Owns | Notes |
| --- | --- | --- |
| `_dbCoreState` (`dbCoreState.ts`) | servers, connections, scripts, `selectedServerId/ConnectionId/ScriptId`, `bootstrapVersion` | The only writer of the snapshot; `applyBootstrap` drops older versions |
| `useSettings` (`useSettings.ts`) | `tabs`, `activeTabHash`, UI prefs, tab grouping/sort and the per-mode display orders (`tabOrders`) | Persisted in `localStorage` via `useCache` under `settings`; `tabOrdering.ts` orders a copy (and splits grouped rows) — never `tabs` itself |
| `useNavState` (`useNavState.ts`) | Tab activation (serialized), per-script-tab runtime state (result panel, problems, history), the selection→tab watcher, closed-tab stack | Tab actions call `activateActiveTab()`; activation retries up to 5× and coalesces |
| `useQuery` (`useQuery.ts`) | **Per tab**: rows, table metadata, selected table, grid SQL, custom query + its source SQL, editor text, result, running flag, the query bar's editor mode and its interactive draft. **Shared**: `isTableDataStale` | `useQueryForTab(hash)` creates/returns a tab's state; `useQuery()` is a proxy that resolves the active tab on every read/write. Never capture it at setup and assume it is one tab. `loadSelectedTable` re-runs the custom query when the restored cache says custom mode, so a reload/save/reactivation shows the custom rows, not the base table. `runInteractiveQuery(dialect)` builds the statement from the draft (`src/shared/utils/interactiveSelectQuery.ts`, which quotes and pages per dialect) and runs it through `runCustomQuery`, so the rows, the manual field's text and the grid's edit target are one statement; the draft is remembered per table with the text (in-memory deep watcher). The bar itself is `components/DbQueryBar.tsx`. **The bar and the grid toolbar state one page:** `applyPage`/`setPageLimit`/`setPageOffset` are the only paging actions (the page-size menu, the page menu, first/prev/next/last, Reload and the bar's LIMIT/OFFSET all use them), a load mirrors the loaded page and sort into the draft (`syncDraftWithLoadedPage`), and `syncInteractiveOrderBy` mirrors a header-menu sort that only repaints (it never refetches). The toolbar's page menu lists a window around the current page (`lib/gridPagination.ts`) instead of one button per page. |
| `useConnections` (`useConnections.ts`) | Per-connection table list, per-table details cache, selection actions | Loaders are keyed and guarded; `ensureTableDetailsBatch` is the batched sweep. `applyTableRowCount` is the **only** writer of a table's sidebar count (tree row *and* cached list): a table load, a save and a table metadata refresh report there, and an exact count is never traded for the catalog estimate that `~` marks. |
| `useServers`, `useScriptsDb`, `useDbCaches` | Server schemas, script CRUD/selection, persisted tree collapse state | All by explicit id |
| `useGridFormatters` | Custom formatter templates + the **current context** (connection+table) | Context loads are sequence-guarded; the grid loads the context of its own table |
| `useForeignKeyPeek` / `useForeignKeyPeekViews` | The FK peek popover and the peek-view stack | Peek lookups carry a token; views are keyed by id |
| `useComparison`, `useModifyTable`, `useDbDataGrid`, `useResultSourceTable` | Comparison state, Modify Table draft, the grid's behavior/target, the edited table's resolution | `useResultSourceTable` is what names the table an edit is written to (it ensures the connection's table list first — a script tab never loads one). `useDbDataGrid` is one shared instance whose pending edits/position/selection are parked per tab key (`stateKey`: active tab hash) and restored only while the rows match; its `renderVersion` carries the display-type signature so a switch repaints. |

Panels: `App.tsx` renders `DbData` or `DbScripts` for the active tab's type. `DbData`'s grid target is
`query.loadedConnectionId`; `DbScripts`'s result grid targets
`queryResult.sourceConnectionId` with the table named by `queryResult.sourceSql` through
`src/shared/utils/sqlSourceTable.ts` (which refuses joins, derived tables, set operations and unknown
qualifiers). After a save the data grid reloads its table (re-running an active custom query);
a script grid instead refreshes via its `onSaved` hook, which re-runs only a plain single-table
select — anything else keeps its rows until the toolbar Reload.

## 6. Bug classes this repo has actually hit

These are not hypotheticals; each one shipped and was fixed. The rule in `AGENTS.md` and the spec that
guards it are the reference.

1. **An action read the global selection instead of its own entity.** The script editor ran on
   `connections.selectedConnectionId` (another database) while its tab showed a different one; the data
   grid loaded and saved another connection's table; a comparison could `ALTER` a stale target.
   *Rule:* an action names its target. *Guards:* `connection-context.spec.ts`,
   `result-save-target.spec.ts`.
2. **A response was applied although its context had moved on.** A slow table load overwrote the table
   opened after it, a stale selection reverted the whole app context, Modify Table's open filled a
   later table's draft, Format SQL replaced another tab's draft, the FK peek answered for a replaced
   cell, the schema popover listed another server's schemas, quick settings toggles reverted each
   other, and activating one table tab verified every other tab's database (a dead one raised its
   "connection lost" over the table being read). *Rule:* carry a sequence (or the requested key) and drop stale answers. *Example guards:*
   `dbCoreState.spec.ts`, the sequence counters in `useQuery.ts`/`useComparison.ts`/`useModifyTable.ts`/
   `useGridFormatters.ts`/`useForeignKeyPeek.ts`.
3. **One shared object held every tab's panel state.** `useQuery` was a singleton whose fields were
   copied in and out as tabs activated, so a background run needed hand-rolled routing and a value
   could surface in the wrong tab. *Rule:* per-tab state is keyed by the tab. *Guard:*
   `tab-query-state.spec.ts`. The grid is still one shared instance, so its *view* state (pending
   edits, inserted/deleted rows, active cell, selection) is parked per tab key and restored only
   while the row set matches; a same-key/same-rows fire no longer resets at all. *Guards:*
   `tab-grid-state.spec.ts`, `useDbDataGrid.spec.ts`.
4. **A whole-state snapshot was trusted on arrival.** Any bootstrap could revert a newer selection.
   *Rule:* the backend versions every snapshot; the renderer applies only a newer one. *Guard:*
   `dbCoreState.spec.ts`.
5. **The edited table was guessed from the result's column shape.** `select * from people` staged
   `UPDATE "accounts"` when both had an `id`. *Rule:* the executed statement travels with the rows
   (`sourceSql`) and names the table, or the edit is refused. *Guard:* `sqlSourceTable.spec.ts`,
   `result-save-target.spec.ts`.
6. **Watcher echo loops.** Monaco → `queryText` → draft sync → `replaceTab` used to re-trigger
   activation on every keystroke (cursor jumps). Activation no longer copies text between tabs and
   `setActiveTabText` writes the tab's own state. *Guard:* `src/mainview/tests/composables/useNavState.spec.ts`.
7. **The packaged app shipped unsigned, so macOS would not sandbox its helpers.** `mac.identity: null`
   left the renamed `Danevan Helper*.app` bundles with Electron's stale signatures; the GPU process
   crash-looped and Chromium aborted the app a second after launch, so the window stayed white and the
   app vanished (and, once closing a window quit the app, it looked like an instant exit). The install
   copy broke the fix once more: `fs.cp` rewrote the bundle's relative framework symlinks into absolute
   paths into `build/`, which unseals the signature, so the *installed* app behaved exactly like the
   unsigned one. *Rule:* sign the bundle ad-hoc and copy it with `ditto`. *Guards:*
   `src/mainview/tests/backend/signMacApp.spec.ts`, `src/mainview/tests/backend/installMacApp.spec.ts`, `packaged.spec.ts`
   (the artifact must carry a signature macOS accepts), plus the post-install signature check in
   `releaseHelpers.ts`.
8. **A paint-affecting change that touches no row never repainted.** The grid caches a cell's
   formatted text per render version and renders off it (it was drawn to a canvas then, it is
   rendered from a model now); a display-type switch updated the stored layout and rebuilt the search
   index, but the version never included display types, so the screen kept the old text with no
   feedback. *Rule:* painted-text state joins the render version. *Guard:*
   `display-type-timestamp.spec.ts` (viewport pixels plus search).
9. **The client-side sort contradicted the server on NULLs.** The grid re-sorts the loaded page for
   its sort indicator by flipping the value comparison on DESC, which puts NULLs first on dialects
   that sort them last. *Rule:* NULL placement is an explicit per-dialect rule (`sortNullOrdering`).
   *Guard:* `grid-sort-nulls.spec.ts`.
10. **An auto-measure cap also clamped what the user asked for.** The grid measures a column with long
    text at 520 px and the resize drag was clamped by the same limit, so the last column (usually the
    long one, worst with 2–3 columns) was already at its ceiling and refused to grow. *Rule:* the
    auto-measure ceiling is not the user's ceiling. *Guards:* the custom-width case in
    `DataGrid.spec.ts`, `grid-resize.spec.ts`.
11. **An entity was matched by a shared property, listed twice, and confused with its neighbour.**
    The Modify Table dialog called any index draft over the primary-key columns "the primary index",
    so an added index on the first column (usually the primary key) was dropped from the plan and the
    dialog said `No change yet`. It listed the primary key and unique indexes under both `keys` and
    `indexes`, and the plan reads the key, so edits and deletes on the copy were discarded. It also
    treated a PostgreSQL/SQLite unique *index* as a unique *constraint*, rebuilding a named
    `CREATE UNIQUE INDEX` inline (SQLite: name lost) and dropping it with `DROP CONSTRAINT`, which
    fails. *Rule:* identify an entity by its own identity, edit the list the plan writes, and keep a
    constraint and an index of the same columns apart (`origin: 'unique'`). *Guards:*
    `useModifyTable.spec.ts`, `postgresTableDdl.spec.ts`, `typeOrmMappers.spec.ts`,
    `modify-table-popup.spec.ts`, `sqlite-modify-table.spec.ts`.
12. **A list's number never followed the rows that changed it, and its `~` was unexplained.** The
    sidebar count came only from the table-list query, so after deleting every row it kept the catalog
    estimate (`~20`); the table's details and the grid knew the exact count and nothing wrote it back,
    and "Refresh metadata" on a table updated the details the tree never read. MySQL's list count is
    `information_schema.tables.table_rows`, an InnoDB estimate, which is what `~` marks — and it is what
    stayed at 20 after the `DELETE`. *Rule:* `connections.applyTableRowCount` is the only writer of a
    table's sidebar count (it patches the tree row **and** the cached list), every path that measures
    rows reports there, and an exact count is never traded back for a later estimate. *Guards:*
    `useConnections.spec.ts`, `useQuery.spec.ts`, `row-mutations.spec.ts`.
13. **A staged NULL was read as "no change".** The grid displayed
    `pendingChanges[key]?.nextValue ?? sourceRow[column]`, so a pending change *to* NULL fell through to
    the row's old value: `Set Value > (null)` counted a change in the save bar while the cell kept
    drawing what it held before (and the transposed view kept a row the user had just emptied). *Rule:*
    a NULL is a value — read the change, not a non-null value. *Guards:* the staged-NULL case in
    `DataGrid.spec.ts`, `cell-set-value.spec.ts`.
14. **Enter in a number field threw the typed number away.** The limit/offset inputs committed on the
    native `change` event, and their Enter handler called `preventDefault()` to run a query: the browser
    then never fired `change`, so the draft kept its old value and the next render patched the input back
    — the field visibly reverted to what it held before (the spinner arrows, which fire `change` on
    `input`, worked). *Rule:* a field that commits on `change` must not cancel the Enter that would fire
    it; commit the draft from `input`, and make Enter **apply** what the field says. Committing both
    numbers is one load (`applyPage`), never two racing ones. *Guards:* `useQuery.spec.ts`
    (`applyPage`), `query-bar.spec.ts` (Enter in limit/offset).

## 7. Testing — the traps

**Preconditions fail rather than skip.** A spec that needs MySQL, `mysqldump` or the SQLFluff runtime
calls `requireMySqlDatabase` / `requireMySqlExecutable` / `requireSqlFluffRuntime` /
`requireFixtureData` from `helpers.ts`; a missing precondition throws (or skips only with
`E2E_SKIP_MISSING_DB=1`), and `failOnSkipReporter.ts` fails a run that skipped. A green run means the
specs really ran.

- **MySQL fixtures** are the developer's own at `127.0.0.1:3306` (root, no password): `tirsik3_test`
  (59 tables), `eezytool_e2e` (39), `etwp` (163 small tables), `wikiferheng` (23 huge tables, ~30 GB).
  Override with `E2E_MYSQL_*`.
- **`APP_DATA_DIR`**: `playwright.config.ts` handles it. Omit it and the run uses `.e2e-data` and
  deletes just the app DB (`danevan.sqlite*`) first, so each run starts clean. Set it yourself and the
  reset is skipped — state and dead `file:` sources accumulate and the sidebar starts logging
  `unable to open database file`. **Never `rm -rf .e2e-data`**: it holds the provisioned SQLFluff and
  MS Access runtimes, which are downloads.
- **The grid is real DOM text**, one element per visible row (`[data-grid-row="<visual row>"]`,
  `[data-grid-cell="<column index>"]`, `[data-grid-row-number]`; headers are
  `[data-grid-header-cell="<column>"]`). A drawn value is asserted directly (`toHaveText`), and only a
  window of rows is mounted: `native-grid.spec.ts` scrolls a 2000-row page to the end and asserts the
  first row is gone and the mounted count stays bounded. The in-cell editor
  (`textarea[data-editor-key="<row>:<col>"]`) still shows the *raw* value by design
  (`formatEditingValue`), so formatting is asserted on the cell text, not the editor.
  `data-grid-viewport` can match several grids (FK peek) — use `.first()`; `Meta+ArrowLeft` /
  `Meta+ArrowUp` jump to the row's first cell / the column's first row, which is how a test reaches a
  known cell after an earlier edit.
- **A fresh script tab opens on the Problems panel.** Click the `Result` tab before asserting a result.
- **`openSidebarTable` returns before the rows land.** When a test edits right after opening a table,
  wait for the `/api/getTableData` response and/or the `Loading table data...` overlay to clear.
- **Wait for the run, not the grid.** `page.waitForResponse(r => r.url().endsWith('/api/runQuery'))`
  before reading a result; click `Run` only after setting the wait up.
- **To test a background run, make the query slow**: a recursive CTE counting to a few hundred thousand
  rows (see `tab-query-state.spec.ts`).
- **Two specs fail in a sandboxed environment** and pass on a normal machine: `connection-form.spec.ts:91`
  and `failure-modes.spec.ts:62`, both because the keychain refuses writes
  (`SecKeychainItemCreateFromContent: UNIX[Operation not permitted]`). They fail identically on an
  untouched tree, so they are not a signal about a change.
- **Bun cannot load `better-sqlite3` (NAPI)**; inspect the app DB with `node`/`npx tsx`.
- **Ports are killed, not reused**: `bun run dev` kills whatever listens on 3263/3264, and the old
  `lsof -ti:PORT | kill -9` also matched *clients* (T31). Stop other dev servers before a spec run.
- **Electron shell specs: two `getBootstrap` answers never match field by field** — the selection
  normalisation rewrites `updated_at`, and every snapshot carries its own `version` — so compare through
  `withoutVolatileFields` (`src/mainview/tests/electron/helpers.ts`). The packaged smoke test launches the
  artifact with that helper's environment plus the `shellArgs` switches; without them it cannot start on a
  host that gives Chromium no sandbox.
- **`electron-builder`'s dmg stage fails in a restricted shell** (`hdiutil` → `plistlib.InvalidFileException`)
  while the `.app` in `build/mac-arm64` is already complete: verify it with `bunx electron-builder --dir` and
  `bunx playwright test --config playwright.packaged.config.ts` rather than the full release command.
- **Node ≥ 26 ships an experimental `localStorage` global** that resolves to `undefined` unless the
  process was started with `--localstorage-file`, and it shadows the one jsdom installs: every spec that
  persists grid/panel state died on `localStorage` being undefined. `src/mainview/tests/setup.ts` installs
  an in-memory `Storage` (and the class with it) when the global is not usable, so `bunx vitest run`
  works on both the old and the new Node.
- Unit specs: `vitest.config.js` counts **every** source file (including untested ones) and enforces
  aggregate and per-area floors; raise a floor when you close a gap.

## 8. Current health and open work

Snapshot at the last verification: **1156 unit tests (93 files)**, **168 browser tests (47 files)**,
**14 Electron shell tests** (dev ×12 + packaged ×2), coverage **49.6 % statements / 42.2 % branches** with
the floors green. The full browser suite ran 168 passed + 0 failed, and that green run also assumes the
local MySQL fixtures and the provisioned SQLFluff runtime (T25), so on a fresh machine the precondition
guards will fail loudly instead — read the message, it names what is missing. The dev-shell and packaged
suites were not re-run after this renderer-only change.

The grid is DOM (see §3/§7). Measured on a 2000-row × 40-column page, 200 scroll steps: the canvas
version spent **275 ms** scripting (11 ms layout/style) and the DOM version **7 ms** scripting +
41 ms layout/style, with **24 rows** and ~180 viewport nodes mounted regardless of page size. Both
keep the 16.7 ms frame at the median; the DOM version's cost is in the browser's paint, not in JS.

Open tasks live in `todos.md` (`## Open`): **T15** (release gate misses the Electron suites), **T19**
(browser suite contributes no coverage; no `src/mainview` floor), **T25** (MySQL specs depend on local
fixtures), **T27** (SQLite generated columns can't be inspected — TypeORM asks for
`typeorm_metadata`), **T28** (untested SQLite environments / TypeORM shim), **T29** (the app DB's own
client factory), **T31** (dev-server port cleanup kills clients), **T32** (the MS Access bridge spec
sits at its 10 s limit). Blocked: **T2b** (Postgres/SQL Server batched sweep), **e2e-13** (their write
paths), **unit-10** (Windows verification) — all need a machine this one is not.

## 9. Maintaining this file

- Update **§2** when a command, port or config changes; **§5** when a store's ownership changes; **§6**
  when a new bug class ships (add the rule to `AGENTS.md` too); **§7** when a test trap or known
  environment failure changes; **§8** with the numbers from the same run you cite.
- Keep it under ~200 lines of prose. Link files and specs by path; do not paste code or diffs, and do
  not turn it into a changelog — `git log` and `todos.md` already carry that.
- If something here is wrong, fix it in the same session you notice; a stale handoff costs every
  following session more than it saves.
