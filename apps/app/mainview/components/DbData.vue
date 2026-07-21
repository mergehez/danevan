<script setup lang="ts">
import DbGridToolbar from '@components/DbGridToolbar.vue';
import DbSaveBar from '@components/DbSaveBar.vue';
import MonacoEditor from '@components/MonacoEditor.vue';
import { useConnections } from '@composables/useConnections';
import { useDbDataGrid } from '@composables/useDbDataGrid';
import { useDbSettings } from '@composables/useDbSettings';
import { formatUsageRelationColumns, isFkPeekRowsView, isFkUsageListView, useForeignKeyPeekViews, type FkPeekRowsView } from '@composables/useForeignKeyPeek';
import { useQuery } from '@composables/useQuery';
import { useServers } from '@composables/useServers';
import { DataGrid, useEditableDataGridState, type EditableDataGridState } from '@datagrid';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import IconButton from '@ui/IconButton.vue';
import Popover from '@ui/Popover.vue';
import type { SqlValue } from '@utils/appClient';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { formatValue } from '@utils/valueFormatting';
import { computed, effectScope, onBeforeUnmount, ref, watch, type EffectScope } from 'vue';

const settings = useDbSettings();
const connections = useConnections();
const query = useQuery();
const servers = useServers();

const PAGE_SIZE_OPTIONS = [10, 100, 250, 500, 1000, 2000, -1] as const;
const DEFAULT_PAGE_SIZE = 500;

const isUnlimitedDataLimit = computed(() => settings.state.queryRowLimit < 0);
const selectedDataLimit = computed(() => (isUnlimitedDataLimit.value ? -1 : settings.state.queryRowLimit));
const currentPageLimit = computed(() => query.tableData?.limit ?? settings.state.queryRowLimit);
const currentPageOffset = computed(() => query.tableData?.offset ?? 0);
const currentPageRowCount = computed(() => query.tableData?.rows.length ?? 0);
const totalRowCount = computed(() => query.tableData?.rowCount ?? 0);
const pageRangeStart = computed(() => (currentPageRowCount.value > 0 ? currentPageOffset.value + 1 : 0));
const pageRangeEnd = computed(() => (currentPageRowCount.value > 0 ? currentPageOffset.value + currentPageRowCount.value : 0));
const canGoToPreviousPage = computed(() => currentPageOffset.value > 0 && !isLoading.value);
const canGoToNextPage = computed(() => !isLoading.value && !isUnlimitedDataLimit.value && pageRangeEnd.value < totalRowCount.value);
const pageSizeMenuOptions = computed(() =>
    PAGE_SIZE_OPTIONS.map((value) => ({
        value,
        label: value < 0 ? 'All' : String(value),
        isDefault: value === DEFAULT_PAGE_SIZE,
    }))
);

async function applyDataLimit(limit: number) {
    await settings.setQueryRowLimit(limit);

    const connId = connections.selectedConnectionId;
    if (connId && query.selectedTableName) {
        await query.loadSelectedTable(connId, query.selectedTableName, { offset: 0, orderBy: orderBy.value });
    }
}

async function selectPageSize(limit: number) {
    await applyDataLimit(limit);
}

function toggleColumnVisibility(columnName: string) {
    const isHidden = dataGridState.hiddenColumns.includes(columnName);

    if (isHidden) {
        dataGridState.showColumn(columnName);
    } else {
        dataGridState.hideColumn(columnName);
    }
}

async function goToPreviousPage() {
    if (!canGoToPreviousPage.value) {
        return;
    }

    const connId = connections.selectedConnectionId;
    const nextOffset = Math.max(0, currentPageOffset.value - Math.max(currentPageLimit.value, 1));
    if (connId && query.selectedTableName) {
        await query.loadSelectedTable(connId, query.selectedTableName, { offset: nextOffset, orderBy: orderBy.value });
    }
}

async function goToNextPage() {
    if (!canGoToNextPage.value) {
        return;
    }

    const connId = connections.selectedConnectionId;
    const nextOffset = currentPageOffset.value + Math.max(currentPageLimit.value, 1);
    if (connId && query.selectedTableName) {
        await query.loadSelectedTable(connId, query.selectedTableName, { offset: nextOffset, orderBy: orderBy.value });
    }
}

const fkPeekViews = useForeignKeyPeekViews({
    selectedConnectionId: computed(() => connections.selectedConnectionId),
    selectedTableName: computed(() => query.selectedTableName),
    ensureTableDetails: (connectionId, tableName) => connections.ensureTableDetails(connectionId, tableName),
    getTableInfo: (connectionId, tableName) => connections.getTableDetailsState(connectionId, tableName).info,
    getSqlDialect: (connectionId) => {
        const connection = connections.connections.find((entry) => entry.id === connectionId);
        const server = servers.servers.find((entry) => entry.id === connection?.server_id);
        return server?.driver || 'sqlite';
    },
});
const sqlDialect = computed(() => {
    const connection = connections.connections.find((entry) => entry.id === connections.selectedConnectionId);
    const server = servers.servers.find((entry) => entry.id === connection?.server_id);
    return server?.driver || 'sqlite';
});

const dataGridState = useDbDataGrid({
    connectionId: () => connections.selectedConnectionId!,
    emptyText: () => `Select a table to preview${isUnlimitedDataLimit.value ? '' : ` up to ${settings.state.queryRowLimit} rows`}.`,
    onPeekRelation: async (params) => {
        await fkPeekViews.openPeekView({
            connectionId: params.connectionId,
            relation: params.relation,
            value: params.value,
            event: params.event,
        });
    },
    onPeekUsages: async (params) => {
        await fkPeekViews.openUsagePeekView({
            connectionId: params.connectionId,
            tableName: params.tableName,
            columnName: params.columnName,
            rowValues: params.rowValues,
            event: params.event,
        });
    },
    tableData: () => query.tableData,
    tableInfo: () => query.tableInfo,
    tableName: () => query.selectedTableName,
});

const visibleColumnNames = computed(() => {
    const allCols = dataGridState.allColumns;
    const hidden = new Set(dataGridState.hiddenColumns);
    return allCols.filter((c: string) => !hidden.has(c));
});

const allColumnsVisible = computed(() => visibleColumnNames.value.length === dataGridState.allColumns.length);

const tableColumns = computed(() => query.tableInfo?.columns ?? []);
const addRowFormState = ref<Record<string, string>>({});

watch(
    () => [dataGridState.isAddRowDialogOpen, dataGridState.isEditRowDialogOpen],
    () => {
        if (dataGridState.isAddRowDialogOpen || dataGridState.isEditRowDialogOpen) {
            // Initialise form from the dialog values (empty for new row,
            // prefilled for duplicate / edit).
            addRowFormState.value = Object.fromEntries(tableColumns.value.map((col) => [col.name, String(dataGridState.addRowDialogValues[col.name] ?? '')]));
        }
    }
);

function commitAddRow() {
    if (!dataGridState.isAddRowDialogOpen) return;

    const values: Record<string, SqlValue> = {};
    for (const col of tableColumns.value) {
        const raw = addRowFormState.value[col.name]?.trim() ?? '';
        values[col.name] = raw === '' && col.isAutoIncrement ? null : raw;
    }

    dataGridState.commitAddRow(values);
}

function commitEditRow() {
    if (!dataGridState.isEditRowDialogOpen) return;

    const values: Record<string, SqlValue> = {};
    for (const col of tableColumns.value) {
        const raw = addRowFormState.value[col.name]?.trim() ?? '';
        values[col.name] = raw === '' && col.isAutoIncrement ? null : raw;
    }

    dataGridState.commitEditRow(values);
}

/** Tracks whether the user has manually edited the custom query text.
 *  When true, auto-sync is suppressed so the user's edits are preserved. */
const isQueryManuallyEdited = ref(false);
/** Guards the customQueryText watcher so it can distinguish our own writes
 *  from user edits. */
let isAutoSyncingQuery = false;

const currentSort = computed(() => dataGridState.sortState);
const orderBy = computed(() => {
    const sort = currentSort.value;
    if (!sort) return undefined;
    return { column: sort.columnName, direction: sort.direction === 'asc' ? 'ASC' : 'DESC' } as const;
});

const defaultTableQuery = computed(() => {
    const tableName = query.selectedTableName;

    if (!tableName) {
        return '';
    }

    const identifier = quoteSqlIdentifier(tableName, sqlDialect.value);
    const cols = allColumnsVisible.value
        ? '*'
        : visibleColumnNames.value.length
          ? visibleColumnNames.value.map((c: string) => quoteSqlIdentifier(c, sqlDialect.value)).join(', ')
          : '*';
    const orderClause = orderBy.value ? ` order by ${quoteSqlIdentifier(orderBy.value.column, sqlDialect.value)} ${orderBy.value.direction}` : '';
    const limitClause = isUnlimitedDataLimit.value ? '' : ` limit ${settings.state.queryRowLimit}`;
    return `select ${cols} from ${identifier}${orderClause}${limitClause};`;
});

watch(
    () => [query.selectedTableName, settings.state.queryRowLimit, visibleColumnNames.value.join(','), currentSort.value],
    () => {
        // Only auto-sync if the user hasn't manually edited the query
        if (query.selectedTableName && !query.isCustomQueryMode && !isQueryManuallyEdited.value) {
            isAutoSyncingQuery = true;
            query.customQueryText = defaultTableQuery.value;
            isAutoSyncingQuery = false;
        }
    },
    { immediate: true }
);

// Detect manual edits to the custom query text
watch(
    () => query.customQueryText,
    () => {
        if (!isAutoSyncingQuery && query.selectedTableName && !query.isCustomQueryMode) {
            isQueryManuallyEdited.value = true;
        }
    }
);

// Reload data when the sort column or direction changes (skip initial
// trigger to avoid double-loading when the grid hydrates cached sort state).
watch(
    () => currentSort.value,
    (newSort, oldSort) => {
        if (!oldSort && !newSort) return;
        if (oldSort?.columnName === newSort?.columnName && oldSort?.direction === newSort?.direction) return;

        const connId = connections.selectedConnectionId;
        if (connId && query.selectedTableName && !query.isCustomQueryMode) {
            isQueryManuallyEdited.value = false;
            void query.loadSelectedTable(connId, query.selectedTableName, { offset: 0, orderBy: orderBy.value });
        }
    }
);

// Reset the manual-edit flag when the user navigates to a different table
watch(
    () => query.selectedTableName,
    () => {
        isQueryManuallyEdited.value = false;
    }
);

const peekGridScopes = new Map<string, EffectScope>();
const peekGridStates = new Map<string, EditableDataGridState>();

function handlePeekViewUpdateOpen(viewId: string, open: boolean) {
    console.log('[DbData] Popover updateOpen', {
        viewId,
        open,
        activeIds: fkPeekViews.peekViews.map((view) => view.id),
    });

    if (!open) {
        fkPeekViews.closePeekViewsFrom(viewId);
    }
}

function createPeekGridState(view: FkPeekRowsView) {
    const scope = effectScope();
    const result = scope.run(() =>
        useEditableDataGridState({
            columns: computed(() => view.columns),
            rows: computed(() => view.rows),
            columnStats: computed(() => view.columnStats),
            searchable: false,
            transposeState: fkPeekViews.getPeekViewTransposeState(view),
            defaultTransposed: true,
            getTransposeColumnName: (rowIndex, total) => (total === 1 ? 'Value' : `Row ${rowIndex + 1}`),
            emptyText: computed(() => (view.loading ? 'Loading relation…' : view.errorMessage || 'No related row found.')),
            formatValue: (value) => formatValue(value),
            cellContextMenuItems: (context) => fkPeekViews.buildPeekContextMenuItems(view, context),
        })
    );

    if (!result) {
        scope.stop();
        throw new Error(`Failed to create editable grid state for peek view ${view.id}`);
    }

    peekGridScopes.set(view.id, scope);
    peekGridStates.set(view.id, result.state);
}

function ensurePeekGridState(view: FkPeekRowsView) {
    const existing = peekGridStates.get(view.id);

    if (existing) {
        return existing;
    }

    createPeekGridState(view);
    return peekGridStates.get(view.id)!;
}

function cleanupRemovedPeekGridStates(activeIds: string[]) {
    const activeIdSet = new Set(activeIds);

    for (const [id, scope] of peekGridScopes) {
        if (activeIdSet.has(id)) {
            continue;
        }

        scope.stop();
        peekGridScopes.delete(id);
        peekGridStates.delete(id);
    }
}

watch(
    () => fkPeekViews.peekViews.map((view) => view.id),
    (ids) => {
        for (const view of fkPeekViews.peekViews) {
            if (!isFkPeekRowsView(view) || peekGridStates.has(view.id)) {
                continue;
            }

            if (!peekGridStates.has(view.id)) {
                createPeekGridState(view);
            }
        }

        cleanupRemovedPeekGridStates(ids.filter((id) => fkPeekViews.peekViews.some((view) => view.id === id && isFkPeekRowsView(view))));
    },
    { immediate: true }
);

const isLoading = computed(() => query.isLoadingTables || query.isLoadingSelectedTable);

onBeforeUnmount(() => {
    for (const scope of peekGridScopes.values()) {
        scope.stop();
    }

    peekGridScopes.clear();
    peekGridStates.clear();
});
</script>

<template>
    <section class="min-h-0 flex-1 flex flex-col overflow-auto" id="dbdatapanel">
        <DbSaveBar
            :pending-change-count="dataGridState.pendingChangeCount"
            :can-undo="dataGridState.canUndo"
            :can-redo="dataGridState.canRedo"
            :is-saving-changes="dataGridState.isSavingChanges"
            :save-button-label="dataGridState.saveButtonLabel"
            :supports-foreign-key-check-toggle="dataGridState.supportsForeignKeyCheckToggle"
            :disable-foreign-key-checks="dataGridState.disableForeignKeyChecks"
            :on-clear-changes="dataGridState.clearChanges"
            :on-undo-changes="dataGridState.undoChanges"
            :on-redo-changes="dataGridState.redoChanges"
            :on-preview-changes="dataGridState.openPreview"
            :on-save-changes="dataGridState.saveChanges"
            :on-set-disable-foreign-key-checks="dataGridState.setDisableForeignKeyChecks"
        />

        <div class="relative min-h-0 flex-1 flex flex-col overflow-auto">
            <div v-if="isLoading" class="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-x1/65 backdrop-blur-[1px]">
                <div class="border border-x4 bg-x2 px-3 py-2 text-xs text-reverse">Loading table data...</div>
            </div>

            <div v-if="query.selectedTableName" class="flex items-center gap-2 border-b border-x4 bg-x0 px-2 py-1">
                <div class="flex-1 min-w-0">
                    <input
                        v-model="query.customQueryText"
                        class="w-full border border-x4 bg-x1 px-2 py-1 text-xs font-mono outline-none transition focus:border-x5"
                        placeholder="select * from myTable limit 100;"
                        @keydown.enter.prevent="query.runCustomQuery"
                    />
                </div>
                <IconButton
                    icon="icon-[mdi--play]"
                    v-tooltip.xs.nowrap="'Run query'"
                    smaller
                    severity="primary"
                    :disabled="!query.customQueryText.trim() || query.isRunningQuery"
                    @click="query.runCustomQuery"
                />
                <IconButton
                    v-if="query.isCustomQueryMode"
                    icon="icon-[mdi--backup-restore]"
                    v-tooltip.xs.nowrap="'Reset to table view'"
                    smaller
                    severity="secondary"
                    @click="query.clearCustomQuery"
                />
            </div>
            <div :class="isLoading ? 'pointer-events-none opacity-60' : ''" class="h-full w-full flex flex-col overflow-auto">
                <DataGrid :state="dataGridState" :has-toolbar="true" :with-checkboxes="false">
                    <template #title>
                        <DbGridToolbar
                            :grid-state="dataGridState"
                            :title="query.selectedTableName || 'Select a table'"
                            :is-loading="isLoading"
                            :show-page-nav="true"
                            :page-range-start="pageRangeStart"
                            :page-range-end="pageRangeEnd"
                            :total-row-count="totalRowCount"
                            :can-go-to-previous-page="canGoToPreviousPage"
                            :can-go-to-next-page="canGoToNextPage"
                            :on-go-to-previous-page="goToPreviousPage"
                            :on-go-to-next-page="goToNextPage"
                            :page-size-menu-options="pageSizeMenuOptions"
                            :selected-data-limit="selectedDataLimit"
                            :on-select-page-size="selectPageSize"
                            :on-add-row="dataGridState.openAddRowDialog"
                            :on-reload="
                                () => {
                                    const c = connections.selectedConnectionId;
                                    const t = query.selectedTableName;
                                    if (c && t) query.loadSelectedTable(c, t, { offset: 0 });
                                }
                            "
                            @toggle-column="toggleColumnVisibility"
                        />
                    </template>
                </DataGrid>
            </div>
        </div>

        <!-- Add / Duplicate Row dialog -->
        <CenteredModal v-model:open="dataGridState.isAddRowDialogOpen" title="Add Row" contentClass="max-w-2xl max-h-[80vh] overflow-auto">
            <form class="flex flex-col gap-3 p-4" @submit.prevent="commitAddRow">
                <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    <template v-for="col in tableColumns" :key="col.name">
                        <label class="self-center text-right font-medium text-reverse opacity-80">{{ col.name }}</label>
                        <input
                            v-model="addRowFormState[col.name]"
                            class="border border-x4 bg-x1 px-2 py-1.5 font-mono text-xs outline-none transition focus:border-x5"
                            :placeholder="col.isAutoIncrement ? 'auto' : (col.type ?? '')"
                            :disabled="col.isAutoIncrement"
                        />
                    </template>
                </div>
                <div class="mt-2 flex justify-end gap-2">
                    <Button type="button" severity="secondary" smaller @click="dataGridState.closeAddRowDialog()">Cancel</Button>
                    <Button type="submit" severity="primary" smaller>Add Row</Button>
                </div>
            </form>
        </CenteredModal>

        <!-- Edit Row dialog -->
        <CenteredModal v-model:open="dataGridState.isEditRowDialogOpen" title="Edit Row" contentClass="max-w-2xl max-h-[80vh] overflow-auto">
            <form class="flex flex-col gap-3 p-4" @submit.prevent="commitEditRow">
                <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    <template v-for="col in tableColumns" :key="col.name">
                        <label class="self-center text-right font-medium text-reverse opacity-80">{{ col.name }}</label>
                        <input
                            v-model="addRowFormState[col.name]"
                            class="border border-x4 bg-x1 px-2 py-1.5 font-mono text-xs outline-none transition focus:border-x5"
                            :placeholder="col.isAutoIncrement ? 'auto' : (col.type ?? '')"
                            :disabled="col.isAutoIncrement"
                        />
                    </template>
                </div>
                <div class="mt-2 flex justify-end gap-2">
                    <Button type="button" severity="secondary" smaller @click="dataGridState.closeEditRowDialog()">Cancel</Button>
                    <Button type="submit" severity="primary" smaller>Save</Button>
                </div>
            </form>
        </CenteredModal>

        <Popover
            v-for="view in fkPeekViews.peekViews"
            :key="view.id"
            :data-peek-popover-id="view.id"
            :open="true"
            :left="view.left"
            :top="view.top"
            :width="view.width"
            :height="view.height"
            :min-width="320"
            :min-height="220"
            surface-class="overflow-hidden"
            content-class="h-full"
            :on-update-open="(open) => handlePeekViewUpdateOpen(view.id, open)"
            :on-update-position="(position) => fkPeekViews.updatePeekViewPosition(view.id, position.left, position.top)"
            :on-update-size="(size) => fkPeekViews.updatePeekViewSize(view.id, size.width, size.height)"
        >
            <template #title>
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-default">{{ view.title }}</p>
                    <p class="truncate text-2xs opacity-70">{{ view.subtitle }}</p>
                </div>
            </template>

            <template #actions>
                <IconButton
                    v-if="isFkPeekRowsView(view)"
                    icon="icon-[mdi--swap-horizontal-bold]"
                    :class="fkPeekViews.isPeekViewTransposed(view) ? 'bg-blue-500/15 text-blue-200' : ''"
                    v-tooltip.xs.nowrap="'Transpose grid'"
                    smaller
                    @click.stop="fkPeekViews.togglePeekViewTranspose(view)"
                />
            </template>

            <div v-if="isFkPeekRowsView(view)" class="h-full min-h-0">
                <DataGrid :state="ensurePeekGridState(view)" :has-toolbar="false" class="h-full">
                    <template #title>
                        <span class="transform-none">{{ view.title }}</span>
                    </template>
                </DataGrid>
            </div>

            <div v-else-if="isFkUsageListView(view)" class="flex h-full min-h-0 flex-col overflow-auto px-3 py-3">
                <div v-if="view.loading" class="text-xs opacity-70">Loading usages…</div>
                <div v-else-if="view.errorMessage" class="text-xs text-amber-200">
                    {{ view.errorMessage }}
                </div>
                <div v-else-if="!view.usages.length" class="text-xs opacity-70">No foreign key usages found.</div>
                <div v-else class="flex min-h-0 flex-col gap-2 overflow-auto">
                    <div
                        v-for="usage in view.usages"
                        :key="`${usage.relation.sourceTable}:${formatUsageRelationColumns(usage.relation, 'source')}`"
                        class="border border-x3 px-3 py-2"
                    >
                        <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <p class="truncate text-sm font-medium text-default">
                                    {{ usage.relation.sourceTable }} -
                                    {{ formatUsageRelationColumns(usage.relation, 'source') }}
                                </p>
                                <p v-if="usage.errorMessage" class="truncate text-2xs text-amber-200">
                                    {{ usage.errorMessage }}
                                </p>
                                <p v-else class="text-2xs opacity-70">{{ usage.rowCount }} {{ usage.rowCount === 1 ? 'row' : 'rows' }}</p>
                            </div>

                            <Button
                                severity="secondary"
                                smaller
                                :disabled="!!usage.errorMessage || usage.rowCount <= 0"
                                @click="fkPeekViews.openUsageRowsPeekView({ view, usage, event: $event })"
                            >
                                See rows
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else>Unsupported view type</div>
        </Popover>

        <CenteredModal v-model:open="dataGridState.isForeignKeyViolationsOpen" title="Foreign key issues detected" contentClass="max-w-3xl">
            <div class="space-y-3 px-4 py-4">
                <p class="text-xs opacity-70">The changes were saved with foreign key checks disabled, but the final validation found these issues.</p>
                <div class="max-h-[60vh] overflow-auto border border-amber-300/25 bg-amber-300/8 px-3 py-3 text-xs text-default">
                    <ul class="space-y-2">
                        <li v-for="issue in dataGridState.foreignKeyViolations" :key="issue">{{ issue }}</li>
                    </ul>
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                <Button severity="primary" smaller @click="dataGridState.isForeignKeyViolationsOpen = false"> Close </Button>
            </div>
        </CenteredModal>

        <CenteredModal :open="dataGridState.isPreviewOpen" title="Pending updates" contentClass="max-w-3xl" @update:open="dataGridState.isPreviewOpen = $event">
            <div class="space-y-3 px-4 py-4">
                <p class="text-xs opacity-70">These statements will be executed in order.</p>
                <div class="max-h-[60vh] overflow-auto border border-x4 bg-x0">
                    <pre class="whitespace-pre-wrap p-3 text-xs leading-6 text-default">{{ dataGridState.previewQueries.join('\n') }}</pre>
                </div>
            </div>
            <div class="flex items-center justify-between gap-3 border-t border-x3 px-4 py-3">
                <label v-if="dataGridState.supportsForeignKeyCheckToggle" class="flex cursor-pointer items-center gap-2 opacity-80 transition hover:opacity-100">
                    <input
                        :checked="dataGridState.disableForeignKeyChecks"
                        type="checkbox"
                        class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                        @change="dataGridState.setDisableForeignKeyChecks(($event.target as HTMLInputElement).checked)"
                    />
                    <span>Disable foreign key checks</span>
                </label>
                <Button severity="secondary" smaller @click="dataGridState.isPreviewOpen = false"> Close </Button>
                <Button severity="primary" smaller :disabled="!dataGridState.hasPendingChanges || dataGridState.isSavingChanges" @click="dataGridState.saveChanges">
                    {{ dataGridState.saveButtonLabel }}
                </Button>
            </div>
        </CenteredModal>

        <CenteredModal :open="dataGridState.isDdlModalOpen" title="Table DDL" contentClass="max-w-3xl" @update:open="dataGridState.isDdlModalOpen = $event">
            <div class="space-y-3 px-4 py-4">
                <p class="text-xs opacity-70">Editable DDL statement for this table. Changes are not saved.</p>
                <div class="h-[60vh] border border-x4">
                    <MonacoEditor v-model="dataGridState.ddlText" language="sql" class="h-full" />
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                <Button severity="secondary" smaller @click="dataGridState.isDdlModalOpen = false"> Close </Button>
            </div>
        </CenteredModal>
    </section>
</template>
