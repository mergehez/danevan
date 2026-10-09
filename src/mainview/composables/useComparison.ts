import { computed, reactive, watch } from 'vue';
import type { ConnectionRecord, TableInfo } from '../../shared/types';
import { toast } from '../../shared/utils/useToast';
import {
    collectDatabaseComparison,
    collectTableComparison,
    countComparisonDifferences,
    countDatabaseComparisonDifferences,
    filterComparisonSections,
    formatComparisonMarkdown,
    type BreakingChange,
    type ComparisonFixAction,
    type ComparisonResult,
    type ComparisonSection,
} from '../lib/compareSchemas';
import {
    cloneComparisonOptions,
    comparisonOptionDefinitions,
    readComparisonOptions,
    setComparisonOption,
    toggleComparisonOption,
    writeComparisonOptions,
    type ComparisonOptionId,
    type ComparisonOptions,
} from '../lib/comparisonOptions';
import { buildFixTableInfo, getFixActionTitle, toModifyTableParams } from '../lib/schemaFix';
import { confirmAction } from '../lib/utils';
import { useConnections } from './useConnections';
import { useServers } from './useServers';
import { tasks } from './useTasks';

export type ComparisonMode = 'table' | 'database';

export type ComparisonConnectionOption = {
    label: string;
    value: number;
};

export type ComparisonTableOption = {
    label: string;
    value: string;
};

export function _useComparison() {
    const connections = useConnections();
    const servers = useServers();

    const options = reactive<ComparisonOptions>(cloneComparisonOptions(readComparisonOptions()));
    watch(
        () => options,
        () => writeComparisonOptions(options),
        { deep: true }
    );

    function getConnection(connectionId: number | undefined) {
        return connectionId === undefined ? undefined : connections.connections.find((connection) => connection.id === connectionId);
    }

    function getConnectionDriver(connectionId: number | undefined) {
        const connection = getConnection(connectionId);
        return servers.servers.find((server) => server.id === connection?.server_id)?.driver;
    }

    function describeConnection(connection: ConnectionRecord) {
        const server = servers.servers.find((entry) => entry.id === connection.server_id);
        const databaseName = connection.database_name || connection.name;
        return server ? `${databaseName} — ${server.name}` : databaseName;
    }

    function getTableNames(connectionId: number) {
        return connections
            .getConnectionTablesState(connectionId)
            .tables.filter((table) => table.type === 'table')
            .map((table) => table.name);
    }

    async function loadTableNameList(connectionId: number, force: boolean) {
        await connections.ensureConnectionTables(connectionId, force);
        return getTableNames(connectionId);
    }

    async function loadTableInfo(connectionId: number, tableName: string, force: boolean) {
        await connections.ensureTableDetails(connectionId, tableName, force);
        return connections.getTableDetailsState(connectionId, tableName).info;
    }

    async function loadTableInfos(connectionId: number, tableNames: string[], force: boolean) {
        await Promise.all(tableNames.map((tableName) => connections.ensureTableDetails(connectionId, tableName, force)));

        return tableNames.map((tableName) => connections.getTableDetailsState(connectionId, tableName).info).filter((info): info is TableInfo => Boolean(info));
    }

    function sanitizeFileNamePart(value: string) {
        return value.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'comparison';
    }

    function getFixKey(action: ComparisonFixAction) {
        return `fix:${action.kind}:${action.destination}:${action.tableName}:${action.label}`;
    }

    function normalizeTableName(tableName: string) {
        return tableName.trim().toLowerCase();
    }

    /** The destination table for a fix, from whichever side of the comparison it lives on. */
    function getComparisonTableInfo(side: 'source' | 'target', tableName: string) {
        if (state.mode === 'table') {
            // Table comparison can pair differently named tables, and the action's
            // table name is the destination's own table.
            return side === 'source' ? state.sourceInfo : state.targetInfo;
        }

        const infos = side === 'source' ? state.sourceTableInfos : state.targetTableInfos;
        return infos.find((info) => normalizeTableName(info.name) === normalizeTableName(tableName));
    }

    // A comparison must compare the live schemas, but each side only has to be
    // read once per dialog: picking the other side must not re-read the first.
    // The shared metadata cache can hold a stale table list (its freshness clock
    // is refreshed by any unrelated table load), so it is bypassed here.
    const freshConnectionIds = new Set<number>();
    const shouldForceConnection = (connectionId: number | undefined) => connectionId !== undefined && !freshConnectionIds.has(connectionId);
    const markConnectionFresh = (connectionId: number | undefined) => {
        if (connectionId !== undefined) {
            freshConnectionIds.add(connectionId);
        }
    };

    const state = reactive({
        open: false,
        mode: 'table' as ComparisonMode,
        loading: false,
        errorMessage: '',
        sourceConnectionId: undefined as number | undefined,
        sourceTableName: undefined as string | undefined,
        targetConnectionId: undefined as number | undefined,
        targetTableName: undefined as string | undefined,
        sourceInfo: undefined as TableInfo | undefined,
        targetInfo: undefined as TableInfo | undefined,
        sourceTableInfos: [] as TableInfo[],
        targetTableInfos: [] as TableInfo[],
        showIdentical: false,
        /** Key of the fix currently being applied, so its row can show progress. */
        applyingFixKey: undefined as string | undefined,
        options: options,

        get sourceConnectionLabel() {
            const connection = getConnection(state.sourceConnectionId);
            return connection ? describeConnection(connection) : '';
        },
        get sourceLabel() {
            return state.mode === 'table' && state.sourceTableName ? `${state.sourceConnectionLabel} · ${state.sourceTableName}` : state.sourceConnectionLabel;
        },
        get targetConnectionLabel() {
            const connection = getConnection(state.targetConnectionId);
            return connection ? describeConnection(connection) : '';
        },
        get targetLabel() {
            return state.mode === 'table' && state.targetTableName ? `${state.targetConnectionLabel} · ${state.targetTableName}` : state.targetConnectionLabel;
        },
        /** Same-driver connections only: type and collation text is dialect specific. */
        get targetConnectionOptions() {
            const driver = getConnectionDriver(state.sourceConnectionId);

            return connections.connections
                .filter((connection) => !(state.mode === 'database' && connection.id === state.sourceConnectionId))
                .filter((connection) => driver === undefined || getConnectionDriver(connection.id) === driver)
                .map((connection) => ({ label: describeConnection(connection), value: connection.id }) satisfies ComparisonConnectionOption);
        },
        get targetTableOptions() {
            if (state.targetConnectionId === undefined) {
                return [] as ComparisonTableOption[];
            }

            return getTableNames(state.targetConnectionId)
                .filter((tableName) => !(state.mode === 'table' && state.targetConnectionId === state.sourceConnectionId && tableName === state.sourceTableName))
                .map((tableName) => ({ label: tableName, value: tableName }) satisfies ComparisonTableOption);
        },
        get sections(): ComparisonSection[] {
            return comparisonResult.value.sections;
        },
        get breakingChanges(): BreakingChange[] {
            return comparisonResult.value.breakingChanges;
        },
        get breakingCount() {
            return comparisonResult.value.breakingChanges.length;
        },
        get visibleSections(): ComparisonSection[] {
            return filterComparisonSections(comparisonResult.value.sections, state.showIdentical);
        },
        get differenceCount() {
            return state.mode === 'table' ? countComparisonDifferences(comparisonResult.value.sections) : countDatabaseComparisonDifferences(comparisonResult.value.sections);
        },
        get ignoredBreakingCount() {
            return comparisonResult.value.ignoredBreakingCount;
        },
        get canCompare() {
            return state.mode === 'table' ? Boolean(state.sourceInfo && state.targetInfo) : state.targetConnectionId !== undefined && state.targetTableInfos.length > 0;
        },
        get canSwap() {
            return state.mode === 'table' ? Boolean(state.targetConnectionId !== undefined && state.targetTableName) : state.targetConnectionId !== undefined;
        },

        async loadComparison(force: boolean) {
            state.loading = true;
            state.errorMessage = '';

            if (force) {
                freshConnectionIds.clear();
            }

            try {
                if (state.mode === 'table') {
                    const { sourceConnectionId, sourceTableName, targetConnectionId, targetTableName } = state;

                    if (sourceConnectionId === undefined || !sourceTableName) {
                        return;
                    }

                    const [sourceInfo, targetInfo] = await Promise.all([
                        loadTableInfo(sourceConnectionId, sourceTableName, shouldForceConnection(sourceConnectionId)),
                        targetConnectionId !== undefined && targetTableName
                            ? loadTableInfo(targetConnectionId, targetTableName, shouldForceConnection(targetConnectionId))
                            : Promise.resolve(undefined),
                    ]);

                    markConnectionFresh(sourceConnectionId);

                    if (targetConnectionId !== undefined && targetTableName) {
                        markConnectionFresh(targetConnectionId);
                    }

                    state.sourceInfo = sourceInfo;
                    state.targetInfo = targetInfo;
                    return;
                }

                const { sourceConnectionId, targetConnectionId } = state;

                if (sourceConnectionId === undefined) {
                    return;
                }

                const sourceForce = shouldForceConnection(sourceConnectionId);
                const targetForce = shouldForceConnection(targetConnectionId);
                const sourceTableNames = await loadTableNameList(sourceConnectionId, sourceForce);
                const targetTableNames = targetConnectionId === undefined ? [] : await loadTableNameList(targetConnectionId, targetForce);
                const [sourceTableInfos, targetTableInfos] = await Promise.all([
                    loadTableInfos(sourceConnectionId, sourceTableNames, sourceForce),
                    targetConnectionId === undefined ? Promise.resolve([] as TableInfo[]) : loadTableInfos(targetConnectionId, targetTableNames, targetForce),
                ]);

                markConnectionFresh(sourceConnectionId);
                markConnectionFresh(targetConnectionId);
                state.sourceTableInfos = sourceTableInfos;
                state.targetTableInfos = targetTableInfos;
            } catch (error) {
                state.errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
                state.loading = false;
            }
        },

        async openTableComparison(params: { connectionId: number; tableName: string }) {
            state.mode = 'table';
            state.open = true;
            freshConnectionIds.clear();
            state.sourceConnectionId = params.connectionId;
            state.sourceTableName = params.tableName;
            state.targetConnectionId = undefined;
            state.targetTableName = undefined;
            state.sourceInfo = undefined;
            state.targetInfo = undefined;
            state.sourceTableInfos = [];
            state.targetTableInfos = [];
            await state.loadComparison(false);
        },

        async openDatabaseComparison(params: { connectionId: number }) {
            state.mode = 'database';
            state.open = true;
            freshConnectionIds.clear();
            state.sourceConnectionId = params.connectionId;
            state.sourceTableName = undefined;
            state.targetConnectionId = undefined;
            state.targetTableName = undefined;
            state.sourceInfo = undefined;
            state.targetInfo = undefined;
            state.sourceTableInfos = [];
            state.targetTableInfos = [];
            await state.loadComparison(false);
        },

        closeModal() {
            state.open = false;
            state.loading = false;
            freshConnectionIds.clear();
            state.errorMessage = '';
            state.sourceConnectionId = undefined;
            state.sourceTableName = undefined;
            state.targetConnectionId = undefined;
            state.targetTableName = undefined;
            state.sourceInfo = undefined;
            state.targetInfo = undefined;
            state.sourceTableInfos = [];
            state.targetTableInfos = [];
            state.showIdentical = false;
        },

        async selectTargetConnection(connectionId: number | undefined) {
            if (connectionId === state.targetConnectionId) {
                return;
            }

            state.targetConnectionId = connectionId;
            state.targetTableName = undefined;
            state.targetInfo = undefined;
            state.targetTableInfos = [];

            if (connectionId !== undefined) {
                // Fill the table picker even when the comparison itself cannot run yet.
                await loadTableNameList(connectionId, false);
            }

            await state.loadComparison(false);
        },

        async selectTargetTable(tableName: string | undefined) {
            if (tableName === state.targetTableName) {
                return;
            }

            state.targetTableName = tableName;
            state.targetInfo = undefined;
            await state.loadComparison(false);
        },

        async swapSides() {
            const previousSource = {
                connectionId: state.sourceConnectionId,
                tableName: state.sourceTableName,
                info: state.sourceInfo,
                tableInfos: state.sourceTableInfos,
            };

            state.sourceConnectionId = state.targetConnectionId;
            state.sourceTableName = state.mode === 'table' ? state.targetTableName : undefined;
            state.sourceInfo = state.targetInfo;
            state.sourceTableInfos = state.targetTableInfos;
            state.targetConnectionId = previousSource.connectionId;
            state.targetTableName = state.mode === 'table' ? previousSource.tableName : undefined;
            state.targetInfo = previousSource.info;
            state.targetTableInfos = previousSource.tableInfos;
            await state.loadComparison(false);
        },

        async refresh() {
            await state.loadComparison(true);
        },

        /** Tooltip and confirmation text for an additive fix. */
        describeFix(action: ComparisonFixAction) {
            const destinationLabel = action.destination === 'target' ? state.targetConnectionLabel : state.sourceConnectionLabel;
            return `Add ${action.label} to ${destinationLabel || action.destination}`;
        },

        isApplyingFix(action: ComparisonFixAction) {
            return state.applyingFixKey === getFixKey(action);
        },

        /** False when applying the fix automatically would not be a pure addition. */
        canApplyFix(action: ComparisonFixAction) {
            if (action.kind === 'add-key' && action.key?.isPrimary) {
                const destinationInfo = getComparisonTableInfo(action.destination, action.tableName);
                return !destinationInfo?.columns.some((column) => column.isPrimaryKey);
            }

            return true;
        },

        getFixTooltip(action: ComparisonFixAction) {
            return state.canApplyFix(action)
                ? state.describeFix(action)
                : `${state.describeFix(action)} — the destination already has a primary key, so this one needs a manual change.`;
        },

        /**
         * Additive fix: copies the object that only exists on one side into the
         * side that is missing it. Nothing is ever dropped or altered.
         */
        async applyFix(action: ComparisonFixAction) {
            const destinationConnectionId = action.destination === 'target' ? state.targetConnectionId : state.sourceConnectionId;
            const donorConnectionId = action.destination === 'target' ? state.sourceConnectionId : state.targetConnectionId;

            if (destinationConnectionId === undefined || state.applyingFixKey !== undefined || !state.canApplyFix(action)) {
                return;
            }

            if (
                !(await confirmAction({
                    title: getFixActionTitle(action),
                    message: state.describeFix(action),
                    detail: 'The object is copied from the other side of this comparison. Nothing else on the destination table is changed.',
                    confirmLabel: 'Add',
                }))
            ) {
                return;
            }

            const fixKey = getFixKey(action);
            state.applyingFixKey = fixKey;
            state.errorMessage = '';

            try {
                if (action.kind === 'create-table') {
                    if (donorConnectionId === undefined) {
                        throw new Error('The table that owns this schema could not be found.');
                    }

                    const ddl = await tasks.getTableDdl.run({ connectionId: donorConnectionId, tableName: action.tableName }, fixKey);
                    await tasks.runQuery.run({ connectionId: destinationConnectionId, sql: ddl }, fixKey);
                } else {
                    const destinationInfo = getComparisonTableInfo(action.destination, action.tableName);

                    if (!destinationInfo) {
                        throw new Error(`Table "${action.tableName}" is not loaded on the ${action.destination} side any more. Reload the comparison and try again.`);
                    }

                    const nextInfo = buildFixTableInfo(destinationInfo, action);

                    if (!nextInfo) {
                        throw new Error('This fix cannot be applied automatically.');
                    }

                    await tasks.modifyTable.run(toModifyTableParams(destinationConnectionId, nextInfo), fixKey);
                }

                toast.showToast(`Added ${action.label}.`);
                // Re-read the side that just changed so the fixed row disappears.
                freshConnectionIds.delete(destinationConnectionId);
                await state.loadComparison(false);
            } catch (error) {
                state.errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
                state.applyingFixKey = undefined;
            }
        },

        setOption(id: ComparisonOptionId, value: boolean) {
            setComparisonOption(options, id, value);
        },

        toggleOption(id: ComparisonOptionId) {
            toggleComparisonOption(options, id);
        },

        getOption(id: ComparisonOptionId) {
            return comparisonOptionDefinitions.find((definition) => definition.id === id)?.get(options) ?? false;
        },

        exportMarkdown() {
            const isTableComparison = state.mode === 'table';
            const sourceName = sanitizeFileNamePart(getConnection(state.sourceConnectionId)?.database_name || getConnection(state.sourceConnectionId)?.name || 'source');
            const targetName = sanitizeFileNamePart(getConnection(state.targetConnectionId)?.database_name || getConnection(state.targetConnectionId)?.name || 'target');
            const subject = isTableComparison ? `${state.sourceTableName ?? 'table'}-vs-${state.targetTableName ?? 'table'}` : `${sourceName}-vs-${targetName}`;
            const markdown = formatComparisonMarkdown({
                title: isTableComparison ? 'Table comparison' : 'Database comparison',
                sourceLabel: state.sourceLabel || 'source',
                targetLabel: state.targetLabel || 'target',
                sections: state.visibleSections,
                breakingChanges: state.breakingChanges,
                ignoredBreakingCount: state.ignoredBreakingCount,
                generatedAt: new Date().toISOString(),
            });
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.href = url;
            link.download = `${sanitizeFileNamePart(`schema-comparison-${subject}`)}.md`;
            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            toast.showToast('Comparison exported as Markdown.');
        },
    });

    // Kept outside `state` so its initializer can read `state` without a circular type.
    const comparisonResult = computed<ComparisonResult>(() => {
        if (state.mode === 'table') {
            return state.sourceInfo && state.targetInfo
                ? collectTableComparison(state.sourceInfo, state.targetInfo, options)
                : { sections: [], breakingChanges: [], ignoredBreakingCount: 0 };
        }

        return state.sourceTableInfos.length === 0 && state.targetTableInfos.length === 0
            ? { sections: [], breakingChanges: [], ignoredBreakingCount: 0 }
            : collectDatabaseComparison(state.sourceTableInfos, state.targetTableInfos, options);
    });

    return state;
}

let comparisonSingleton: ReturnType<typeof _useComparison> | undefined;

export function useComparison() {
    comparisonSingleton ??= _useComparison();
    return comparisonSingleton;
}
