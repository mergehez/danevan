# HANDOFF — orientation for a fresh agent

**Maintained by AI agents.** This is the map: what the project is, how a request flows, which state is
fragile, the bug classes this codebase has actually hit, and the traps in the test suites. Read it
before scanning the tree. Update it in the same session that changes the commands, the architecture, a
known failure or the open-task snapshot.

Two files split the job: **this one is orientation**, `todos.md` is the task ledger (what is done, what
is open, and what a green run proves). Git history is the changelog — do not duplicate it here.

_Last verified: 2026-10-12, after the window-lifecycle and packaging-signature fixes (§6.7)._

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
| `src/mainview/` | `App.tsx` (shell), `components/` (`DbSidebar`, `DbTabs`, `DbData`, `DbScripts`, `MonacoEditor`, modals…), `composables/` (all renderer state, see §5), `lib/` (Monaco setup, menus, formatting), `tests/` (unit, components, e2e, electron) |
| `src/datagrid/` | The canvas data grid (`DataGrid.tsx`, `useDataGrid.ts`, navigation, clipboard, layout persistence). Editors are DOM overlays on the canvas. |
| `src/shared/` | Types (`types.ts` — `AppBootstrapApi`, `QueryExecutionResult`, …), components (`Button`, `CenteredModal`, `Splitter`, `ListBox`…), utils (`sqlStatements`, `sqlSourceTable`, `sqlIdentifiers`, `valueFormatting`, `tsxHelpers`, `useCache`…) |
| `src/electron/` | `main.ts` (window + native handlers), `preload.ts` (IPC bridge), `bridge.ts` |
| `src/electronUtils/` | `vite-plugin.ts` (mounts `devServer` in browser mode, auto-generates `apiMethods.ts`, dev ports), `mainviewHelpers.ts` (`createAppClientPpc`), `browserOnlyHelpers.ts`, `releaseConfig.ts`/`releaseHelpers.ts` (release chain, loaded by Node's ESM loader — keep `.ts` extensions there) |
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
| `useSettings` (`useSettings.ts`) | `tabs`, `activeTabHash`, UI prefs | Persisted in `localStorage` via `useCache` under `settings` |
| `useNavState` (`useNavState.ts`) | Tab activation (serialized), per-script-tab runtime state (result panel, problems, history), the selection→tab watcher, closed-tab stack | Tab actions call `activateActiveTab()`; activation retries up to 5× and coalesces |
| `useQuery` (`useQuery.ts`) | **Per tab**: rows, table metadata, selected table, grid SQL, custom query + its source SQL, editor text, result, running flag. **Shared**: `isTableDataStale` | `useQueryForTab(hash)` creates/returns a tab's state; `useQuery()` is a proxy that resolves the active tab on every read/write. Never capture it at setup and assume it is one tab. |
| `useConnections` (`useConnections.ts`) | Per-connection table list, per-table details cache, selection actions | Loaders are keyed and guarded; `ensureTableDetailsBatch` is the batched sweep |
| `useServers`, `useScriptsDb`, `useDbCaches` | Server schemas, script CRUD/selection, persisted tree collapse state | All by explicit id |
| `useGridFormatters` | Custom formatter templates + the **current context** (connection+table) | Context loads are sequence-guarded; the grid loads the context of its own table |
| `useForeignKeyPeek` / `useForeignKeyPeekViews` | The FK peek popover and the peek-view stack | Peek lookups carry a token; views are keyed by id |
| `useComparison`, `useModifyTable`, `useDbDataGrid`, `useResultSourceTable` | Comparison state, Modify Table draft, the grid's behavior/target, the edited table's resolution | `useResultSourceTable` is what names the table an edit is written to |

Panels: `App.tsx` renders `DbData` or `DbScripts` for the active tab's type. `DbData`'s grid target is
`query.loadedConnectionId`; `DbScripts`'s result grid targets
`queryResult.sourceConnectionId` with the table named by `queryResult.sourceSql` through
`src/shared/utils/sqlSourceTable.ts` (which refuses joins, derived tables, set operations and unknown
qualifiers).

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
   other. *Rule:* carry a sequence (or the requested key) and drop stale answers. *Example guards:*
   `dbCoreState.spec.ts`, the sequence counters in `useQuery.ts`/`useComparison.ts`/`useModifyTable.ts`/
   `useGridFormatters.ts`/`useForeignKeyPeek.ts`.
3. **One shared object held every tab's panel state.** `useQuery` was a singleton whose fields were
   copied in and out as tabs activated, so a background run needed hand-rolled routing and a value
   could surface in the wrong tab. *Rule:* per-tab state is keyed by the tab. *Guard:*
   `tab-query-state.spec.ts`.
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
   `src/electronUtils/signMacApp.spec.ts`, `src/electronUtils/installMacApp.spec.ts`, `packaged.spec.ts`
   (the artifact must carry a signature macOS accepts), plus the post-install signature check in
   `releaseHelpers.ts`.

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
- **The grid is a canvas.** Row/cell values are only readable through the in-cell editor
  (`textarea[data-editor-key="<row>:<col>"]`, opened with `Enter`). `data-grid-viewport` can match
  several grids (FK peek) — use `.first()`. `Meta+ArrowLeft` / `Meta+ArrowUp` jump to the row's first
  cell / the column's first row, which is how a test reaches a known cell after an earlier edit.
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
- Unit specs: `vitest.config.js` counts **every** source file (including untested ones) and enforces
  aggregate and per-area floors; raise a floor when you close a gap.

## 8. Current health and open work

Snapshot at the last verification: **1049 unit tests (87 files)**, **122 browser tests (37 files)**,
**14 Electron shell tests** (dev ×12 + packaged ×2), coverage **46.3 % statements / 38.2 % branches** with
the floors green. The full browser suite is 120 passed + the 2 keychain failures above; that green run
also assumes the local MySQL fixtures and the provisioned SQLFluff runtime (T25), so on a fresh machine
the precondition guards will fail loudly instead — read the message, it names what is missing. The
browser suite was not re-run after the last two fixes (unit, dev-shell and packaged suites were).

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
