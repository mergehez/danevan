<script setup lang="ts">
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
import { formatValue } from '@utils/valueFormatting';
import { computed, effectScope, onBeforeUnmount, ref, watch, type EffectScope } from 'vue';

const settings = useDbSettings();
const connections = useConnections();
const query = useQuery();
const servers = useServers();
const pageSizeMenuElement = ref<HTMLElement>();
const pageSizeButtonElement = ref<HTMLElement>();
const isPageSizeMenuOpen = ref(false);

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

    if (query.selectedTableName) {
        await query.loadSelectedTable({ offset: 0 });
    }
}

function togglePageSizeMenu() {
    isPageSizeMenuOpen.value = !isPageSizeMenuOpen.value;
}

function closePageSizeMenu() {
    isPageSizeMenuOpen.value = false;
}

function handlePageSizeWindowPointerDown(event: PointerEvent) {
    const target = event.target as Node | null;

    if (!target) {
        return;
    }

    if (pageSizeMenuElement.value?.contains(target) || pageSizeButtonElement.value?.contains(target)) {
        return;
    }

    closePageSizeMenu();
}

async function selectPageSize(limit: number) {
    closePageSizeMenu();
    await applyDataLimit(limit);
}

async function goToPreviousPage() {
    if (!canGoToPreviousPage.value) {
        return;
    }

    const nextOffset = Math.max(0, currentPageOffset.value - Math.max(currentPageLimit.value, 1));
    await query.loadSelectedTable({ offset: nextOffset });
}

async function goToNextPage() {
    if (!canGoToNextPage.value) {
        return;
    }

    const nextOffset = currentPageOffset.value + Math.max(currentPageLimit.value, 1);
    await query.loadSelectedTable({ offset: nextOffset });
}

onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', handlePageSizeWindowPointerDown);
});

watch(isPageSizeMenuOpen, () => {
    window.removeEventListener('pointerdown', handlePageSizeWindowPointerDown);

    if (isPageSizeMenuOpen.value) {
        window.addEventListener('pointerdown', handlePageSizeWindowPointerDown);
    }
});
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
        <div
            v-if="dataGridState.hasPendingChanges || dataGridState.canUndo || dataGridState.canRedo"
            class="mb-3 flex items-center justify-between gap-3 border border-amber-300/25 bg-amber-300/8 px-3 py-2 text-2xs"
        >
            <span>{{ dataGridState.pendingChangeCount }} pending {{ dataGridState.pendingChangeCount === 1 ? 'change' : 'changes' }}</span>
            <div class="flex items-center gap-3">
                <label v-if="dataGridState.supportsForeignKeyCheckToggle" class="flex cursor-pointer items-center gap-2 opacity-80 transition hover:opacity-100">
                    <input
                        :checked="dataGridState.disableForeignKeyChecks"
                        type="checkbox"
                        class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                        @change="dataGridState.setDisableForeignKeyChecks(($event.target as HTMLInputElement).checked)"
                    />
                    <span>Disable FK checks</span>
                </label>
                <div class="flex items-center gap-2">
                    <Button severity="secondary" smaller :disabled="!dataGridState.canUndo" @click="dataGridState.undoChanges"> Undo </Button>
                    <Button severity="secondary" smaller :disabled="!dataGridState.canRedo" @click="dataGridState.redoChanges"> Redo </Button>
                    <Button severity="secondary" smaller :disabled="!dataGridState.hasPendingChanges" @click="dataGridState.openPreview"> Preview </Button>
                    <Button severity="primary" smaller :disabled="!dataGridState.hasPendingChanges || dataGridState.isSavingChanges" @click="dataGridState.saveChanges">
                        {{ dataGridState.saveButtonLabel }}
                    </Button>
                </div>
            </div>
        </div>

        <div class="relative min-h-0 flex-1 flex flex-col overflow-auto">
            <div v-if="isLoading" class="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-x1/65 backdrop-blur-[1px]">
                <div class="border border-x4 bg-x2 px-3 py-2 text-xs text-reverse">Loading table data...</div>
            </div>
            <div :class="isLoading ? 'pointer-events-none opacity-60' : ''" class="h-full w-full flex flex-col overflow-auto">
                <DataGrid :state="dataGridState" :has-toolbar="true" :with-checkboxes="false">
                    <template #title>
                        <h2 class="text-sm font-semibold text-reverse">
                            {{ query.selectedTableName || 'Select a table' }}
                            <span class="border border-x7 bg-x2 px-1 rounded-md text-2xs opacity-60">{{ query.tableInfo?.columns.length ?? 0 }} Columns</span>
                        </h2>
                    </template>
                    <template #middle>
                        <div class="relative flex items-center text-2xs text-white">
                            <IconButton
                                icon="icon-[mdi--chevron-left]"
                                v-tooltip.xs.nowrap="'Previous page'"
                                severity="secondary"
                                small
                                :disabled="!canGoToPreviousPage"
                                @click="goToPreviousPage"
                                class="rounded-r-none"
                            />
                            <div class="relative">
                                <button
                                    ref="pageSizeButtonElement"
                                    type="button"
                                    class="inline-flex h-7 items-center gap-1 border border-x4 bg-x2 px-2 text-2xs opacity-80 transition hover:bg-x3 hover:opacity-100"
                                    :disabled="isLoading"
                                    @click="togglePageSizeMenu"
                                >
                                    <span>{{ pageRangeStart }}-{{ pageRangeEnd }}</span>
                                    <span class="opacity-60">of {{ totalRowCount }}</span>
                                    <span class="iconify icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-70"></span>
                                </button>
                                <div v-if="isPageSizeMenuOpen" ref="pageSizeMenuElement" class="absolute left-0 right-0 top-full z-20 border-y border-x4 bg-x1 py-1">
                                    <div class="px-3 py-1 text-2xs opacity-60">Page Size</div>
                                    <button
                                        v-for="option in pageSizeMenuOptions"
                                        :key="option.value"
                                        type="button"
                                        class="flex w-full items-center justify-between gap-3 px-3.5 py-1 text-left text-xs transition hover:bg-white/8"
                                        @click="selectPageSize(option.value)"
                                    >
                                        <span class="inline-flex min-w-0 items-center gap-2">
                                            <span>{{ option.label }}</span>
                                            <span class="h-4 w-4 text-center text-xs opacity-80">{{ selectedDataLimit === option.value ? '✓' : '' }}</span>
                                        </span>
                                    </button>
                                </div>
                            </div>
                            <IconButton
                                icon="icon-[mdi--chevron-right]"
                                v-tooltip.xs.nowrap="'Next page'"
                                small
                                :disabled="!canGoToNextPage"
                                @click="goToNextPage"
                                class="rounded-l-none"
                                severity="secondary"
                            />
                        </div>
                        <div class="flex flex-wrap gap-1 text-2xs">
                            <!-- <span class="border border-x6 bg-x2 px-1 rounded-md">Rows {{ query.tableData?.rowCount ?? 0 }}</span> -->
                            <!-- <span class="border border-x6 bg-x2 px-1 rounded-md">Indexes {{ query.tableInfo?.indexes.length ?? 0 }}</span> -->
                        </div>
                    </template>
                    <template #actions>
                        <IconButton
                            class="ml-2"
                            :icon="isLoading ? 'icon-[mdi--loading] animate-spin' : 'icon-[mdi--reload]'"
                            v-tooltip.xs.nowrap="'Reload table'"
                            smaller
                            :disabled="!query.selectedTableName || isLoading"
                            @click="query.loadSelectedTable"
                        />
                    </template>
                </DataGrid>
            </div>
        </div>

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
                <div v-else-if="view.errorMessage" class="text-xs text-amber-200">{{ view.errorMessage }}</div>
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
                                    {{ usage.relation.sourceTable }} - {{ formatUsageRelationColumns(usage.relation, 'source') }}
                                </p>
                                <p v-if="usage.errorMessage" class="truncate text-2xs text-amber-200">{{ usage.errorMessage }}</p>
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
    </section>
</template>
