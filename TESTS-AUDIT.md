# Test Suite Audit — Danevan

Date: 2026-07-02
Scope: every test suite in the repository (Vitest unit/component/integration + Playwright browser).
Goal assessed: **"we can call the app stable if all tests pass."**

---

## 1. Verdict

**No — a green run today is not sufficient evidence that the app is stable.**

Two independent conclusions, both measured:

1. **Reach is too low.** Line coverage is **42.8 %** over the modules the unit tests do load — and
   **49.3 % of application source LOC (23 125 of 46 949 lines) lives in modules that no unit test even
   imports.** 95 of 174 source modules are never loaded by a test.
2. **Green is partly vacuous.** Nine `test.skip` guards turn missing infrastructure into a passing run;
   several tests cannot fail by construction (one has no assertion at all); three of the largest feature
   areas in the product have zero automated coverage in any suite.

What the suites *do* prove is narrow and real: the data-grid engine, the schema-comparison maths, the
connection pool, the SQL script runner and a handful of grid/cell flows are genuinely exercised and
would catch regressions. That is a good foundation — not a stability guarantee.

---

## 2. Inventory

| Suite | Runner | Files | Tests | Status |
|---|---|---|---|---|
| Unit / component / composable | Vitest (jsdom) | 32 | **202** | ✅ 202/202 pass in 2.7 s |
| Browser end-to-end | Playwright (Chromium) | 14 | **57** | ✅ 57/57 pass in 2.4 min *(with a real MySQL, mysqldump, and pre-seeded scripts)* |
| "Integration" (Playwright spec in `tests/integration/`) | **none** | 1 | 4 | ❌ **never executed by any runner** |
| **Total** | | **47** | **259 executable + 4 dead** | |

Config: `vitest.config.js`, `playwright.config.ts`.

**Dead suite.** `src/mainview/tests/integration/modifyTable.spec.ts` is a Playwright spec that
`vitest.config.js:15` excludes (`**/tests/integration/**`) and that falls outside
`playwright.config.ts:6`'s `testDir` (`./src/mainview/tests/e2e`). It duplicates
`tests/e2e/mysqldump-export.spec.ts`. Delete it or move it into `e2e/`.

**Stale script.** `package.json` `release:validate` runs `vitest run --exclude tests/App.real.spec.ts`;
that file does not exist. Worse, `release:validate` **does not run the e2e suite at all**, so the
release path is gated on the 202 unit tests only.

---

## 3. Measured coverage (Vitest, v8 provider)

Reproduce:

```bash
bun add -d @vitest/coverage-v8@4.1.10
node node_modules/vitest/vitest.mjs run --coverage --coverage.provider=v8 \
  --coverage.reporter=text-summary --coverage.reporter=json-summary \
  --coverage.reportsDirectory=.covout
```

| Metric | Covered |
|---|---|
| Statements | **42.32 %** (3 761 / 8 886) |
| Branches | **32.22 %** (1 985 / 6 159) |
| Functions | **43.84 %** (1 075 / 2 452) |
| Lines | **42.77 %** (3 569 / 8 343) |

Those percentages are over the 80 modules the suite *loads*. The real picture is worse:

| | |
|---|---|
| Non-spec source modules | 174 |
| Modules loaded by ≥1 unit test | 80 |
| **Modules never loaded by any unit test** | **95** |
| Source LOC in never-loaded modules | **23 125 / 46 949 = 49.3 %** |

There is **no `test.coverage` block and no threshold** in `vitest.config.js`, so nothing in CI would
notice a regression in any of these numbers.

### Zero-coverage modules that matter most

| Module | LOC | Why it matters |
|---|---|---|
| `src/backend/app.ts` | 1 384 | The entire HTTP API — **57 endpoints** declared in `src/shared/utils/apiMethods.ts`, no contract test |
| `src/backend/usePostgresDriver.ts` | 782 | A whole supported database engine, untested |
| `src/mainview/composables/useForeignKeyPeek.ts` | 773 | Headline navigation feature, untested |
| `src/backend/db-app.ts` | 697 | The app's own SQLite store (servers, connections, settings, sequences) |
| `src/mainview/composables/useDbDataGrid.ts` | 1 148 | Grid menu/action planning |
| `src/mainview/components/DbScripts.tsx` | 683 | SQL editor tabs, save-script, problems, history |
| `src/mainview/components/DbData.tsx` | 664 | Grid panel: custom query, FK peek, DDL, previews |
| `src/mainview/components/DbSidebar.tsx` | 579 | Sidebar tree + script tree |
| `src/mainview/composables/useServerTree.ts` | 557 | Schema/table tree state |
| `src/backend/useSqlServerDriver.ts` | 502 | Another supported engine |
| `src/mainview/components/DbConnectionForm.tsx` | 451 | The add/edit connection and server forms |
| `src/mainview/composables/useGridFormatters.ts` | 355 | Per-column formatters |
| `src/backend/sqlScriptRunner.ts` | 302 | Streaming script execution |
| `src/mainview/components/DbComparisonModal.tsx` | 323 | Comparison UI (the *logic* is tested, the screen is not) |
| `src/electron/*` (main, preload, bridge) | — | Electron entry, IPC bridge, native dialogs, keychain — no coverage at all |
| `src/directives/*` (VTooltip, VContextMenu, ContextMenuPanel) | ~880 | Stubbed as `{}` in every component test |
| `src/shared/utils/useTree.ts`, `useFileTree.ts`, `useKeyboardNavigation.ts` | 710 | Tree and keyboard state machines |

Coverage is also **concentrated**: `DataGrid.spec.ts` (26 tests) + `compareSchemas.spec.ts` (30) +
`useComparison.spec.ts` (13) + `db-tools.spec.ts` (10) = 79 of the 202 unit tests, on four modules.

---

## 4. Test-quality problems

These matter because they break the "if it's green, it works" contract independently of coverage.

### Blockers

1. **A tautological unit spec.** `src/mainview/tests/backend/db-app.spec.ts:38` does
   `vi.mock('../../../backend/db-app', …)` — it replaces the module under test with a hand-written
   in-memory store (~17 of the real ~45 methods) and then asserts against that store. All 6 tests
   (41 assertions) pass against an empty implementation. The real 697-line `db-app.ts` has **zero**
   execution coverage.
2. **An e2e test with no assertion.** `src/mainview/tests/e2e/app.spec.ts:39–61` clicks a button *if it
   happens to be visible* and otherwise takes a screenshot. It cannot fail. Same class:
   `app.spec.ts:86–92` (`if (count > 0) { … }` → no-op when 0) and the `if (collapsed) click` branches
   re-implemented in 6 specs.
3. **Silent skips turn missing infrastructure into green.** Nine guards —
   `mysqldump-export.spec.ts:79,82,85`, `open-table.spec.ts:81,84,125,132`,
   `run-sql-script.spec.ts:104,184` — mean the mysqldump, huge-table and script-runner surfaces can be
   **100 % skipped while the badge is green**. Meanwhile `modify-table.spec.ts:119–153` and
   `modify-table-popup.spec.ts` have *no* guard and **fail** on a clean machine. The suite is
   inconsistent: some features skip, others fail, for the same missing MySQL.
4. **The e2e suite cannot run anywhere but a prepared developer machine.** Six specs hard-code
   `root`/empty-password MySQL at `127.0.0.1:3306` with databases `tirsik3_test` and `wikiferheng`
   (`connections:4–10`, `open-table:6–15`, `modify-table:4–10`, `modify-table-popup:4–10`,
   `mysqldump-export:7–13`, `run-sql-script:8–14`); twelve hard-code the API base
   `http://127.0.0.1:3264/api`; `sql-editor-cursor.spec.ts:25–33` depends on **pre-seeded scripts in the
   developer's live app DB**. There is no container/compose file, no fixture bootstrap, no CI workflow.
   (Empirically: with the app data dir writable the suite is 57/57; with it read-only, 29 fail and 23
   never run — the suite is sensitive to its own environment, with no diagnostic.)
5. **Correctness-free tests.** `DataGrid.spec.ts:1033–1051` asserts only
   `areAllRowsSelected() === true` plus *how many times* `Array.prototype.every` was called — an
   implementation returning a constant `true` passes. Same shape at `:1009–1031` (`indexOf`/`includes`
   call budgets). Perf guards are fine as a *second* assertion, not as the only one.
6. **Source-text tests.** `backend/electronMainEntry.spec.ts:11–15` (three substrings of
   `src/electron/main.ts`) and `lib/monacoBootChunk.spec.ts:26–36` (regex over `monaco.ts` plus a scan
   of every `src` file) assert on file contents, not behaviour. They pass even if the Electron entry
   never boots or the chunk never loads, and they break on harmless reformatting.

### Reliability

7. **60 s global Playwright timeout** (`playwright.config.ts:11`) directly violates AGENTS.md's ≤10 s
   rule, and `retries: CI ? 2 : 0` (`:9`) converts deterministic breakage into a green CI run. Inline
   timeouts of 15–20 s recur (`sql-editor-cursor.spec.ts:25,35,41,45`, `add-row-dialog.spec.ts:41,60,65,74`).
8. **55 `waitForTimeout` calls totalling ~102 s of unconditional sleep** — `app.spec.ts:12,27,44,53,80,100`,
   `modify-table-popup.spec.ts:41,58,63,94,96,151,163,184,203,229,249,286` (seven tests each sleep 3 s at
   startup), `sql-editor-cursor.spec.ts` (8 calls, ~4.5 s). Sleeps both slow the suite and hide races.
9. **Brittle geometry assertions.** `sidebar-sticky.spec.ts:6,75–77,82–84` asserts exact pixel positions
   (`toBeCloseTo(slot * 24, 0)`) and a `::before` background colour; `cell-editor-modal.spec.ts:7–10,76`
   clicks hard-coded grid coordinates; `sql-editor-cursor.spec.ts:88` asserts `top > 18*4`;
   `modify-table-popup.spec.ts:262–274` asserts the entire 11-column order. Any CSS or line-height change
   produces false failures.
10. **Synthetic `dispatchEvent` navigation** in 5 specs (`add-row-dialog:46–47`, `cell-editor:50–51`,
    `cell-editor-modal:50–51`, `grid-search:43–44`, `sql-editor-run:52–53`) bypasses hit-testing — exactly
    the "row is covered and unclickable" class of bug `sidebar-sticky.spec.ts` was written to catch.
11. **`reuseExistingServer: !CI`** (`playwright.config.ts:20`) lets the suite silently test a stale dev
    server; combined with specs that write into the live app DB (metadata caches, SQL history, a scratch
    tab in `sql-editor-cursor.spec.ts` that is never cleaned up) the runs are not hermetic.
12. **`open-table.spec.ts:134`** asserts wall-clock (`listDurationMs < 10_000`) rather than catalog
    behaviour — a timing assertion inside a 60 s-timeout suite.
13. **Leaked globals in unit tests**: `DataGrid.spec.ts:23` (`vi.stubGlobal('navigator')`),
    `:434–437` (`document.execCommand` redefined, never restored), `ListBox.spec.ts:15–18`
    (`HTMLElement.prototype.scrollIntoView` patched, never restored),
    `useCopyTableDdl.spec.ts:55–60` (`vi.stubGlobal` with no `unstubAllGlobals`). These couple tests to
    each other and make order-dependence possible.
14. **Hand-written mocks are not typed against the real contracts.** `db-tools.spec.ts:49–169`,
    `useComparison.spec.ts:23–106`, `useNavState.spec.ts:44–178` build test doubles as plain objects, so a
    changed driver/`useAppDb` signature drifts silently instead of failing to compile.
15. **Flake risk in `DbRunSqlScriptModal.spec.ts:160,180`**: `vi.waitFor` with the default 1 s timeout
    against a 350 ms poll interval (`DbRunSqlScriptModal.tsx:19`) needs ≥2 polls — ~700 ms of budget on a
    loaded worker. Use fake timers + `advanceTimersByTimeAsync`, as `DataGrid.spec.ts` already does.
16. **Backend specs run under jsdom** (`sqlite-query-columns.spec.ts` loads a native `better-sqlite3`
    module in a jsdom environment), and several leak `mkdtemp` directories (`sqlite-query-columns.spec.ts:36–38`,
    `appDbMaintenance.spec.ts:43` removes only the file).
17. **`modify-table.spec.ts` — 18 of the 57 "e2e" tests never open a browser.** They are
    `request`-fixture API tests of `getTableInfo`/`modifyTable`. Useful, but they are mislabelled: AGENTS.md
    requires a *browser* spec per user-facing feature, and the 1 031-line `ModifyTableModal.tsx` gets UI
    coverage from only the 7 tests in `modify-table-popup.spec.ts`.

---

## 5. What is genuinely well covered (keep this)

- **Data grid engine** — `DataGrid.spec.ts` (26 tests, 127 assertions): sorting, reordering, hiding,
  search debounce + navigation, inline/modal editing, clipboard JSON/CSV/SQL/INSERT/SELECT, layout
  persistence, keyboard handling. Real component and real composables; canvas 2D stubbed.
- **Schema comparison logic** — `compareSchemas.spec.ts` (30) + `schemaFix.spec.ts` (7) +
  `comparisonOptions.spec.ts` (6) + `useComparison.spec.ts` (13): pure, unmocked, high-value, includes
  breaking-change classification and fix-action planning.
- **Backend infra** — `remoteDataSourcePool.spec.ts` (pooling, concurrency, dead-connection recycling),
  `remote-driver-tools.spec.ts` (field metadata + estimate-vs-exact row-count policy),
  `appDbMaintenance.spec.ts` (real SQLite), `auth.spec.ts` (keychain caching), `sqlDiagnostics.spec.ts`.
- **Real browser flows that assert on screen state** — `add-row-dialog`, `cell-editor`,
  `cell-editor-modal`, `grid-search`, `sql-editor-run` (asserts the exact SQL payload reaching
  `/api/runQuery` and that draft text survives a reload), `run-sql-script` (confirm dialog names the
  script/size/database, then the finished alert), `connections` (numeric port model, alphabetical
  ordering, error naming, hide-without-confirm).

---

## 6. Coverage gaps by user-facing feature

`✅` = a real browser spec asserts the screen; `🟡` = partial/API-only; `❌` = nothing.

| Feature | E2E |
|---|---|
| Open table, loading panel, estimated row count | ✅ `open-table` |
| Grid search | ✅ `grid-search` |
| Inline cell edit + keyboard | ✅ `cell-editor` |
| Modal cell edit, wrap pref, JSON prettify | ✅ `cell-editor-modal` |
| Add row, NULL columns, pending change + save | ✅ `add-row-dialog` |
| Run SQL from editor, draft across reload | ✅ `sql-editor-run` |
| Run SQL script (menu) confirm + finished alert | ✅ `run-sql-script` |
| Modify table: add/type/undo/redo/move/drag/delete column | ✅ `modify-table-popup` |
| Server **edit** form, connection ordering, error naming, hide DB | ✅ `connections` |
| Sticky sidebar rows | ✅ `sidebar-sticky` |
| Sidebar settings menu + tooltip | ✅ `app` |
| **Add source / add connection form UI** (driver, host, port, user, **password**, file picker) | ❌ — every spec creates servers via `POST /api/createServer` |
| **Keychain / credential storage** | ❌ |
| **Edit row / duplicate row / delete row** | ❌ |
| **Save pipeline: Undo/Redo/Preview/"Disable FK checks"/FK-violation modal** | ❌ (only "Save" is clicked) |
| **Row & cell multi-selection** | ❌ |
| **Grid clipboard copy/paste** | ❌ |
| **Column visibility, pagination, page size, reload** | ❌ |
| **Custom query input** | ❌ |
| **Grid formatters** | ❌ |
| **FK peek (Peek Relation / Peek Usages)** | ❌ |
| **Schema comparison modal UI** (differences-only, breaking changes, export Markdown) | ❌ — logic tested, screen not |
| **Table lifecycle: create table, delete table + confirm, copy as DDL, create database** | ❌ |
| **Multi-tab: close/close others/close all/reopen, drag-reorder** | ❌ |
| **SQL editor: save script modal, Problems tab, History tab, format button, settings** | ❌ |
| **Global SQL history modal** | ❌ |
| **Script tree: create/rename/delete script** | ❌ |
| **Sidebar: clear metadata caches, collapse all, filter, keyboard nav** | 🟡 (menu item visible; action never invoked) |
| **mysqldump export submit path** (options, output, progress) | 🟡 (modal opened, Export never clicked; dump verified only via HTTP) |
| **Electron layer**: IPC bridge, native dialogs, window title, `onNativeCommand` | ❌ (Playwright runs browser-only dev mode) |
| **Disconnect source, refresh metadata, server-schemas modal extras** | 🟡 |
| Toasts / success alerts | ❌ |

---

## 7. What "all tests pass" proves today

If you run `bun run test:ui && bun run test:e2e` on a *prepared* machine and both are green, you know:

- The data-grid engine, comparison maths, connection pool, script runner and ~10 grid/dialog flows behave.

You do **not** know:

- That a user can create a connection at all (the form and the password path are never driven).
- That editing, duplicating or deleting a row works — or that it writes the row you selected.
- That the save/preview/undo pipeline before an UPDATE reaches the database is correct.
- That comparison, FK peek, table creation/deletion, tab management, formatters, pagination, custom
  queries, SQL history or the mysqldump submit path render or work.
- That the Electron shell (the actual shipped product) boots, bridges IPC, or talks to the keychain.

And because of skip guards and vacuous assertions, a *green* run on a *different* machine may have
executed materially fewer tests than the run you looked at.

---

## 8. Getting to "green means stable" — prioritised plan

**Phase 0 — make the signal honest (1–2 days)**

1. Fix `app.spec.ts:39–61` and `:86–92` so they assert something or delete them.
2. Rewrite `backend/db-app.spec.ts` against a real temp SQLite file (the pattern already exists in
   `appDbMaintenance.spec.ts:36–39`) — this alone brings 697 lines of the app's own store under test.
3. Replace the 9 `test.skip` guards with an explicit, failing precondition (or a documented
   `test.describe.skip` with a CI job that runs them), so a missing MySQL cannot masquerade as success.
4. Delete the dead `tests/integration/modifyTable.spec.ts`; drop the stale `App.real.spec.ts` exclusion;
   make `release:validate` run the e2e suite.
5. Add `test.coverage` with thresholds to `vitest.config.js`, and lower `playwright.config.ts` `timeout`
   toward 10 s with per-test opt-outs where justified.
6. Give the e2e suite a bootstrap: a compose/`docker` MySQL fixture (or an env-driven `E2E_MYSQL_URL`)
   that creates `tirsik3_test`/`wikiferheng`-equivalent data, plus a seed step for the scripts
   `sql-editor-cursor.spec.ts` needs. Move the hard-coded API URL into config.

**Phase 1 — cover the data-mutation core (highest risk of silent corruption)**

7. Browser specs for Edit row, Duplicate row, Delete row (+ multi-select), and the full save pipeline
   (Preview modal, Undo/Redo, "Disable FK checks", FK-violation modal), asserting the resulting rows
   through the API exactly as `add-row-dialog.spec.ts` already does.
8. Browser specs for the add/edit **connection + server form**, including a password round-trip.

**Phase 2 — cover the features users live in**

9. Comparison modal UI; FK peek (relation + usages); table lifecycle (create table, delete table with
   confirmation, copy as DDL, create database).
10. Multi-tab management and drag-reorder — the same bug class `sql-editor-run.spec.ts` catches for one tab.
11. Grid toolbar: column visibility, pagination/page size, reload, custom query, formatters.

**Phase 3 — close the logic gaps cheaply (pure functions, fast wins)**

12. Unit tests for `dbDefaultExpression.ts`, `dbColumnDataType.ts`, `collations.ts`, `sqlIdentifiers.ts`
    (these feed the comparison engine that *is* tested), `mergeConflicts.ts`,
    `typeOrmStatementParameters.ts`, `typeOrmMappers.ts`, `useTree.ts`, `useKeyboardNavigation.ts`, and
    the missing `sqlStatements.ts` branches (`"…"` identifiers, `''`/`""`/`` `` `` escapes, unterminated
    block comments).
13. A contract test per `src/shared/utils/apiMethods.ts` group against `src/backend/app.ts` (57 endpoints,
    currently 0 covered) — or at minimum a generated smoke test that asserts every declared method exists
    and rejects bad input.

**Phase 4 — the shipped shell**

14. An Electron-level smoke test (Playwright's `_electron` launcher or a Spectron successor) that boots
    `dist-electron/main.cjs`, asserts the window opens, the preload bridge is exposed, and one
    request/response round-trips through IPC.

---

## 9. Appendix — suite inventory

### Unit / component (Vitest) — 202 tests, 32 files

| File | Tests | Fidelity |
|---|---|---|
| `lib/compareSchemas.spec.ts` | 30 | real, no mocks |
| `tests/dataGrid/DataGrid.spec.ts` | 26 | real logic, canvas stubbed |
| `tests/composables/useComparison.spec.ts` | 13 | real, heavy mocks |
| `tests/backend/db-tools.spec.ts` | 10 | real module, all deps mocked |
| `datagrid/dataGridLayoutStorage.spec.ts` | 10 | real |
| `tests/backend/remote-driver-tools.spec.ts` | 8 | real, IO stubbed |
| `shared/utils/sqlStatements.spec.ts` | 8 | real, no mocks |
| `shared/utils/tsxHelpers.spec.ts` | 7 | real |
| `lib/schemaFix.spec.ts` | 7 | real, no mocks |
| `tests/backend/db-app.spec.ts` | 6 | **mock of the module under test** |
| `tests/backend/remoteDataSourcePool.spec.ts` | 6 | real |
| `lib/comparisonOptions.spec.ts` | 6 | real |
| `tests/composables/useQuery.spec.ts` | 5 | real, deps mocked |
| `tests/composables/useNavState.spec.ts` | 5 | real, 8 deps mocked |
| `tests/backend/appDbMaintenance.spec.ts` | 5 | real + real SQLite |
| `composables/useSqlHistory.spec.ts` | 5 | real |
| `tests/components/CenteredModal.spec.ts` | 4 | real |
| `tests/components/DbRunSqlScriptModal.spec.ts` | 4 | real, tasks mocked (flake risk) |
| `tests/backend/auth.spec.ts` | 4 | real, subprocess mocked |
| `shared/utils/sqlTextNormalization.spec.ts` | 4 | real |
| `tests/composables/useDbCaches.spec.ts` | 3 | real (global `JSON.parse` spy) |
| `tests/composables/useCopyTableDdl.spec.ts` | 3 | real, deps mocked |
| `tests/components/ListBox.spec.ts` | 3 | real |
| `tests/backend/sqlite-query-columns.spec.ts` | 3 | real + real SQLite |
| `tests/backend/sqlDiagnostics.spec.ts` | 3 | real, IO mocked |
| `tests/backend/bunSubprocess.spec.ts` | 3 | real subprocesses (vacuous-pass risk) |
| `tests/composables/useModifyTable.spec.ts` | 2 | real (2 asserts for a 3 417-line module) |
| `tests/components/Checkbox.spec.ts` | 2 | real |
| `tests/components/AppConfirmationModal.spec.ts` | 2 | real |
| `tests/backend/tableListRowCounts.spec.ts` | 2 | real |
| `lib/monacoBootChunk.spec.ts` | 2 | **source text** |
| `tests/backend/electronMainEntry.spec.ts` | 1 | **source text** |

### Browser (Playwright) — 57 tests, 14 files

| File | Tests | Needs |
|---|---|---|
| `e2e/modify-table.spec.ts` | 18 | MySQL `tirsik3_test` (**not a browser test**, unguarded) |
| `e2e/modify-table-popup.spec.ts` | 7 | MySQL `tirsik3_test` (unguarded) |
| `e2e/connections.spec.ts` | 7 | MySQL `tirsik3_test` (degrades silently) |
| `e2e/app.spec.ts` | 6 | — (2 of 6 are no-op) |
| `e2e/mysqldump-export.spec.ts` | 4 | MySQL + `mysqldump` binary (3 skips) |
| `e2e/add-row-dialog.spec.ts` | 2 | temp SQLite |
| `e2e/cell-editor.spec.ts` | 2 | temp SQLite |
| `e2e/cell-editor-modal.spec.ts` | 2 | temp SQLite |
| `e2e/open-table.spec.ts` | 2 | MySQL + `wikiferheng` (4 skips) |
| `e2e/run-sql-script.spec.ts` | 2 | MySQL (2 skips) |
| `e2e/sql-editor-run.spec.ts` | 2 | temp SQLite |
| `e2e/grid-search.spec.ts` | 1 | temp SQLite |
| `e2e/sidebar-sticky.spec.ts` | 1 | temp SQLite |
| `e2e/sql-editor-cursor.spec.ts` | 1 | **pre-seeded scripts in the live app DB** |

### Never executed

| File | Tests |
|---|---|
| `tests/integration/modifyTable.spec.ts` | 4 |
