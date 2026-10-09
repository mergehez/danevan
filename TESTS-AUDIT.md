# Test audit — what to test next

**Status:** 379 unit tests (39 files) · 70 browser tests (18 files) · coverage over every source
file **26.0 % statements / 20.8 % branches** · floors enforced in `vitest.config.js` ·
**85 source files still at 0 %**.

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
  `requireMySqlExecutable`, `requireFixtureData(value, message)`, `MYSQL`, `API`.
- Never `test.skip` — call a `require*` precondition so a missing dependency fails loudly.
- No `waitForTimeout`, no inline timeouts. Use `await expect(locator)…` or `await expect.poll(…)`.
- Assert the exact value the user sees. Never `length > 0`, `toBeTruthy()` or a screenshot alone.
- Verify: `bun x playwright test src/mainview/tests/e2e/<file>.spec.ts`, then `bun run test:e2e`.

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
Copy as DDL, create database**.

---

## Browser tasks (in priority order)

### e2e-6 · Foreign-key peek (medium)
`useForeignKeyPeek.ts` (773 lines, 0 % covered) plus `DbData.tsx:500-596`. New `e2e/fk-peek.spec.ts`
on a seeded file source with two related tables: cell menu `Peek Relation` opens a popover with the
referenced row, `Peek Usages` lists the referencing rows, and the popover shows the value it was opened
for. Read the composable for the exact query it issues.

### e2e-7 · Comparison modal (medium)
`DbComparisonModal.tsx` + `useComparison.ts`. The *logic* is well unit-tested; the screen is not. New
`e2e/comparison.spec.ts`: seed two SQLite files differing by a column, open `Compare with…` from the
table menu (`TreeTableRow.tsx:236`), assert the differing row is listed with its direction, that
`Differences only` hides identical rows, that a breaking change is marked, and that `Export Markdown`
produces the report.

### e2e-8 · Tabs (medium)
`DbTabs.tsx`, `DragTabs.tsx`. New `e2e/tabs.spec.ts`: open two scripts, close one and assert the
neighbour becomes active, `Close all`, reopen closed, and drag-reorder then assert the editor content
still matches the tab it was dragged with (the bug class `sql-editor-run.spec.ts` covers for one tab).

### e2e-9 · SQL editor panels (medium)
`DbScripts.tsx` (683 lines): the save-script modal (name/group, create + update), the Problems tab, the
per-script History tab and the Format button. New `e2e/sql-editor-panels.spec.ts` on a seeded script.

### e2e-10 · Sidebar and script tree management (medium)
Script create/rename/delete with confirmation, `Clear metadata caches`, `Collapse all`, the collection
filter, and the global SQL history modal (`DbSidebar.tsx:197-224,459-482,523-527`). New `e2e/sidebar.spec.ts`.

### e2e-11 · mysqldump export submit (medium)
`mysqldump-export.spec.ts` opens the modal but never clicks Export. Extend it: choose options and an
output path, submit, assert the progress state resolves to success and the file exists with the chosen
options applied.

### e2e-12 · Electron shell (medium)
Everything runs in browser-only dev mode, so the shipped shell is untested. Add a Playwright project
using `_electron.launch` against `dist-electron/main.cjs`: the window opens, `window.electronAPI` is
exposed by the preload, and one request/response round-trips through IPC. Needs a second project in
`playwright.config.ts` and a build step.

---

## Unit tasks

### unit-1 · The HTTP API contract (high)
`src/backend/app.ts` — 531 lines at 0 %. `src/shared/utils/apiMethods.ts` declares 57 methods. New
`src/mainview/tests/backend/appApi.spec.ts`: for every declared method assert the handler exists and
that bad input is rejected with the documented message; then real round trips for the server/connection/
script/settings groups against a temp SQLite app DB (pattern: `db-app.spec.ts`).

### unit-2 · PostgreSQL and SQL Server schema helpers (high)
`useMySqlSchemaHelper.getTableNames` is tested (`tableListRowCounts.spec.ts`); the Postgres and SQL Server
equivalents (268 + 146 lines at 0 %) are not. Mirror that spec for both: one catalog query, no `COUNT(*)`,
estimate-vs-exact row counts, views reported as `type: 'view'`.

### unit-3 · `useDbDataGrid.ts` menu and action planning (medium)
493 lines at 0 %; it decides which grid menu items exist and what they do. Unit-test the planning
function directly (row menu for single vs multi selection, cell menu only with a relation, header menu)
rather than through the canvas.

### unit-4 · Directives (medium)
`VTooltip.ts`, `VContextMenu.ts`, `ContextMenuPanel.tsx`, `VError.ts`, `VLoading.ts`,
`directiveModifiers.ts` (~450 lines) are stubbed as `{}` in every component test, so nothing verifies
modifier parsing or positioning. Unit-test modifier parsing against the real directive.

### unit-5 · Tree and keyboard state machines (medium)
`useTree.ts`, `useFileTree.ts`, `useKeyboardNavigation.ts`, `useSidebarKeyboardNavigation.ts`
(~350 lines at 0 %): expand/collapse, keyboard traversal, selection after a delete.

### unit-6 · Monaco SQL completion (medium)
`monacoSqlLanguages.ts` (97 lines at 0 %) resolves referenced tables and qualifiers through
`unquoteSqlIdentifier` — the helper just fixed. Test its table/alias collection and qualifier parsing.

### unit-7 · Small leaf helpers (low, quick)
`sqlEditorDnd.ts` (12), `gridFormatter.worker.ts` (26), `nativePaths.ts` (22), `useMinLifetime.ts` (6),
`confirmAction.ts` (2), `useToast.ts`, `clientExecutables.ts` (22), `msAccessRuntimeManifest.ts` (12),
`sqlScriptRunner.ts` (112).

---

## Everything else still at 0 %

Components exercised only by the browser suite show 0 % *unit* coverage and are fine — do not add unit
tests for them; extend the browser spec instead. Genuinely uncovered and not worth a task yet:
`releaseHelpers.ts` (175), `vite-plugin.ts`, `mainProloadHelpers.ts`, `browserOnlyHelpers.ts`,
`executeCommand.ts`, `electronConfig.ts`, `handleScripts.ts`, `Splitter*.tsx`, `DataTable.tsx`,
`Select.tsx`, `SettingsModal.tsx` (a stub), `loadingIndicatorState.ts`, `appDirectives.ts`.
