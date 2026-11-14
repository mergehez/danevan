import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';
import { computed, effectScope, onBeforeUnmount, watch, type EffectScope } from 'vue';
import { formatValue } from '../../shared/utils/valueFormatting';
import { DataGrid } from '../../datagrid/DataGrid.tsx';
import { useEditableDataGridState, type EditableDataGridState } from '../../datagrid';
import { Button } from '../../shared/components/Button.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { Popover } from '../../shared/components/Popover.tsx';
import { formatUsageRelationColumns, isFkPeekRowsView, isFkUsageListView, useForeignKeyPeekViews, type FkPeekRowsView } from '../composables/useForeignKeyPeek';

type Props = {
    /** The peek stack of the panel showing them; the owner creates it and opens the views. */
    peekViews: ReturnType<typeof useForeignKeyPeekViews>;
};

/**
 * The FK peek popovers of a grid — a relation's row and a key's usages — with the small editable
 * grids they draw. Both the table panel and the script result panel render the same stack: a peek
 * that only exists in one of them is a menu item that does nothing in the other.
 */
export const DbPeekViews = component(
    (props: Props) => {
        const peekGridScopes = new Map<string, EffectScope>();
        const peekGridStates = new Map<string, EditableDataGridState>();

        function handlePeekViewUpdateOpen(viewId: string, open: boolean) {
            if (!open) {
                props.peekViews.closePeekViewsFrom(viewId);
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
                    transposeState: props.peekViews.getPeekViewTransposeState(view),
                    defaultTransposed: true,
                    getTransposeColumnName: (rowIndex, total) => (total === 1 ? 'Value' : `Row ${rowIndex + 1}`),
                    emptyText: computed(() => (view.loading ? 'Loading relation…' : view.errorMessage || 'No related row found.')),
                    formatValue: (value) => formatValue(value),
                    cellContextMenuItems: (context) => props.peekViews.buildPeekContextMenuItems(view, context),
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

        /**
         * The peek grid draws nothing of its own until its answer arrives, so the popover is an
         * empty box meanwhile and a peek that failed looks exactly like one that is slow.
         */
        function renderPeekRowsView(view: FkPeekRowsView) {
            if (view.loading) {
                return (
                    <div class="px-3 py-3 text-xs opacity-70" data-testid="peek-rows-loading">
                        Loading relation…
                    </div>
                );
            }

            // An empty match keeps its columns, and the grid's own empty text says there was no row.
            if (view.errorMessage && !view.columns.length) {
                return (
                    <div class="px-3 py-3 text-xs text-amber-200" data-testid="peek-rows-error">
                        {view.errorMessage}
                    </div>
                );
            }

            return <DataGrid state={ensurePeekGridState(view)} hasToolbar={false} class="h-full" slots={{ title: () => <span class="transform-none">{view.title}</span> }} />;
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
            () => props.peekViews.peekViews.map((view) => view.id),
            (ids) => {
                for (const view of props.peekViews.peekViews) {
                    if (!isFkPeekRowsView(view) || peekGridStates.has(view.id)) {
                        continue;
                    }

                    createPeekGridState(view);
                }

                cleanupRemovedPeekGridStates(ids.filter((id) => props.peekViews.peekViews.some((view) => view.id === id && isFkPeekRowsView(view))));
            },
            { immediate: true }
        );

        onBeforeUnmount(() => {
            for (const scope of peekGridScopes.values()) {
                scope.stop();
            }

            peekGridScopes.clear();
            peekGridStates.clear();
        });

        return () => (
            <>
                {props.peekViews.peekViews.map((view) => (
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
                        onUpdatePosition={(position) => props.peekViews.updatePeekViewPosition(view.id, position.left, position.top)}
                        onUpdateSize={(size) => props.peekViews.updatePeekViewSize(view.id, size.width, size.height)}
                        key={view.id}
                        slots={{
                            default: () => (
                                <>
                                    {isFkPeekRowsView(view) ? (
                                        <div class="h-full min-h-0">{renderPeekRowsView(view)}</div>
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
                                                                    onClick={(event: MouseEvent) =>
                                                                        props.peekViews.openUsageRowsPeekView({ view: view, usage: usage, event: event })
                                                                    }
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
                                            onClick={prevented(() => props.peekViews.togglePeekViewTranspose(view))}
                                            class={props.peekViews.isPeekViewTransposed(view) ? 'bg-blue-500/15 text-blue-200' : ''}
                                        />
                                    ) : null}
                                </>
                            ),
                        }}
                    />
                ))}
            </>
        );
    },
    { name: 'DbPeekViews', props: ensureAllTsxProps<Props>()(['peekViews']) }
);

export default DbPeekViews;
