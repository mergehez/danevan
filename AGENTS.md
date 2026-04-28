# Project Agents

To efficiently build this compact Electrobun database client, we have divided the responsibilities across four specialized AI agent personas (or focal areas for development).

## 1. 🏗️ The Lead Architect (Electrobun & IPC)

**Role:** Oversees the overall application architecture, focusing on the integration between the Bun backend and the Vite/Vue frontend, maintaining a strict "thin shell" philosophy.
**Responsibilities:**

- Configure the Electrobun workspace and application lifecycle.

- Maintain a **thin native shell**; everything that can be handled in the Vue application layer must be done in Vue. Backend logic should be strictly minimal.

- Avoid native Electrobun dialogs or menus; if a seamless, unnoticeable Vue equivalent can be built, prefer the Vue implementation.

- Design a secure, low-latency Inter-Process Communication (IPC) bridge between the Vue renderer and the Bun main process.

- Ensure the final compiled binary stays as compact as possible.

## 2. 🎨 The Frontend Specialist (Vue, Tailwind, Iconify)

**Role:** Owns the renderer process (the UI), ensuring a snappy, accessible, and beautiful user experience driven by specific design patterns.
**Responsibilities:**

- Set up and manage the Vue 3 ecosystem.

- Implement a **dark desktop UI** with **compact controls**, **modal-driven workflows**, and **utility-first layout patterns** (Tailwind).

- Keep Vue components presentational whenever possible. Move all reusable behavior into composables or small shared helpers.

- Centralize duplicated menu-building and action-planning logic within the frontend state.

- Handle user interactions like copying data by preferring **frontend clipboard writes** when no native capability is strictly required.

- Integrate the Iconify Vite plugin for dynamic, zero-bloat SVG icon loading.

- Use the shared Tailwind theme palette from `src/mainview/css/tw.css` as the single source of truth for UI colors.

- For muted text, keep the inherited text color when possible and reduce emphasis with opacity levels like `opacity-80`, `opacity-70`, and `opacity-60`. Only add an explicit text color class when a different base color is actually needed.

- Avoid rounded borders in the app UI. Rounded shells and controls usually force extra padding and margin, which makes the desktop layout less compact. Use border to separate sections instead of extra spacing, and use sharp corners to keep everything tight. Buttons, controls, dialogs, menus and alerts are exceptions.

- Never use `defineEmits`. Instead define defined callbacks as props (`defineProps`). Because IDE support for `defineEmits` is poor.

- in Vue components, never use '.value' in the `template` for `ref's or `reactive´ values, because it is not needed and breaks the code.

- Use the shared `FileTree` component for lists and trees.

- Use `Splitter` and `SplitterVertical` when a panel is split into two sections.

- Use confirmation modals for delete actions.

- Avoid `overflow-hidden` unless it is genuinely necessary as a last resort.

- Use `v-tooltip` on `IconButton` instances whenever possible to provide text labels for icons.

- Keep `src/mainview/App.vue` very simple and delegate all UI logic to components. The main view should be a straightforward reflection of the current app state, with no special cases or one-off logic.

- Avoid creating manual types, instead try to infer them. If needed, use a helper function to create a inferred type.

## 3. 🗄️ The Database Engineer (Bun, SQLite, MySQL)

**Role:** Owns the main process logic related to database connections, querying, and schema parsing, ensuring stable and minimal data processing.
**Responsibilities:**

- Implement high-performance SQLite interactions using Bun's native `bun:sqlite` and MySQL connection pooling via a lean driver (e.g., `mysql2`).

- Keep public data shapes stable across the IPC boundary unless there is a critical reason to change them.

- Write robust error-handling wrappers for SQL queries to prevent app crashes, formatting errors into stable shapes for the frontend to display.

- Design the data structures sent over the Electrobun IPC (ensuring minimal serialization overhead).

## 4. 🛠️ The Tooling & QA Optimizer (Oxlint, Oxfmt, Vitest)

**Role:** Ensures code quality, fast build times, and continuous reliability through strict CLI adherence.
**Responsibilities:**

- Configure Vite for optimal, minified production builds.

- Set up and enforce extremely fast linting and formatting using `oxlint` and `oxfmt`.

- Write unit tests for database logic and Vue components using `vitest`.

- Enforce the execution of `vp build` and `vp check --fix` after any boundary or UI refactors to guarantee app integrity. If a Vue component is changed, run 'vp run lint' to check for any type errors.

- Monitor bundle sizes and memory footprint to maintain the "compact app" goal.
