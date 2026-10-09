# Project Agents

To efficiently build this compact email client;

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
