<script setup lang="ts">
import { DataGrid, type DataGridTheme, useDataGrid } from '@datagrid';
import { computed, ref } from 'vue';

const colorMode = ref<'ocean' | 'sand'>('ocean');
const rows = ref([
    { id: 1, name: 'Ada Lovelace', city: 'London', status: 'Ready', score: 98 },
    { id: 2, name: 'Grace Hopper', city: 'New York', status: 'Review', score: 93 },
    { id: 3, name: 'Linus Torvalds', city: 'Helsinki', status: 'Draft', score: 88 },
    { id: 4, name: 'Barbara Liskov', city: 'Los Angeles', status: 'Ready', score: 95 },
]);

const columns = ['id', 'name', 'city', 'status', 'score'];

const themes: Record<'ocean' | 'sand', Partial<DataGridTheme>> = {
    ocean: {
        bodyBackground: '#101923',
        headerBackground: '#172433',
        toolbarBackground: '#16222f',
        border: '#2b3b4f',
        focusRing: '#f59e0b',
        buttonBackground: '#1f5c97',
        buttonHoverBackground: '#2a75bf',
        secondaryButtonBackground: '#213243',
        secondaryButtonHoverBackground: '#2a3d50',
    },
    sand: {
        text: '#3f3224',
        mutedText: 'rgba(63, 50, 36, 0.6)',
        bodyBackground: '#f2e6d8',
        headerBackground: '#e8d7c4',
        toolbarBackground: '#eadccc',
        border: '#c9b39d',
        focusRing: '#c35b2d',
        selectedCell: '#dcb893',
        buttonBackground: '#b7613e',
        buttonHoverBackground: '#cb734f',
        buttonText: '#fffaf4',
        secondaryButtonBackground: '#dbc3ac',
        secondaryButtonHoverBackground: '#d1b79e',
        inputBackground: '#fff8f0',
        panelBackground: '#f6eadf',
        panelBackgroundAlt: '#ead8c4',
        panelBorder: 'rgba(99, 74, 49, 0.18)',
        menuBackground: '#fff8f0',
        menuBorder: 'rgba(99, 74, 49, 0.18)',
        menuText: '#3f3224',
        menuItemHoverBackground: 'rgba(195, 91, 45, 0.12)',
        emptyStateBackground: '#f4e8db',
        emptyStateText: 'rgba(63, 50, 36, 0.65)',
    },
};

const state = useDataGrid({
    searchable: true,
    editable: true,
    enableTranspose: true,
    sqlInsertTableName: 'people',
    tableData: computed(() => ({
        columns,
        rows: rows.value,
    })),
    theme: computed(() => themes[colorMode.value]),
    setSourceCellValue: (rowIndex, columnName, nextValue) => {
        const row = rows.value[rowIndex];

        if (!row) {
            return;
        }

        rows.value[rowIndex] = {
            ...row,
            [columnName]: nextValue,
        };
    },
});

function toggleTheme() {
    colorMode.value = colorMode.value === 'ocean' ? 'sand' : 'ocean';
}
</script>

<template>
    <main class="demo-shell">
        <section class="demo-hero">
            <div>
                <p class="demo-eyebrow">Package Demo</p>
                <h1>@danevan/data-grid</h1>
                <p class="demo-copy">Standalone grid package with toolbar slots, editing, transpose mode, and theme overrides driven by public API only.</p>
            </div>

            <div class="demo-actions">
                <button type="button" class="demo-button" @click="toggleTheme">Switch to {{ colorMode === 'ocean' ? 'sand' : 'ocean' }} theme</button>
                <button type="button" class="demo-button demo-button--secondary" @click="state.toggleTranspose?.()">Toggle transpose</button>
            </div>
        </section>

        <section class="demo-grid-card">
            <DataGrid :state="state" has-toolbar>
                <template #title>
                    <div class="demo-toolbar-title">
                        <span>Sample People Table</span>
                    </div>
                </template>
                <template #middle>
                    <div class="demo-toolbar-subtitle">Try search, sorting, inline edit, column menu, and context menu actions.</div>
                </template>
            </DataGrid>
        </section>
    </main>
</template>

<style scoped>
:global(body) {
    margin: 0;
    font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
    background:
        radial-gradient(circle at top left, rgba(245, 158, 11, 0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.16), transparent 30%), #0b1117;
    color: #f8fafc;
}

.demo-shell {
    min-height: 100vh;
    padding: 32px;
    display: grid;
    gap: 20px;
}

.demo-hero {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    align-items: end;
}

.demo-eyebrow {
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 11px;
    opacity: 0.7;
}

.demo-hero h1 {
    margin: 0;
    font-size: clamp(32px, 5vw, 56px);
    line-height: 0.95;
}

.demo-copy {
    margin: 12px 0 0;
    max-width: 760px;
    font-size: 15px;
    line-height: 1.6;
    color: rgba(248, 250, 252, 0.8);
}

.demo-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.demo-button {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: #f59e0b;
    color: #18181b;
    padding: 10px 14px;
    font: inherit;
    cursor: pointer;
}

.demo-button--secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #f8fafc;
}

.demo-grid-card {
    min-height: 65vh;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(8, 12, 18, 0.78);
    backdrop-filter: blur(12px);
    padding: 18px;
}

.demo-toolbar-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.demo-toolbar-subtitle {
    font-size: 12px;
    opacity: 0.72;
}

@media (max-width: 900px) {
    .demo-shell {
        padding: 18px;
    }

    .demo-hero {
        align-items: start;
        flex-direction: column;
    }

    .demo-grid-card {
        min-height: 70vh;
        padding: 10px;
    }
}
</style>
