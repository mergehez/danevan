# Test audit — what to test next

**Status:** 429 unit tests (42 files) · 87 browser tests (23 files) · coverage over every source
file **29.1 % statements / 22.8 % branches** · floors enforced in `vitest.config.js` ·
**still a long tail of 0 % files**.

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
Copy as DDL, create database** · **foreign-key peek (relation, usages, empty states)** · **table
comparison (differences, identical filter, breaking changes, Markdown export)** · **the HTTP API
contract (all 54 backend handlers, their input guards and the server/connection/script/settings round
trips)** · **PostgreSQL and SQL Server table lists and row counts** · **tabs (neighbour close, reopen,
close all, drag reorder)** · **SQL editor panels (save modal create/rename, Problems, per-script
History, Format)** · **sidebar management (script create/delete, Collapse all, Clear metadata caches,
collection filter, SQL history modal)** · **mysqldump export from the modal with chosen options**.

---

## Browser tasks (in priority order)

### e2e-12 · Electron shell (medium)
Everything runs in browser-only dev mode, so the shipped shell is untested. Add a Playwright project
using `_electron.launch` against `dist-electron/main.cjs`: the window opens, `window.electronAPI` is
exposed by the preload, and one request/response round-trips through IPC. Needs a second project in
`playwright.config.ts` and a build step.

---

## Unit tasks

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
