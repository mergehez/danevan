import { component, ensureAllTsxProps, prevented, vModel } from '#shared/utils/tsxHelpers.tsx';
import { computed, effectScope, onBeforeUnmount, ref, watch, withKeys, type EffectScope } from 'vue';
import { useEditableDataGridState, type EditableDataGridState } from '../../datagrid';
import { DataGrid } from '../../datagrid/DataGrid.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { Checkbox } from '../../shared/components/Checkbox.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { Popover } from '../../shared/components/Popover.tsx';
import type { SqlValue } from '../../shared/types';
import { formatValue } from '../../shared/utils/valueFormatting';
import { useConnections } from '../composables/useConnections';
import { useDbDataGrid } from '../composables/useDbDataGrid';
import { useDbSettings } from '../composables/useDbSettings';
import { formatUsageRelationColumns, isFkPeekRowsView, isFkUsageListView, useForeignKeyPeekViews, type FkPeekRowsView } from '../composables/useForeignKeyPeek';
import { useQuery } from '../composables/useQuery';
import { useServers } from '../composables/useServers';
import { DbGridToolbar } from './DbGridToolbar.tsx';
import { DbSaveBar } from './DbSaveBar.tsx';
import { MonacoEditor } from './MonacoEditor.tsx';

type Props = {};

export const DbData = component(
    (_: Props) => {
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
            ignoreDisplayFilters: () => query.isCustomQueryMode,
            onSortChange: onGridSortChange,
            disabledFiltersMessage: 'Filters are disabled. To re-enable: click the "Reset to generated query" button.',
        });

        const tableColumns = computed(() => query.tableInfo?.columns ?? []);
        const addRowFormState = ref<Record<string, string>>({});
        const addRowNullState = ref<Record<string, boolean>>({});

        watch(
            () => [dataGridState.isAddRowDialogOpen, dataGridState.isEditRowDialogOpen],
            () => {
                if (dataGridState.isAddRowDialogOpen || dataGridState.isEditRowDialogOpen) {
                    // Initialise form from the dialog values (empty for new row,
                    // prefilled for duplicate / edit).
                    addRowFormState.value = Object.fromEntries(tableColumns.value.map((col) => [col.name, String(dataGridState.addRowDialogValues[col.name] ?? '')]));
                    // Track which columns have null values.
                    addRowNullState.value = Object.fromEntries(tableColumns.value.map((col) => [col.name, dataGridState.addRowDialogValues[col.name] == null]));
                }
            }
        );

        function commitAddRow() {
            if (!dataGridState.isAddRowDialogOpen) return;

            const values: Record<string, SqlValue> = {};
            for (const col of tableColumns.value) {
                if (addRowNullState.value[col.name]) {
                    values[col.name] = null;
                } else {
                    const raw = addRowFormState.value[col.name]?.trim() ?? '';
                    values[col.name] = raw === '' && col.isAutoIncrement ? null : raw;
                }
            }

            dataGridState.commitAddRow(values);
        }

        function commitEditRow() {
            if (!dataGridState.isEditRowDialogOpen) return;

            const values: Record<string, SqlValue> = {};
            for (const col of tableColumns.value) {
                if (addRowNullState.value[col.name]) {
                    values[col.name] = null;
                } else {
                    const raw = addRowFormState.value[col.name]?.trim() ?? '';
                    values[col.name] = raw === '' && col.isAutoIncrement ? null : raw;
                }
            }

            dataGridState.commitEditRow(values);
        }

        const currentSort = computed(() => dataGridState.sortState);
        const orderBy = computed(() => {
            const sort = currentSort.value;
            if (!sort) return undefined;
            return { column: sort.columnName, direction: sort.direction === 'asc' ? 'ASC' : 'DESC' } as const;
        });

        // The grid calls onSortChange when the user clicks a column header.
        // We reload the table data with the new sort order explicitly.
        function onGridSortChange(_columnName: string) {
            const connId = connections.selectedConnectionId;
            if (connId && query.selectedTableName && !query.isCustomQueryMode) {
                void query.loadSelectedTable(connId, query.selectedTableName, { offset: 0, orderBy: orderBy.value });
            }
        }

        function reloadGrid() {
            const connId = connections.selectedConnectionId;
            const tableName = query.selectedTableName;

            if (connId && tableName) {
                void query.loadSelectedTable(connId, tableName, { offset: 0, orderBy: orderBy.value });
            }
        }

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

        return () => (
            <section id="dbdatapanel" class="min-h-0 flex-1 flex flex-col overflow-auto">
                <DbSaveBar
                    pendingChangeCount={dataGridState.pendingChangeCount}
                    canUndo={dataGridState.canUndo}
                    canRedo={dataGridState.canRedo}
                    isSavingChanges={dataGridState.isSavingChanges}
                    saveButtonLabel={dataGridState.saveButtonLabel}
                    supportsForeignKeyCheckToggle={dataGridState.supportsForeignKeyCheckToggle}
                    disableForeignKeyChecks={dataGridState.disableForeignKeyChecks}
                    onClearChanges={dataGridState.clearChanges}
                    onUndoChanges={dataGridState.undoChanges}
                    onRedoChanges={dataGridState.redoChanges}
                    onPreviewChanges={dataGridState.openPreview}
                    onSaveChanges={dataGridState.saveChanges}
                    onSetDisableForeignKeyChecks={dataGridState.setDisableForeignKeyChecks}
                />
                <div class="relative min-h-0 flex-1 flex flex-col overflow-auto">
                    {isLoading.value ? (
                        <div class="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-x1/65 backdrop-blur-[1px]">
                            <div class="border border-x4 bg-x2 px-3 py-2 text-xs text-reverse">Loading table data...</div>
                        </div>
                    ) : null}
                    {query.selectedTableName ? (
                        <div class="flex items-center gap-2 border-b border-x4 bg-x0 px-2 py-1">
                            <div class="flex-1 min-w-0">
                                <input
                                    value={query.customQueryText}
                                    onInput={(e: any) => (query.customQueryText = e.target.value)}
                                    placeholder="select * from myTable limit 100;"
                                    onKeydown={prevented(withKeys(() => query.runCustomQuery(), ['enter']))}
                                    class="w-full border border-x4 bg-x1 px-2 py-1 text-xs font-mono outline-none transition focus:border-x5"
                                />
                            </div>
                            {query.isCustomQueryMode ? (
                                <IconButton
                                    icon="icon-[mdi--backup-restore]"
                                    v-tooltip={{ value: 'Reset to generated query', xs: true, nowrap: true }}
                                    smaller={true}
                                    severity="secondary"
                                    onClick={() => query.clearCustomQuery()}
                                />
                            ) : null}
                            <IconButton
                                icon="icon-[mdi--play]"
                                v-tooltip={{ value: 'Run query', xs: true, nowrap: true }}
                                smaller={true}
                                severity="primary"
                                disabled={!query.customQueryText.trim() || query.isRunningQuery}
                                onClick={() => query.runCustomQuery()}
                            />
                            {/* /> */}
                        </div>
                    ) : null}
                    <div class={['h-full w-full flex flex-col overflow-auto', isLoading.value ? 'pointer-events-none opacity-60' : '']}>
                        <DataGrid
                            state={dataGridState}
                            hasToolbar={true}
                            withCheckboxes={false}
                            slots={{
                                title: () => (
                                    <DbGridToolbar
                                        gridState={dataGridState}
                                        title={query.selectedTableName || 'Select a table'}
                                        isLoading={isLoading.value}
                                        showPageNav={true}
                                        pageRangeStart={pageRangeStart.value}
                                        pageRangeEnd={pageRangeEnd.value}
                                        totalRowCount={totalRowCount.value}
                                        canGoToPreviousPage={canGoToPreviousPage.value}
                                        canGoToNextPage={canGoToNextPage.value}
                                        onGoToPreviousPage={goToPreviousPage}
                                        onGoToNextPage={goToNextPage}
                                        pageSizeMenuOptions={pageSizeMenuOptions.value}
                                        selectedDataLimit={selectedDataLimit.value}
                                        onSelectPageSize={selectPageSize}
                                        disabled={query.isCustomQueryMode}
                                        onAddRow={dataGridState.openAddRowDialog}
                                        onReload={reloadGrid}
                                        onToggleColumn={toggleColumnVisibility}
                                    />
                                ),
                            }}
                        />
                    </div>
                </div>
                {/* Add / Duplicate Row dialog */}
                <CenteredModal {...vModel(dataGridState, 'isAddRowDialogOpen', 'open')} title="Add Row" contentClass="max-w-2xl max-h-[80vh] overflow-auto">
                    <form onSubmit={prevented(commitAddRow)} class="flex flex-col gap-3 p-4">
                        <div class="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 text-xs">
                            <span class="text-right font-bold opacity-50">Column</span>
                            <span class="font-bold opacity-50">Value</span>
                            <span class="font-bold opacity-50">Null</span>
                            {tableColumns.value.map((col) => (
                                <>
                                    <label class="self-center text-right font-medium text-reverse opacity-80" key={col.name}>
                                        {col.name}
                                    </label>
                                    <input
                                        value={addRowFormState.value[col.name]}
                                        onInput={(e: any) => (addRowFormState.value[col.name] = e.target.value)}
                                        placeholder={col.isAutoIncrement ? 'auto' : (col.type ?? '')}
                                        disabled={col.isAutoIncrement || addRowNullState.value[col.name]}
                                        class="border border-x4 bg-x1 px-2 py-1.5 font-mono text-xs outline-none transition focus:border-x5"
                                        key={col.name}
                                    />
                                    <div class="flex items-center justify-center gap-1" key={col.name}>
                                        {!col.notNull ? <Checkbox {...vModel(addRowNullState.value, col.name)} small={true} class="opacity-80" /> : null}
                                    </div>
                                </>
                            ))}
                        </div>
                        <div class="mt-2 flex justify-end gap-2">
                            <Button type="button" severity="secondary" smaller={true} onClick={() => dataGridState.closeAddRowDialog()}>
                                Cancel
                            </Button>
                            <Button type="submit" severity="primary" smaller={true}>
                                Add Row
                            </Button>
                        </div>
                    </form>
                </CenteredModal>
                {/* Edit Row dialog */}
                <CenteredModal {...vModel(dataGridState, 'isEditRowDialogOpen', 'open')} title="Edit Row" contentClass="max-w-2xl max-h-[80vh] overflow-auto">
                    <form onSubmit={prevented(commitEditRow)} class="flex flex-col gap-3 p-4">
                        <div class="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 text-xs">
                            {tableColumns.value.map((col) => (
                                <>
                                    <label class="self-center text-right font-medium text-reverse opacity-80" key={col.name}>
                                        {col.name}
                                    </label>
                                    <input
                                        value={addRowFormState.value[col.name]}
                                        onInput={(e: any) => (addRowFormState.value[col.name] = e.target.value)}
                                        placeholder={col.isAutoIncrement ? 'auto' : (col.type ?? '')}
                                        disabled={col.isAutoIncrement || addRowNullState.value[col.name]}
                                        class="border border-x4 bg-x1 px-2 py-1.5 font-mono text-xs outline-none transition focus:border-x5"
                                        key={col.name}
                                    />
                                    <div class="flex items-center justify-center" key={col.name}>
                                        {!col.isAutoIncrement ? <Checkbox {...vModel(addRowNullState.value, col.name)} smaller={true} /> : null}
                                    </div>
                                </>
                            ))}
                        </div>
                        <div class="mt-2 flex justify-end gap-2">
                            <Button type="button" severity="secondary" smaller={true} onClick={() => dataGridState.closeEditRowDialog()}>
                                Cancel
                            </Button>
                            <Button type="submit" severity="primary" smaller={true}>
                                Save
                            </Button>
                        </div>
                    </form>
                </CenteredModal>
                {fkPeekViews.peekViews.map((view) => (
                    <Popover
                        data-peek-popover-id={view.id}
                        open={true}
                        left={view.left}
                        top={view.top}
                        width={view.width}
                        height={view.height}
                        minWidth={320}
                        minHeight={220}
                        surfaceClass="overflow-hidden"
                        contentClass="h-full"
                        onUpdateOpen={(open) => handlePeekViewUpdateOpen(view.id, open)}
                        onUpdatePosition={(position) => fkPeekViews.updatePeekViewPosition(view.id, position.left, position.top)}
                        onUpdateSize={(size) => fkPeekViews.updatePeekViewSize(view.id, size.width, size.height)}
                        key={view.id}
                        slots={{
                            default: () => (
                                <>
                                    {isFkPeekRowsView(view) ? (
                                        <div class="h-full min-h-0">
                                            <DataGrid
                                                state={ensurePeekGridState(view)}
                                                hasToolbar={false}
                                                class="h-full"
                                                slots={{ title: () => <span class="transform-none">{view.title}</span> }}
                                            />
                                        </div>
                                    ) : isFkUsageListView(view) ? (
                                        <div class="flex h-full min-h-0 flex-col overflow-auto px-3 py-3">
                                            {view.loading ? (
                                                <div class="text-xs opacity-70">Loading usages…</div>
                                            ) : view.errorMessage ? (
                                                <div class="text-xs text-amber-200">{view.errorMessage}</div>
                                            ) : !view.usages.length ? (
                                                <div class="text-xs opacity-70">No foreign key usages found.</div>
                                            ) : (
                                                <div class="flex min-h-0 flex-col gap-2 overflow-auto">
                                                    {view.usages.map((usage) => (
                                                        <div
                                                            class="border border-x3 px-3 py-2"
                                                            key={`${usage.relation.sourceTable}:${formatUsageRelationColumns(usage.relation, 'source')}`}
                                                        >
                                                            <div class="flex items-center justify-between gap-3">
                                                                <div class="min-w-0">
                                                                    <p class="truncate text-sm font-medium text-default">
                                                                        {usage.relation.sourceTable}-{formatUsageRelationColumns(usage.relation, 'source')}
                                                                    </p>
                                                                    {usage.errorMessage ? (
                                                                        <p class="truncate text-2xs text-amber-200">{usage.errorMessage}</p>
                                                                    ) : (
                                                                        <p class="text-2xs opacity-70">
                                                                            {usage.rowCount} {usage.rowCount === 1 ? 'row' : 'rows'}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                                <Button
                                                                    severity="secondary"
                                                                    smaller={true}
                                                                    disabled={!!usage.errorMessage || usage.rowCount <= 0}
                                                                    onClick={(ev: MouseEvent) => fkPeekViews.openUsageRowsPeekView({ view: view, usage: usage, event: ev })}
                                                                >
                                                                    See rows
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div>Unsupported view type</div>
                                    )}
                                </>
                            ),
                            title: () => (
                                <div class="min-w-0">
                                    <p class="truncate text-sm font-medium text-default">{view.title}</p>
                                    <p class="truncate text-2xs opacity-70">{view.subtitle}</p>
                                </div>
                            ),
                            actions: () => (
                                <>
                                    {isFkPeekRowsView(view) ? (
                                        <IconButton
                                            icon="icon-[mdi--swap-horizontal-bold]"
                                            v-tooltip={{ value: 'Transpose grid', xs: true, nowrap: true }}
                                            smaller={true}
                                            onClick={prevented(() => fkPeekViews.togglePeekViewTranspose(view))}
                                            class={fkPeekViews.isPeekViewTransposed(view) ? 'bg-blue-500/15 text-blue-200' : ''}
                                        />
                                    ) : null}
                                </>
                            ),
                        }}
                    />
                ))}
                <CenteredModal {...vModel(dataGridState, 'isForeignKeyViolationsOpen', 'open')} title="Foreign key issues detected" contentClass="max-w-3xl">
                    <div class="space-y-3 px-4 py-4">
                        <p class="text-xs opacity-70">The changes were saved with foreign key checks disabled, but the final validation found these issues.</p>
                        <div class="max-h-[60vh] overflow-auto border border-amber-300/25 bg-amber-300/8 px-3 py-3 text-xs text-default">
                            <ul class="space-y-2">
                                {dataGridState.foreignKeyViolations.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                        <Button severity="primary" smaller={true} onClick={() => (dataGridState.isForeignKeyViolationsOpen = false)}>
                            {' '}
                            Close{' '}
                        </Button>
                    </div>
                </CenteredModal>
                <CenteredModal open={dataGridState.isPreviewOpen} title="Pending updates" contentClass="max-w-3xl" onOpenChange={(t) => (dataGridState.isPreviewOpen = t)}>
                    <div class="space-y-3 px-4 py-4">
                        <p class="text-xs opacity-70">These statements will be executed in order.</p>
                        <div class="max-h-[60vh] overflow-auto border border-x4 bg-x0">
                            <pre class="whitespace-pre-wrap p-3 text-xs leading-6 text-default">{dataGridState.previewQueries.join('\n')}</pre>
                        </div>
                        <div class="flex items-center justify-between gap-3 border-t border-x3 px-4 py-3"></div>
                        {dataGridState.supportsForeignKeyCheckToggle ? (
                            <label class="flex cursor-pointer items-center gap-2 opacity-80 transition hover:opacity-100">
                                <input
                                    checked={dataGridState.disableForeignKeyChecks}
                                    type="checkbox"
                                    onChange={(e) => dataGridState.setDisableForeignKeyChecks((e.target as HTMLInputElement).checked)}
                                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                />
                                <span>Disable foreign key checks</span>
                            </label>
                        ) : null}
                        <Button severity="secondary" smaller={true} onClick={() => (dataGridState.isPreviewOpen = false)}>
                            {' '}
                            Close{' '}
                        </Button>
                        <Button severity="primary" smaller={true} disabled={!dataGridState.hasPendingChanges || dataGridState.isSavingChanges} onClick={dataGridState.saveChanges}>
                            {dataGridState.saveButtonLabel}
                        </Button>
                    </div>
                </CenteredModal>
                <CenteredModal open={dataGridState.isDdlModalOpen} title="Table DDL" contentClass="max-w-3xl" onOpenChange={(t) => (dataGridState.isDdlModalOpen = t)}>
                    <div class="space-y-3 px-4 py-4">
                        <p class="text-xs opacity-70">Editable DDL statement for this table. Changes are not saved.</p>
                        <div class="h-[60vh] border border-x4">
                            <MonacoEditor {...vModel(dataGridState, 'ddlText')} language="sql" class="h-full" />
                        </div>
                    </div>
                    <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                        <Button severity="secondary" smaller={true} onClick={() => (dataGridState.isDdlModalOpen = false)}>
                            {' '}
                            Close{' '}
                        </Button>
                    </div>
                </CenteredModal>
            </section>
        );
    },
    { name: 'DbData', props: ensureAllTsxProps<Props>()([]) }
);

export default DbData;
