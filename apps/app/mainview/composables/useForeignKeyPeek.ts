import { tasks } from '@composables/useTasks';
import type { MaybeReactiveValue } from '@datagrid/index';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import type { DbType, PeekFkUsageRelation, PeekFkUsageSummary, QueryExecutionResult, SqlValue, TableInfo } from '@utils/appClient';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { formatValue } from '@utils/valueFormatting';
import { computed, onBeforeUnmount, reactive, ref, unref, watch } from 'vue';

type PeekAnchor = Pick<MouseEvent, 'clientX' | 'clientY'>;

export type FkPeekRelation = {
    fromColumn: string;
    targetTable: string;
    targetColumn: string;
};

export type FkUsageRelation = PeekFkUsageRelation;

export type FkUsageSummary = PeekFkUsageSummary;

type FkPeekBaseView = {
    id: string;
    connectionId: number;
    left: number;
    top: number;
    width: number;
    height: number;
    loading: boolean;
    errorMessage: string | undefined;
    title: string;
    subtitle: string;
};

export type FkPeekRowsView = FkPeekBaseView & {
    kind: 'rows';
    targetTable: string;
    targetColumn: string;
    tableInfo: TableInfo | undefined;
    columns: string[];
    columnStats: Record<string, number>;
    rows: Array<Record<string, SqlValue>>;
    isTransposed: boolean;
};

export type FkUsageListView = FkPeekBaseView & {
    kind: 'usages';
    targetTable: string;
    targetColumn: string;
    rowValues: Record<string, SqlValue>;
    usages: FkUsageSummary[];
};

export type FkPeekView = FkPeekRowsView | FkUsageListView;

export function isFkPeekRowsView(view: FkPeekView): view is FkPeekRowsView {
    return view.kind === 'rows';
}

export function isFkUsageListView(view: FkPeekView): view is FkUsageListView {
    return view.kind === 'usages';
}

function groupForeignKeysById(foreignKeys: TableInfo['foreignKeys']) {
    const foreignKeysById = new Map<number, TableInfo['foreignKeys']>();

    for (const foreignKey of foreignKeys) {
        const currentGroup = foreignKeysById.get(foreignKey.id) ?? [];
        currentGroup.push(foreignKey);
        foreignKeysById.set(foreignKey.id, currentGroup);
    }

    return foreignKeysById;
}

export function findFkPeekRelation(tableInfo: TableInfo | undefined, columnName: string) {
    if (!tableInfo) {
        return undefined;
    }

    for (const group of groupForeignKeysById(tableInfo.foreignKeys).values()) {
        if (group.length !== 1) {
            continue;
        }

        const [foreignKey] = group;

        if (foreignKey.from !== columnName) {
            continue;
        }

        return {
            fromColumn: foreignKey.from,
            targetTable: foreignKey.table,
            targetColumn: foreignKey.to,
        } satisfies FkPeekRelation;
    }

    return undefined;
}

export function formatUsageRelationColumns(relation: FkUsageRelation, side: 'source' | 'target') {
    return relation.columns.map((column) => (side === 'source' ? column.sourceColumn : column.targetColumn)).join(', ');
}

function buildMatchPredicate(columnName: string, value: SqlValue, sqlDialect: DbType) {
    const identifier = quoteSqlIdentifier(columnName, sqlDialect);
    return value == null ? `${identifier} IS NULL` : `${identifier} = ${formatValue(value, { mode: 'sql', binaryMode: 'hex' })}`;
}

export async function runFkPeekQuery(params: { connectionId: number; sqlDialect: DbType; relation: FkPeekRelation; value: SqlValue; limit: number }) {
    return tasks.runQuery.run({
        connectionId: params.connectionId,
        sql: [
            'SELECT *',
            `FROM ${quoteSqlIdentifier(params.relation.targetTable, params.sqlDialect)}`,
            `WHERE ${buildMatchPredicate(params.relation.targetColumn, params.value, params.sqlDialect)}`,
            `LIMIT ${params.limit}`,
        ].join(' '),
    });
}

async function runFkUsageQuery(params: { connectionId: number; tableName: string; columnName: string; rowValues: Record<string, SqlValue> }) {
    return tasks.peekFkUsages.run({
        connectionId: params.connectionId,
        tableName: params.tableName,
        columnName: params.columnName,
        rowValues: params.rowValues,
    });
}

async function runFkUsageRowsQuery(params: { connectionId: number; relation: FkUsageRelation; rowValues: Record<string, SqlValue>; limit: number }) {
    return tasks.peekFkUsageRows.run({
        connectionId: params.connectionId,
        relation: params.relation,
        rowValues: params.rowValues,
        limit: params.limit,
    });
}

function createPeekFrame(anchor: PeekAnchor, stackDepth: number) {
    const top = anchor.clientY + 8 + stackDepth * 18;
    let height = window.innerHeight * 0.8;

    if (height > window.innerHeight - top - 24) {
        height = window.innerHeight - top - 24;
    }

    return {
        left: anchor.clientX + 8 + stackDepth * 18,
        top,
        width: Math.min(560, Math.max(window.innerWidth - 24, 320)),
        height,
    };
}

function clampPeekPosition(left: number, top: number, width: number, height: number) {
    const margin = 12;
    const maxLeft = Math.max(window.innerWidth - width - margin, margin);
    const maxTop = Math.max(window.innerHeight - height - margin, margin);

    return {
        left: Math.min(Math.max(Math.round(left), margin), maxLeft),
        top: Math.min(Math.max(Math.round(top), margin), maxTop),
    };
}

type FkPeekMenuContext = {
    sourceColumnName: string;
    value: unknown;
    event: MouseEvent;
    isEditable: boolean;
};

export function useForeignKeyPeekViews(opts: {
    selectedConnectionId: MaybeReactiveValue<number | undefined>;
    selectedTableName: MaybeReactiveValue<string | undefined>;
    ensureTableDetails: (connectionId: number, tableName: string) => Promise<void>;
    getTableInfo: (connectionId: number, tableName: string) => TableInfo | undefined;
    getSqlDialect: (connectionId: number) => DbType;
}) {
    const selectedConnectionId = computed(() => unref(opts.selectedConnectionId));
    const selectedTableName = computed(() => unref(opts.selectedTableName));
    const peekViews = ref<FkPeekView[]>([]);
    let peekSequence = 0;
    let ignoreCloseUntil = 0;

    function logPeekDebug(message: string, details?: Record<string, unknown>) {
        console.log('[PeekViews]', message, details ?? {});
    }

    function refreshIgnoreCloseWindow() {
        ignoreCloseUntil = performance.now() + 180;
    }

    function shouldIgnoreClose() {
        return performance.now() < ignoreCloseUntil;
    }

    function createPeekId() {
        return `peek-${Date.now()}-${(peekSequence += 1)}`;
    }

    function appendPeekView<TView extends FkPeekView>(view: TView, anchor: PeekAnchor) {
        const frame = createPeekFrame(anchor, peekViews.value.length);
        view.width = Math.min(view.width, frame.width);
        view.height = Math.min(view.height, frame.height);
        const clampedPosition = clampPeekPosition(frame.left, frame.top, view.width, view.height);
        view.left = clampedPosition.left;
        view.top = clampedPosition.top;
        peekViews.value = [...peekViews.value, view];
        refreshIgnoreCloseWindow();
        logPeekDebug('appendPeekView', {
            id: view.id,
            kind: view.kind,
            left: view.left,
            top: view.top,
            width: view.width,
            height: view.height,
            stackSize: peekViews.value.length,
        });
        return view;
    }

    function createRowsView(params: { id: string; connectionId: number; title: string; subtitle: string; targetTable: string; targetColumn: string }): FkPeekRowsView {
        return {
            kind: 'rows',
            id: params.id,
            connectionId: params.connectionId,
            left: 0,
            top: 0,
            width: 560,
            height: 480,
            loading: true,
            errorMessage: undefined,
            title: params.title,
            subtitle: params.subtitle,
            targetTable: params.targetTable,
            targetColumn: params.targetColumn,
            tableInfo: undefined,
            columns: [],
            columnStats: {},
            rows: [],
            isTransposed: true,
        };
    }

    function createUsageListView(params: {
        id: string;
        connectionId: number;
        title: string;
        subtitle: string;
        targetTable: string;
        targetColumn: string;
        rowValues: Record<string, SqlValue>;
    }): FkUsageListView {
        return {
            kind: 'usages',
            id: params.id,
            connectionId: params.connectionId,
            left: 0,
            top: 0,
            width: 520,
            height: 360,
            loading: true,
            errorMessage: undefined,
            title: params.title,
            subtitle: params.subtitle,
            targetTable: params.targetTable,
            targetColumn: params.targetColumn,
            rowValues: params.rowValues,
            usages: [],
        };
    }

    function closePeekViewsFrom(id: string) {
        if (shouldIgnoreClose()) {
            logPeekDebug('closePeekViewsFrom ignored during ignore window', { id, ignoreCloseUntil });
            return;
        }

        const index = peekViews.value.findIndex((view) => view.id === id);

        if (index < 0) {
            logPeekDebug('closePeekViewsFrom found no matching view', { id, activeIds: peekViews.value.map((view) => view.id) });
            return;
        }

        logPeekDebug('closePeekViewsFrom closing stack tail', {
            id,
            index,
            removedIds: peekViews.value.slice(index).map((view) => view.id),
        });
        peekViews.value = peekViews.value.slice(0, index);
    }

    function closeLatestPeekView() {
        if (shouldIgnoreClose()) {
            logPeekDebug('closeLatestPeekView ignored during ignore window', { ignoreCloseUntil });
            return;
        }

        logPeekDebug('closeLatestPeekView', {
            closingId: peekViews.value.at(-1)?.id,
            stackSize: peekViews.value.length,
        });
        peekViews.value = peekViews.value.slice(0, -1);
    }

    function findPeekView(id: string) {
        return peekViews.value.find((view) => view.id === id);
    }

    function findRowsView(id: string) {
        const view = findPeekView(id);
        return view && isFkPeekRowsView(view) ? view : undefined;
    }

    function findUsageView(id: string) {
        const view = findPeekView(id);
        return view && isFkUsageListView(view) ? view : undefined;
    }

    function applyRowsViewResult(id: string, result: QueryExecutionResult, tableInfo: TableInfo | undefined, emptyMessage: string) {
        const view = findRowsView(id);

        if (!view) {
            logPeekDebug('applyRowsViewResult skipped because rows view was missing', { id, resultKind: result.kind });
            return;
        }

        view.tableInfo = tableInfo;
        view.columns = result.kind === 'rows' ? result.columns : [];
        view.columnStats = result.kind === 'rows' ? result.columnStats : {};
        view.rows = result.kind === 'rows' ? result.rows : [];
        view.loading = false;
        view.errorMessage = result.kind === 'rows' && result.rows.length === 0 ? emptyMessage : undefined;
        logPeekDebug('applyRowsViewResult applied', {
            id,
            resultKind: result.kind,
            rowCount: result.kind === 'rows' ? result.rows.length : 0,
            errorMessage: view.errorMessage,
        });
    }

    async function openPeekView(params: { connectionId: number; relation: FkPeekRelation; value: SqlValue; event: PeekAnchor }) {
        const id = createPeekId();
        appendPeekView(
            createRowsView({
                id,
                connectionId: params.connectionId,
                title: params.relation.targetTable,
                subtitle: `Matched by ${params.relation.targetColumn}`,
                targetTable: params.relation.targetTable,
                targetColumn: params.relation.targetColumn,
            }),
            params.event
        );

        try {
            await opts.ensureTableDetails(params.connectionId, params.relation.targetTable);
            const targetTableInfo = opts.getTableInfo(params.connectionId, params.relation.targetTable);
            const result = await runFkPeekQuery({
                connectionId: params.connectionId,
                sqlDialect: opts.getSqlDialect(params.connectionId),
                relation: params.relation,
                value: params.value,
                limit: 50,
            });

            applyRowsViewResult(id, result, targetTableInfo, 'No related row found.');
        } catch (error) {
            const view = findRowsView(id);

            if (!view) {
                return;
            }

            view.loading = false;
            view.errorMessage = error instanceof Error ? error.message : String(error);
        }
    }

    async function openUsagePeekView(params: { connectionId: number; tableName: string; columnName: string; rowValues: Record<string, SqlValue>; event: PeekAnchor }) {
        const id = createPeekId();
        logPeekDebug('openUsagePeekView start', {
            id,
            connectionId: params.connectionId,
            tableName: params.tableName,
            columnName: params.columnName,
            anchorValue: params.rowValues[params.columnName] ?? null,
        });
        appendPeekView(
            createUsageListView({
                id,
                connectionId: params.connectionId,
                title: 'Peek Usages',
                subtitle: `${params.tableName}.${params.columnName} = ${formatValue(params.rowValues[params.columnName] ?? null, { binaryMode: 'hex' })}`,
                targetTable: params.tableName,
                targetColumn: params.columnName,
                rowValues: params.rowValues,
            }),
            params.event
        );

        try {
            const result = await runFkUsageQuery({
                connectionId: params.connectionId,
                tableName: params.tableName,
                columnName: params.columnName,
                rowValues: params.rowValues,
            });
            logPeekDebug('openUsagePeekView received backend result', {
                id,
                usageCount: result.usages.length,
                relationSources: result.usages.map((usage) => ({
                    sourceTable: usage.relation.sourceTable,
                    sourceColumns: formatUsageRelationColumns(usage.relation, 'source'),
                    targetColumns: formatUsageRelationColumns(usage.relation, 'target'),
                })),
            });

            const view = findUsageView(id);

            if (!view) {
                logPeekDebug('openUsagePeekView aborted because usage view disappeared before results applied', {
                    id,
                    activeIds: peekViews.value.map((entry) => entry.id),
                });
                return;
            }

            view.loading = false;
            view.usages = result.usages.sort(
                (left, right) =>
                    right.rowCount - left.rowCount ||
                    left.relation.sourceTable.localeCompare(right.relation.sourceTable) ||
                    formatUsageRelationColumns(left.relation, 'source').localeCompare(formatUsageRelationColumns(right.relation, 'source'))
            );
            view.errorMessage = result.usages.length === 0 ? 'No foreign key usages found.' : undefined;
            logPeekDebug('openUsagePeekView applied results', {
                id,
                usageCount: view.usages.length,
                errorMessage: view.errorMessage,
                activeIds: peekViews.value.map((entry) => entry.id),
            });
        } catch (error) {
            const view = findUsageView(id);

            if (!view) {
                logPeekDebug('openUsagePeekView caught error after view disappeared', {
                    id,
                    error: error instanceof Error ? error.message : String(error),
                    activeIds: peekViews.value.map((entry) => entry.id),
                });
                return;
            }

            view.loading = false;
            view.errorMessage = error instanceof Error ? error.message : String(error);
            logPeekDebug('openUsagePeekView set error state', {
                id,
                errorMessage: view.errorMessage,
            });
        }
    }

    async function openUsageRowsPeekView(params: { view: FkUsageListView; usage: FkUsageSummary; event: PeekAnchor }) {
        const id = createPeekId();
        appendPeekView(
            createRowsView({
                id,
                connectionId: params.view.connectionId,
                title: params.usage.relation.sourceTable,
                subtitle: `Matched by ${formatUsageRelationColumns(params.usage.relation, 'source')}`,
                targetTable: params.usage.relation.sourceTable,
                targetColumn: formatUsageRelationColumns(params.usage.relation, 'source'),
            }),
            params.event
        );

        try {
            await opts.ensureTableDetails(params.view.connectionId, params.usage.relation.sourceTable);
            const sourceTableInfo = opts.getTableInfo(params.view.connectionId, params.usage.relation.sourceTable);
            const result = await runFkUsageRowsQuery({
                connectionId: params.view.connectionId,
                relation: params.usage.relation,
                rowValues: params.view.rowValues,
                limit: 50,
            });

            applyRowsViewResult(id, result, sourceTableInfo, 'No matching rows found.');
        } catch (error) {
            const view = findRowsView(id);

            if (!view) {
                return;
            }

            view.loading = false;
            view.errorMessage = error instanceof Error ? error.message : String(error);
        }
    }

    function buildPeekContextMenuItems(view: FkPeekRowsView, context: FkPeekMenuContext): ContextMenuEntry[] {
        if (!context.isEditable) {
            return [];
        }

        const relation = findFkPeekRelation(view.tableInfo, context.sourceColumnName);

        if (!relation || !selectedConnectionId.value) {
            return [];
        }

        return [
            {
                id: `peek-relation-${view.id}-${context.sourceColumnName}`,
                label: 'Peek Relation',
                action: async () => {
                    if (!selectedConnectionId.value) {
                        return;
                    }

                    await openPeekView({
                        connectionId: selectedConnectionId.value,
                        relation,
                        value: context.value as SqlValue,
                        event: context.event,
                    });
                },
            },
        ];
    }

    function updatePeekViewPosition(id: string, left: number, top: number) {
        const view = findPeekView(id);

        if (!view) {
            logPeekDebug('updatePeekViewPosition skipped because view was missing', { id, left, top });
            return;
        }

        view.left = left;
        view.top = top;
    }

    function updatePeekViewSize(id: string, width: number, height: number) {
        const view = findPeekView(id);

        if (!view) {
            logPeekDebug('updatePeekViewSize skipped because view was missing', { id, width, height });
            return;
        }

        view.width = width;
        view.height = height;
    }

    function isPeekViewTransposed(view: FkPeekView) {
        return isFkPeekRowsView(view) ? view.isTransposed : false;
    }

    function togglePeekViewTranspose(view: FkPeekView) {
        if (!isFkPeekRowsView(view)) {
            return;
        }

        view.isTransposed = !view.isTransposed;
    }

    function getPeekViewTransposeState(view: FkPeekRowsView) {
        return computed({
            get: () => view.isTransposed,
            set: (value: boolean) => {
                view.isTransposed = value;
            },
        });
    }

    function handleDocumentPointerDown(event: PointerEvent) {
        if (shouldIgnoreClose()) {
            logPeekDebug('handleDocumentPointerDown ignored during ignore window', { targetTagName: event.target instanceof Element ? event.target.tagName : undefined });
            return;
        }

        const topView = peekViews.value.at(-1);

        if (!topView) {
            logPeekDebug('handleDocumentPointerDown ignored because there is no top view');
            return;
        }

        const target = event.target as Node | null;

        if (target instanceof Element && target.closest('.v-menu-root')) {
            logPeekDebug('handleDocumentPointerDown ignored because target is inside context menu', { topViewId: topView.id });
            return;
        }

        if (target instanceof Element && target.closest(`[data-peek-popover-id="${topView.id}"]`)) {
            logPeekDebug('handleDocumentPointerDown ignored because target is inside top popover', { topViewId: topView.id });
            return;
        }

        logPeekDebug('handleDocumentPointerDown closing top view due to outside click', {
            topViewId: topView.id,
            targetTagName: target instanceof Element ? target.tagName : undefined,
        });
        closeLatestPeekView();
    }

    watch(
        () => peekViews.value.length,
        (length) => {
            logPeekDebug('peekViews length changed', { length, activeIds: peekViews.value.map((view) => view.id) });
            if (length > 0) {
                document.addEventListener('pointerdown', handleDocumentPointerDown, true);
                return;
            }

            document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
        },
        { immediate: true }
    );

    watch(
        () => [selectedConnectionId.value, selectedTableName.value],
        ([connectionId, tableName], previousValue) => {
            logPeekDebug('clearing peek views because selected connection or table changed', {
                nextConnectionId: connectionId,
                nextTableName: tableName,
                previousConnectionId: previousValue?.[0],
                previousTableName: previousValue?.[1],
                activeIds: peekViews.value.map((view) => view.id),
            });
            peekViews.value = [];
        }
    );

    onBeforeUnmount(() => {
        document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    });

    return reactive({
        peekViews,
        openPeekView,
        openUsagePeekView,
        openUsageRowsPeekView,
        closePeekViewsFrom,
        buildPeekContextMenuItems,
        updatePeekViewPosition,
        updatePeekViewSize,
        isPeekViewTransposed,
        togglePeekViewTranspose,
        getPeekViewTransposeState,
    });
}

type FkPeekPopoverState = {
    open: boolean;
    loading: boolean;
    left: number;
    top: number;
    title: string;
    anchorColumnName: string | undefined;
    targetTable: string | undefined;
    targetColumn: string | undefined;
    columns: string[];
    row: Record<string, SqlValue> | undefined;
    errorMessage: string | undefined;
};

export function useForeignKeyPeek(opts: {
    connectionId: MaybeReactiveValue<number | undefined>;
    tableInfo: MaybeReactiveValue<TableInfo | undefined>;

    sqlDialect: MaybeReactiveValue<DbType>;
    getDisplayedCellValue: (rowIndex: number, columnName: string) => SqlValue;
}) {
    const connectionId = computed(() => unref(opts.connectionId));
    const tableInfo = computed(() => unref(opts.tableInfo));
    const sqlDialect = computed(() => unref(opts.sqlDialect));

    const fkPeekPopover = reactive<FkPeekPopoverState>({
        open: false,
        loading: false,
        left: 0,
        top: 0,
        title: '',
        anchorColumnName: undefined,
        targetTable: undefined,
        targetColumn: undefined,
        columns: [],
        row: undefined,
        errorMessage: undefined,
    });

    function closeFkPeekPopover() {
        fkPeekPopover.open = false;
        fkPeekPopover.loading = false;
        fkPeekPopover.title = '';
        fkPeekPopover.anchorColumnName = undefined;
        fkPeekPopover.targetTable = undefined;
        fkPeekPopover.targetColumn = undefined;
        fkPeekPopover.columns = [];
        fkPeekPopover.row = undefined;
        fkPeekPopover.errorMessage = undefined;
    }

    function getFkPeekRelation(columnName: string) {
        return findFkPeekRelation(tableInfo.value, columnName);
    }

    async function openFkPeek(rowIndex: number, columnName: string, event: MouseEvent) {
        if (!columnName || !connectionId.value) {
            return;
        }

        const relation = getFkPeekRelation(columnName);

        if (!relation) {
            return;
        }

        const value = opts.getDisplayedCellValue(rowIndex, columnName);
        fkPeekPopover.open = true;
        fkPeekPopover.loading = true;
        fkPeekPopover.left = Math.min(event.clientX + 8, Math.max(window.innerWidth - 372, 12));
        fkPeekPopover.top = Math.min(event.clientY + 8, Math.max(window.innerHeight - 260, 12));
        fkPeekPopover.title = relation.targetTable;
        fkPeekPopover.anchorColumnName = relation.fromColumn;
        fkPeekPopover.targetTable = relation.targetTable;
        fkPeekPopover.targetColumn = relation.targetColumn;
        fkPeekPopover.columns = [];
        fkPeekPopover.row = undefined;
        fkPeekPopover.errorMessage = undefined;

        try {
            const result = await runFkPeekQuery({
                connectionId: connectionId.value,
                sqlDialect: sqlDialect.value,
                relation,
                value,
                limit: 1,
            });

            if (result.kind !== 'rows') {
                fkPeekPopover.errorMessage = 'Relation lookup returned no rows.';
                return;
            }

            fkPeekPopover.columns = result.columns;
            fkPeekPopover.row = result.rows[0];

            if (!fkPeekPopover.row) {
                fkPeekPopover.errorMessage = 'No related row found.';
            }
        } catch (error) {
            fkPeekPopover.errorMessage = error instanceof Error ? error.message : String(error);
        } finally {
            fkPeekPopover.loading = false;
        }
    }

    return reactive({
        fkPeekPopover: fkPeekPopover,
        getFkPeekRelation: getFkPeekRelation,
        openFkPeek: openFkPeek,
        closeFkPeekPopover: closeFkPeekPopover,
    });
}
