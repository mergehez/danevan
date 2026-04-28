# @danevan/data-grid

Standalone Vue 3 data grid extracted from Danevan.

It is designed to be app-independent, publishable as an npm package, and themeable without relying on the host application's Tailwind variables or CSS tokens.

## Features

- canvas-rendered grid with large-result focus
- column sorting, hiding, reordering, and width control
- cell, row, and column selection
- inline editing and modal editing flows
- clipboard export helpers for text, JSON, CSV, and SQL
- transpose mode
- theme overrides through `useDataGrid({ theme })`
- public Vue component and composable exports

## Installation

```bash
bun add @danevan/data-grid vue
```

`vue` is a peer dependency.

## Basic Usage

```ts
import { DataGrid, useDataGrid } from '@danevan/data-grid';
import { computed, ref } from 'vue';

const rows = ref([
    { id: 1, name: 'Ada', city: 'London' },
    { id: 2, name: 'Linus', city: 'Helsinki' },
]);

const gridState = useDataGrid({
    searchable: true,
    tableData: computed(() => ({
        columns: ['id', 'name', 'city'],
        rows: rows.value,
    })),
    theme: {
        bodyBackground: '#0f1720',
        headerBackground: '#16212c',
        focusRing: '#f59e0b',
    },
});
```

```vue
<script setup lang="ts">
import { DataGrid } from '@danevan/data-grid';

defineProps<{ state: ReturnType<typeof useDataGrid> }>();
</script>

<template>
    <DataGrid :state="state" has-toolbar />
</template>
```

## Exports

- `DataGrid`
- `useDataGrid`
- `useEditableDataGridState`
- `useDataGridView`
- public grid types
- appearance constants and theme helpers

## Theme Customization

Use the `theme` option in `useDataGrid` to override individual tokens. Any omitted token falls back to the package defaults.

Common overrides include:

- `bodyBackground`
- `headerBackground`
- `border`
- `focusRing`
- `buttonBackground`
- `buttonHoverBackground`
- `menuBackground`
- `menuText`

See [src/dataGridAppearance.ts](src/dataGridAppearance.ts) for the full theme surface.

## Local Demo

Run the package demo locally from the repository root:

```bash
bun run --cwd packages/data-grid demo
```

Build the demo:

```bash
bun run --cwd packages/data-grid demo:build
```

## Package Development

Build the library:

```bash
bun run --cwd packages/data-grid build
```

Run checks:

```bash
bun run --cwd packages/data-grid check
```
