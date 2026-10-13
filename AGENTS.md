# Project Agents

To efficiently build this compact database client;

## Start here

- **Read `HANDOFF.md` before scanning the tree.** It is the maintained map: what the app is, how a
  request flows, which state is per-tab and which is global, the bug classes this codebase has already
  hit (with the specs that guard them), the traps in the test suites, and the current health snapshot.
- **Maintain it.** Update `HANDOFF.md` in the same session that changes the commands, the architecture,
  a known environment failure or the health snapshot; keep it under ~200 lines and link files instead of
  pasting code. Findings and tasks go to `todos.md`; new recurring patterns become a rule here.

## 🎨 The Frontend Specialist (Vue, Tailwind, Iconify)

- Implement a **dark and light UI** with **compact controls**, **modal-driven workflows**, and **utility-first layout patterns** (Tailwind).

- Keep Vue components presentational whenever possible. Move all reusable behavior into composables or small shared helpers.

- Centralize duplicated menu-building and action-planning logic within the frontend state.

- Integrate the Iconify Vite plugin for dynamic, zero-bloat SVG icon loading. e.g. <span class="icon icon-[mdi--plus]"></span>.

- Use the shared Tailwind theme palette from `src/css/tw.css` as the single source of truth for UI colors. Note that the pallete is defined for both light and dark themes, no need to use 'dark:' variants for colors.

- Avoid rounded borders for sections in the app UI. Rounded shells and controls usually force extra padding and margin, which makes the desktop layout less compact. Use border to separate sections instead of extra spacing, and use sharp corners to keep everything tight. Buttons, controls, dialogs, menus and alerts are exceptions.

- Never use `defineEmits`. Instead define defined callbacks as props (`defineProps`). Because IDE support for `defineEmits` is poor.

- Use `defineModel` for two-way binding of form inputs.

- Use `useTemplateRef` for any DOM element that needs to be accessed in the script. Don't use simple `ref, since it doesn't provide type inference for DOM elements.

- in Vue components, never use '.value' in the `template` for `ref's or `reactive´ values, because it is not needed and breaks the code.

- Use `Splitter` and `SplitterVertical` when a panel is split into two sections.

- Use confirmation modals for delete actions.

- Avoid `overflow-hidden` unless it is genuinely necessary as a last resort.

- Use `v-tooltip` on `IconButton` instances whenever possible to provide text labels for icons.

- Keep `src/App.vue` very simple and delegate all UI logic to components. The main view should be a straightforward reflection of the current app state, with no special cases or one-off logic.

- Avoid creating manual types, instead try to infer them. If needed, use a helper function to create a inferred type.

- Never pass the same prop twice on one element, such as a `{...vModel(state, 'text')}` spread plus an explicit `onChange`. The JSX transform compiles spreads into `mergeProps`, which turns two same-named handlers into an array: the component then throws `props.onChange is not a function` on every change, and the state it was supposed to update silently keeps its old value.

## Tests

- Never set timeouts for tests greater than 10 seconds. If something takes longer, that means it is a bug:
  instead of increasing the timeout, investigate and fix the issue causing the test to take longer than expected.
  Setting huge timeouts makes your work slower and the whole test suite less reliable.
    - Try to use the least possible timeout necessary for the test to pass.
    - When something times out, first check if you added a visibility check for the element you are interacting with.
    - If a really large test really requires a longer timeout, do not blindly set a huge value. Just increase it to the minimum necessary.
- Never blindly add inline timeouts (e.g. `toBeVisible({timeout: 10_000})`). This almost never fixes the real issue.
- Never create temporary tests if a test can be used later. We need to integrate it properly into the test suite
  rather than leaving it as a throwaway or provisional test.
- Every user-facing feature gets a browser spec under `src/mainview/tests/e2e`, however small it is — a new control, a dialog, a field, a public page's behaviour. A server test says the endpoint answers; only the browser says the screen actually draws the control, wires it to that endpoint and shows what came back.
- A test that cannot fail is worse than no test, because it reports safety it does not provide. Never assert
  `length > 0`, "is defined", "does not throw", or take a screenshot as the only check; never branch on
  `if (await locator.isVisible())` so the assertions can be skipped. Assert the value the user would see.
- Never mock the module under test. `vi.mock('.../the-module', ...)` plus assertions on that mock only tests
  the mock — see `backend/db-app.spec.ts`, which for months validated a hand-written reimplementation while
  the real 697-line store had zero coverage. Reach for a real temp SQLite file, a real subprocess or a real
  component instead; mock only the process/network boundary.
- Never let a missing dependency turn into a pass. A spec that needs MySQL, a binary or seeded fixture calls
  a precondition from `src/mainview/tests/e2e/helpers.ts` that FAILS with an actionable message
  (`E2E_SKIP_MISSING_DB=1` is the single, explicit opt-out). A green run must mean the specs really ran.
- Assert on user-visible state, not on geometry or wall-clock time. Pixel offsets, hard-coded click
  coordinates and `expect(duration).toBeLessThan(...)` break on unrelated CSS changes and hide nothing.
- Drive the UI the way a user does. Synthetic `dispatchEvent(new MouseEvent(...))` bypasses hit-testing, so
  it cannot see the "row is covered and unclickable" class of bug it is supposed to catch.
- Share the setup, do not copy it. `post`, the API base URL and the MySQL/file-source fixtures live in
  `src/mainview/tests/e2e/helpers.ts`; six copies of a skip guard is how they drifted into disagreeing.
- Measure coverage, don't assume it. `bun run test:coverage` counts every source file and fails below the
  thresholds in `vitest.config.js`; raise them when you close a gap. Untested modules that no spec imports
  are invisible to a "green" badge.

## Git

- After finishing a task, commit the changes with clear and descriptive messages.
    - No batch commits; each commit should represent a single logical change unless it requires too much hunting
      for related changes.
    - No huge commit messages; max 72 characters. If you need to provide more details, include them in the body
      of the commit message.
    - Use imperative mood in commit messages (e.g. "fix bug" instead of "fixed bug" or "fixes bug").
    - Avoid vague commit messages like "update" or "changes"; be specific about what was changed and why.

## Comments

- Do not write huge comments; keep them concise and relevant to the code they describe. My experience shows that
  AI agents tend to write overly verbose comments if not guided properly.

## Suggest new rules

- when you notice a recurring pattern or issue in the codebase that could benefit from a new rule, document it here with a short and clear explanation and rationale.

Suggested from the 2026-10-09 performance audit (tasks in `todos.md`):

- **Never run one query per item.** Table lists, metadata sweeps and counts come from one catalog query or
  one batched call, never a `COUNT(*)`/metadata query per table. Each per-item query costs a round trip and,
  on InnoDB/Access/SQLite, a scan: a 23-table 30 GB schema took 58 s to list and 19 s to open a single table.
- **Never open a connection or read the keychain per request.** Keep a session-pooled connection per data
  source and cache credentials in-process, invalidating on edit/disconnect. Measured: 20 ms of overhead per
  backend call (16 ms of it a `security` process spawn), plus one server session per request.
- **Never fan out one IPC/backend request per item from the UI.** Comparison, autocomplete and FK peek ask
  the backend once for a list of tables instead of once per table: 163 tables currently mean 163 requests,
  each opening its own connection.
- **Do not deep-watch and synchronously persist large, frequently mutated state.** A `deep: true` watcher
  plus `localStorage.setItem(JSON.stringify(state))` over grid rows, per-table metadata or draft SQL blocks
  the main thread on every keystroke; scope the key per entity, debounce, cap the size and handle quota errors.
- **Show progress and failure where the result will appear.** If an action can take a second or more (table
  list hydration, a large load), the panel that will show the result renders its own loading/error state —
  the small global corner indicator reads as "nothing happened".

Suggested from the 2026-10-10 `bun do mac` failure:

- **A relative import in the release chain keeps its `.ts` extension.** `electron-builder` loads
  `electron.config.js` through Node's ESM loader (`electronConfig.ts` → `helpers.ts` → …), and that
  loader resolves extensions itself: `./x` is not `./x.ts`. An extensionless import there passes
  every unit test, every browser test and `vite build` (all of which resolve it), then fails
  `bun do mac` before it packages anything — which is how the API error message helper broke the
  release. `src/mainview/tests/backend/releaseConfig.spec.ts` loads the config in a real Node process, so the
  next one fails in the unit suite instead.

Suggested from the 2026-10-12 wrong-table save:

- **Name a row's table from the statement that produced it, never from the columns.** The result grid
  used to pick the first cached table whose primary key appeared in the result, so `select * from
  people` on a schema that also holds `accounts (id, …)` staged `UPDATE "accounts" …`; the data tab's
  custom query used the table open in the sidebar instead. Carry the executed statement with the rows
  (`QueryExecutionResult.sourceSql`), resolve it with `src/shared/utils/sqlSourceTable.ts` — which
  refuses joins, derived tables, set operations and unknown qualifiers — and refuse the edit when no
  single table can be named: writing to the wrong table is silent data loss. Guarded by
  `src/mainview/tests/e2e/result-save-target.spec.ts`.

Suggested from the 2026-10-12 stale-context audit:

- **An action names its target; it never reads the selection.** A panel, tab, modal or row action must
  pass the connection/server/table/file it was opened for. Reading `connections.selectedConnectionId`,
  `servers.selectedServerId` or `query.selectedTableName` at click time is how a script ran on another
  connection, a grid saved into another database and a comparison ALTERed another schema — the sidebar
  selection can move without the open tab moving.
- **A response is applied only while its context is still current.** Every async load that writes shared
  state carries a sequence (or the key it was requested for) and drops its result when a newer request
  started, the tab/table/connection changed, or the popover closed; otherwise the last response to
  arrive wins instead of the last action the user took. `loadSelectedTable`, `loadComparison`,
  `loadContext`, `openFkPeek` and `openModal` in this tree are the existing examples.
- **Per-tab state is keyed by the tab, never swapped through one shared object.** `useQuery` used to be a
  singleton whose fields were copied in and out as tabs activated, so a value written for one tab could
  surface in another; it is now one state per tab (`useQueryForTab`) behind a proxy that resolves the
  active tab (`useQuery()`), with the editor text seeded once on first open. A new panel field goes into
  that per-tab state (or the component), and a background run writes its own tab's state instead of a
  global that the active tab reads. Guarded by `src/mainview/tests/e2e/tab-query-state.spec.ts`.
- **A whole-state snapshot is versioned, not trusted.** The renderer applies a bootstrap only when the
  backend's `version` is newer, so a slow mutation response cannot revert a selection made after it.
  Adding a field to `AppBootstrapApi` means adding it to `buildBootstrap`; never apply a snapshot on
  arrival alone. Guarded by `src/mainview/tests/composables/dbCoreState.spec.ts`.

Suggested from the 2026-10-12 electronUtils reconciliation:

- **`src/electronUtils` is project-agnostic and byte-identical in every app that uses it.** The folder is
  copied between projects unchanged, so app-specific behaviour arrives through its options
  (`nativeStandins`, `classifyError`, `runInRequestScope`, `fileExists`, `loadBackend`), through
  `package.json` via `appConfig` (name, ports, `APP_DATA_DIR`), or through an app-owned script outside the
  folder. Never branch on the app's name or hardcode one in it; keep its specs out of the folder so the
  copies stay identical. `gitvan/src/electronUtils` is the reference copy.

Suggested from the 2026-10-12 "the app quits immediately" report:

- **A packaged macOS app is signed, ad-hoc if need be — otherwise its helper processes cannot sandbox.**
  `electronConfig` packs with `mac.identity: null`, so nothing signed the bundle, and packaging renames
  `Electron Helper*.app` to `Danevan Helper*.app`, which invalidates the signatures Electron ships with.
  macOS then refuses the helpers the `com.apple.security.inherit` sandbox, the GPU process crash-loops,
  and Chromium aborts the whole app about a second after launch
  (`FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.`): the window stays white
  and the app disappears. A *white* window that then exits is a signing problem, not a lifecycle one —
  `afterPack` calls `signMacApp.ts`, guarded by its spec and by `packaged.spec.ts`. Check this before
  suspecting the window code when a user reports a Danevan that will not start.
- **Copy a signed bundle with `ditto`, never `fs.cp`.** A signature seals the bundle's layout and the
  framework's symlinks are part of it: `fs.cp` resolves `Versions/Current/Electron Framework` into an
  absolute path into the build directory, macOS then reports "unsealed contents present in the root
  directory of an embedded framework", and the *installed* app fails exactly like an unsigned one even
  though the build was signed. `installMacApp.ts` does the copy and `releaseHelpers.ts` re-checks the
  installed signature, so a broken install fails the release instead of the user's next launch.

Suggested from the 2026-10-13 grid-state reports (custom query refused, tabs losing state, dead display switch):

- **A reload shows what the panel was showing.** A table load that restores an active custom query
  re-runs that query instead of leaving the base rows under the custom text, and a save in custom
  mode (or on a script result that is a plain select) refreshes from the same statement it displayed.
  Showing other rows than the query names is how edits landed on rows the user never saw. Guarded by
  `src/mainview/tests/e2e/tab-grid-state.spec.ts` and `result-save-target.spec.ts`.
- **One shared grid parks per-tab view state; it never resets on a tab switch.** Pending edits,
  inserted/deleted rows, the active cell and the selection are stashed under the leaving tab's key
  (`useDbDataGrid`'s `stateKey`) with the row identity they were staged on, and restored only while
  the grid still shows those rows — changed rows drop the stash, or an edit would attach to the
  wrong row. A switch that unmounts the panel (table to script or back) parks on scope dispose
  under the last-seen key instead, and a remount's viewport sync re-ensures the restored cell.
  Guarded by `tab-grid-state.spec.ts` and
  `src/mainview/tests/composables/useDbDataGrid.spec.ts`.
- **Painted text state joins the render version.** The canvas caches formatted text per render
  version and redraws off it, so a layout change that alters no row (a display-type switch) must be
  part of the version — otherwise the stored value updates, the search index rebuilds, and the
  screen still shows the old text with no feedback. Guarded by
  `src/mainview/tests/e2e/display-type-timestamp.spec.ts` (viewport pixels plus search).
- **A resolver that matches against a lazily-loaded list ensures the list first.** `useResultSourceTable`
  names the table against the connection's table list, which a script tab never loads on its own; it
  now ensures the list instead of refusing a real table as unknown.


