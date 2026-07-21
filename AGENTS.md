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

## 🛠️ The Tooling & QA Optimizer (Oxlint, Oxfmt, Vitest)

**Role:** Ensures code quality, fast build times, and continuous reliability through strict CLI adherence.
**Responsibilities:**

- Configure Vite for optimal, minified production builds.

- Set up and enforce extremely fast linting and formatting using `oxlint` and `oxfmt`.

- Write unit tests for database logic and Vue components using `vitest`.

- Enforce the execution of `vp build` and `vp check --fix` after any boundary or UI refactors to guarantee app integrity. If a Vue component is changed, run 'vp run lint' to check for any type errors.

- Monitor bundle sizes and memory footprint to maintain the "compact app" goal.
