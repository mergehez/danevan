import { reactive, watch } from 'vue';
import type { MonacoDiagnosticMarker } from '../lib/monaco';
import type { TableInfo } from '../../shared/types';
import { getDbCollationOptionsQuery, normalizeDbCollationOptions } from '../lib/collations';
import { confirmAction } from '../lib/utils';
import { useConnections } from './useConnections';
import { useServers } from './useServers';
import { tasks } from './useTasks';
import { buildPreviewStatements } from './modifyTable/preview';
import {
    cloneColumns,
    createForeignKeyColumnDraft,
    createForeignKeyDrafts,
    createIndexColumnDraft,
    createIndexDrafts,
    createKeyColumnDraft,
    createKeyDrafts,
    createNewColumn,
    createNewForeignKey,
    createNewIndex,
    createNewKey,
    createPrimaryKeyDraft,
    createTableDraft,
    getActiveColumns,
    getPrimaryKeyDraft,
    moveArrayEntry,
    syncAutoEntityNames,
    syncColumnsWithPrimaryKeyDraft,
} from './modifyTable/drafts';
import { applyModifyTableChanges } from './modifyTable/apply';
import { createModifyTableHistory } from './modifyTable/history';
import { buildNavigationSections } from './modifyTable/navigation';
import { createPreviewDiagnostic } from './modifyTable/types';
import type {
    ModifyTableColumnDraft,
    ModifyTableForeignKeyDraft,
    ModifyTableGroupKind,
    ModifyTableIndexDraft,
    ModifyTableKeyDraft,
    ModifyTableMode,
    ModifyTableOpenParams,
    ModifyTableSelectionKind,
} from './modifyTable/types';
import { getModifyTableValidationErrors, getMsAccessExplicitPlanErrors } from './modifyTable/validation';

export type { ModifyTablePreviewState } from './modifyTable/types';
export { buildPreviewStatements, hasExtendedSchemaChanges } from './modifyTable/preview';
export { resolveForeignKeyDraftName } from './modifyTable/drafts';

export function _useModifyTable() {
    const connections = useConnections();
    const servers = useServers();
    /** Incremented per openModal; a slow load must not fill the draft of a later table. */
    let openModalSequence = 0;

    const state = reactive({
        mode: 'edit' as ModifyTableMode,
        open: false,
        loading: false,
        applying: false,
        allowTableRebuild: false,
        connectionId: undefined as number | undefined,
        tableName: undefined as string | undefined,
        errorMessage: '',
        currentTableInfo: undefined as TableInfo | undefined,
        collationOptions: [] as string[],
        table: createTableDraft('', undefined),
        columns: [] as ModifyTableColumnDraft[],
        originalColumns: [] as ModifyTableColumnDraft[],
        keys: [] as ModifyTableKeyDraft[],
        foreignKeys: [] as ModifyTableForeignKeyDraft[],
        indexes: [] as ModifyTableIndexDraft[],
        selectedNodeId: undefined as string | undefined,
        selectedKeyColumnId: undefined as string | undefined,
        selectedForeignKeyColumnId: undefined as string | undefined,
        selectedIndexColumnId: undefined as string | undefined,
        get connection() {
            return connections.connections.find((connection) => connection.id === state.connectionId);
        },
        get server() {
            const serverId = state.connection?.server_id;
            return servers.servers.find((server) => server.id === serverId);
        },
        get driver() {
            const serverId = state.connection?.server_id;
            return servers.servers.find((server) => server.id === serverId)?.driver;
        },
        get isCreateMode() {
            return state.mode === 'create';
        },
        get existingTableNames() {
            if (!state.connectionId) {
                return [] as string[];
            }

            return connections.getConnectionTablesState(state.connectionId).tables.map((table) => table.name);
        },
        get activeColumnNames() {
            return getActiveColumns(state.columns)
                .map((column) => column.name)
                .filter((columnName) => !!columnName);
        },
        get collationOptionValues() {
            return state.collationOptions;
        },
        get targetTableNames() {
            if (!state.connectionId) {
                return [] as string[];
            }

            const tableNames = connections.getConnectionTablesState(state.connectionId).tables.map((table) => table.name);
            const referencedTableNames = state.foreignKeys.map((foreignKey) => foreignKey.targetTable).filter((tableName) => !!tableName);
            return [...new Set([...tableNames, ...referencedTableNames])];
        },
        getTargetTableColumnNames(tableName: string | undefined) {
            if (!state.connectionId || !tableName) {
                return [] as string[];
            }

            return (connections.getTableDetailsState(state.connectionId, tableName).info?.columns ?? []).map((column) => column.name);
        },
        get navigationSections() {
            return buildNavigationSections(state);
        },
        get selectedKind() {
            if (!state.selectedNodeId) {
                return undefined as ModifyTableSelectionKind | undefined;
            }

            if (state.selectedNodeId === 'table') {
                return 'table' as const;
            }

            if (state.selectedNodeId.startsWith('group:')) {
                return 'group' as const;
            }

            if (state.selectedNodeId.startsWith('column:')) {
                return 'column' as const;
            }

            if (state.selectedNodeId.startsWith('key:')) {
                return 'key' as const;
            }

            if (state.selectedNodeId.startsWith('foreign-key:')) {
                return 'foreign-key' as const;
            }

            if (state.selectedNodeId.startsWith('index:')) {
                return 'index' as const;
            }

            return undefined as ModifyTableSelectionKind | undefined;
        },
        get selectedGroupKind() {
            if (state.selectedKind === 'group') {
                return state.selectedNodeId?.slice('group:'.length) as ModifyTableGroupKind | undefined;
            }

            if (state.selectedKind === 'column') {
                return 'columns' as const;
            }

            if (state.selectedKind === 'key') {
                return 'keys' as const;
            }

            if (state.selectedKind === 'foreign-key') {
                return 'foreign-keys' as const;
            }

            if (state.selectedKind === 'index') {
                return 'indexes' as const;
            }

            return undefined as ModifyTableGroupKind | undefined;
        },
        get selectedColumnId() {
            return state.selectedKind === 'column' ? state.selectedNodeId?.slice('column:'.length) : undefined;
        },
        get selectedColumn() {
            return state.columns.find((column) => column.id === state.selectedColumnId);
        },
        get hasPrimaryKey() {
            return !!getPrimaryKeyDraft(state.keys);
        },
        get canMakeSelectedColumnPrimaryKey() {
            const column = state.selectedColumn;

            return !!column && column.status !== 'deleted' && !state.hasPrimaryKey;
        },
        get autoIncrementPrimaryKeyWarning() {
            const column = state.selectedColumn;

            if (!column || column.status === 'deleted' || !column.isAutoIncrement || column.isPrimaryKey || state.hasPrimaryKey) {
                return undefined as string | undefined;
            }

            return `Column ${column.name.trim() || '(unnamed)'} can only be auto-increment when it is part of the primary key.`;
        },
        get selectedTable() {
            return state.selectedKind === 'table' ? state.table : undefined;
        },
        get selectedKeyId() {
            return state.selectedKind === 'key' ? state.selectedNodeId?.slice('key:'.length) : undefined;
        },
        get selectedKey() {
            return state.keys.find((key) => key.id === state.selectedKeyId);
        },
        get selectedKeyColumn() {
            return state.selectedKey?.columns.find((column) => column.id === state.selectedKeyColumnId);
        },
        get selectedForeignKeyId() {
            return state.selectedKind === 'foreign-key' ? state.selectedNodeId?.slice('foreign-key:'.length) : undefined;
        },
        get selectedForeignKey() {
            return state.foreignKeys.find((foreignKey) => foreignKey.id === state.selectedForeignKeyId);
        },
        get selectedForeignKeyColumn() {
            return state.selectedForeignKey?.columns.find((column) => column.id === state.selectedForeignKeyColumnId);
        },
        get selectedIndexId() {
            return state.selectedKind === 'index' ? state.selectedNodeId?.slice('index:'.length) : undefined;
        },
        get selectedIndex() {
            return state.indexes.find((index) => index.id === state.selectedIndexId);
        },
        get selectedIndexColumn() {
            return state.selectedIndex?.columns.find((column) => column.id === state.selectedIndexColumnId);
        },
        get canDeleteSelection() {
            if (state.selectedKind === 'column') {
                return !!state.selectedColumn && !state.selectedColumn.isPrimaryKey;
            }

            return state.selectedKind === 'key' || state.selectedKind === 'foreign-key' || state.selectedKind === 'index';
        },
        get canDuplicateSelection() {
            return state.selectedKind === 'column' || state.selectedKind === 'key' || state.selectedKind === 'foreign-key' || state.selectedKind === 'index';
        },
        get canMoveSelectionUp() {
            if (state.selectedKind === 'column') {
                const selectedColumn = state.selectedColumn;
                return !!selectedColumn && state.columns.findIndex((column) => column.id === selectedColumn.id) > 0;
            }

            if (state.selectedKind === 'key') {
                const selectedKey = state.selectedKey;
                return !!selectedKey && state.keys.findIndex((key) => key.id === selectedKey.id) > 0;
            }

            if (state.selectedKind === 'foreign-key') {
                const selectedForeignKey = state.selectedForeignKey;
                return !!selectedForeignKey && state.foreignKeys.findIndex((foreignKey) => foreignKey.id === selectedForeignKey.id) > 0;
            }

            if (state.selectedKind === 'index') {
                const selectedIndex = state.selectedIndex;
                return !!selectedIndex && state.indexes.findIndex((index) => index.id === selectedIndex.id) > 0;
            }

            return false;
        },
        get canMoveSelectionDown() {
            if (state.selectedKind === 'column') {
                const selectedColumn = state.selectedColumn;
                return !!selectedColumn && state.columns.findIndex((column) => column.id === selectedColumn.id) < state.columns.length - 1;
            }

            if (state.selectedKind === 'key') {
                const selectedKey = state.selectedKey;
                return !!selectedKey && state.keys.findIndex((key) => key.id === selectedKey.id) < state.keys.length - 1;
            }

            if (state.selectedKind === 'foreign-key') {
                const selectedForeignKey = state.selectedForeignKey;
                return !!selectedForeignKey && state.foreignKeys.findIndex((foreignKey) => foreignKey.id === selectedForeignKey.id) < state.foreignKeys.length - 1;
            }

            if (state.selectedKind === 'index') {
                const selectedIndex = state.selectedIndex;
                return !!selectedIndex && state.indexes.findIndex((index) => index.id === selectedIndex.id) < state.indexes.length - 1;
            }

            return false;
        },
        get validationErrors() {
            return getModifyTableValidationErrors(state);
        },
        get rebuildWarnings() {
            return state.driver === 'msaccess' ? getMsAccessExplicitPlanErrors(state) : ([] as string[]);
        },
        get previewStatements(): string[] {
            return buildPreviewStatements(state);
        },
        get previewSql(): string {
            return state.previewStatements.join('\n\n');
        },
        get previewDisplaySql(): string {
            return state.previewStatements.length > 0 ? state.previewStatements.join('\n\n') : '-- No schema changes yet';
        },
        get previewMarkers(): MonacoDiagnosticMarker[] {
            return [
                ...state.validationErrors.map((message) => createPreviewDiagnostic(message, 'warning')),
                ...state.rebuildWarnings.map((message) => createPreviewDiagnostic(message, 'warning')),
            ];
        },
        get canEditComment() {
            return state.driver === 'mysql' || state.driver === 'postgresql';
        },
        get canEditCollation() {
            return state.driver === 'mysql' || state.driver === 'sqlite';
        },
        get canEditOnUpdate() {
            return state.driver === 'mysql';
        },
        get canEditAutoIncrement() {
            return state.driver === 'mysql' || state.driver === 'sqlite';
        },
        get canApply(): boolean {
            return !state.loading && !state.applying && state.validationErrors.length === 0 && state.previewStatements.length > 0;
        },
        get canUndo() {
            return draftHistory.canUndo;
        },
        get canRedo() {
            return draftHistory.canRedo;
        },
        enableTableRebuild() {
            state.allowTableRebuild = true;
        },
        selectNode(nodeId: string) {
            state.selectedNodeId = nodeId;
            state.errorMessage = '';

            if (nodeId.startsWith('key:')) {
                const keyId = nodeId.slice('key:'.length);
                state.selectedKeyColumnId = state.keys.find((key) => key.id === keyId)?.columns[0]?.id;
            }

            if (nodeId.startsWith('foreign-key:')) {
                const foreignKeyId = nodeId.slice('foreign-key:'.length);
                state.selectedForeignKeyColumnId = state.foreignKeys.find((foreignKey) => foreignKey.id === foreignKeyId)?.columns[0]?.id;
            }

            if (nodeId.startsWith('index:')) {
                const indexId = nodeId.slice('index:'.length);
                state.selectedIndexColumnId = state.indexes.find((index) => index.id === indexId)?.columns[0]?.id;
            }
        },
        selectTable() {
            state.selectNode('table');
        },
        selectGroup(groupKind: ModifyTableGroupKind) {
            state.selectNode(`group:${groupKind}`);
        },
        async openModal(params: ModifyTableOpenParams) {
            const mode = params.mode ?? 'edit';
            const openId = ++openModalSequence;

            state.open = true;
            state.loading = true;
            state.errorMessage = '';
            state.mode = mode;
            state.connectionId = params.connectionId;
            state.tableName = mode === 'edit' ? params.tableName : undefined;

            try {
                if (mode === 'create') {
                    await Promise.all([connections.ensureConnectionTables(params.connectionId), state.loadCollationOptions(params.connectionId)]);

                    // The modal may have been reopened for another table while this loaded.
                    if (openId !== openModalSequence) {
                        return;
                    }

                    state.currentTableInfo = undefined;
                    state.table = createTableDraft(params.tableName ?? '', state.driver);
                    state.originalColumns = [];
                    state.columns = [createNewColumn([], state.driver)];
                    state.keys = [];
                    state.foreignKeys = [];
                    state.indexes = [];
                } else {
                    const tableName = params.tableName!;

                    await Promise.all([connections.ensureTableDetails(params.connectionId, tableName, true), state.loadCollationOptions(params.connectionId)]);

                    if (openId !== openModalSequence) {
                        return;
                    }

                    const tableInfo = connections.getTableDetailsState(params.connectionId, tableName).info;

                    if (!tableInfo) {
                        throw new Error('Unable to load table details.');
                    }

                    state.currentTableInfo = tableInfo;
                    state.table = createTableDraft(tableInfo.name, state.driver, tableInfo);
                    state.originalColumns = cloneColumns(tableInfo.columns);
                    state.columns = cloneColumns(tableInfo.columns);
                    state.keys = createKeyDrafts(tableInfo, state.driver);
                    state.foreignKeys = createForeignKeyDrafts(tableInfo.name, tableInfo);
                    state.indexes = createIndexDrafts(tableInfo, state.driver);
                }

                state.selectedNodeId = 'table';
                state.selectedKeyColumnId = undefined;
                state.selectedForeignKeyColumnId = undefined;
                state.selectedIndexColumnId = undefined;
                state.allowTableRebuild = false;
                draftHistory.reset();
            } catch (error) {
                if (openId === openModalSequence) {
                    state.errorMessage = error instanceof Error ? error.message : String(error);
                }
            } finally {
                if (openId === openModalSequence) {
                    state.loading = false;
                }
            }
        },
        async loadCollationOptions(connectionId?: number) {
            const effectiveConnectionId = connectionId ?? state.connectionId;

            if (!effectiveConnectionId) {
                state.collationOptions = [];
                return;
            }

            const sql = getDbCollationOptionsQuery(state.driver);

            if (!sql) {
                state.collationOptions = [];
                return;
            }

            try {
                const result = await tasks.runQuery.run(
                    {
                        connectionId: effectiveConnectionId,
                        sql,
                    },
                    `modify-table-collations:${effectiveConnectionId}:${state.driver ?? 'unknown'}`
                );

                state.collationOptions = result.kind === 'rows' ? normalizeDbCollationOptions(state.driver, result.rows as Array<Record<string, unknown>>) : [];
            } catch {
                state.collationOptions = [];
            }
        },
        async ensureTargetTableDetails(tableName: string | undefined) {
            if (!state.connectionId || !tableName) {
                return;
            }

            await connections.ensureTableDetails(state.connectionId, tableName);
        },
        closeModal() {
            state.mode = 'edit';
            state.open = false;
            state.loading = false;
            state.applying = false;
            state.allowTableRebuild = false;
            state.connectionId = undefined;
            state.tableName = undefined;
            state.errorMessage = '';
            state.currentTableInfo = undefined;
            state.collationOptions = [];
            state.table = createTableDraft('', undefined);
            state.columns = [];
            state.originalColumns = [];
            state.keys = [];
            state.foreignKeys = [];
            state.indexes = [];
            state.selectedNodeId = undefined;
            state.selectedKeyColumnId = undefined;
            state.selectedForeignKeyColumnId = undefined;
            state.selectedIndexColumnId = undefined;
            draftHistory.reset();
        },
        selectColumn(columnId: string) {
            state.selectNode(`column:${columnId}`);
        },
        addColumn() {
            const column = createNewColumn(state.columns, state.driver);
            state.columns.push(column);
            state.selectNode(`column:${column.id}`);
        },
        async deleteSelectedColumn() {
            const column = state.selectedColumn;

            if (!column || column.isPrimaryKey) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Delete column?',
                    message: `This will remove the column ${column.name}.`,
                    detail:
                        column.status === 'new' ? 'The column will be removed from the draft immediately.' : 'The column will be marked for deletion in the schema change plan.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            if (column.status === 'new') {
                state.columns = state.columns.filter((entry) => entry.id !== column.id);
                state.selectGroup('columns');
                return;
            }

            column.status = 'deleted';
        },
        restoreSelectedColumn() {
            const column = state.selectedColumn;

            if (!column || column.status !== 'deleted') {
                return;
            }

            column.status = 'existing';
        },
        addKey() {
            const key = createNewKey(state.keys, state.activeColumnNames);
            state.keys.push(key);
            state.selectNode(`key:${key.id}`);
        },
        makeSelectedColumnPrimaryKey() {
            const column = state.selectedColumn;

            if (!column || column.status === 'deleted' || state.hasPrimaryKey) {
                return;
            }

            const key = createPrimaryKeyDraft(column.name);
            state.keys.unshift(key);
            state.selectNode(`key:${key.id}`);
        },
        async deleteSelectedKey() {
            const key = state.selectedKey;

            if (!key) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Delete key?',
                    message: `This will remove the key ${key.name}.`,
                    detail: key.status === 'new' ? 'The key will be removed from the draft immediately.' : 'The key will be marked for deletion in the schema change plan.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            if (key.status === 'new') {
                state.keys = state.keys.filter((entry) => entry.id !== key.id);
                state.selectGroup('keys');
                return;
            }

            key.status = 'deleted';
        },
        restoreSelectedKey() {
            if (state.selectedKey?.status === 'deleted') {
                state.selectedKey.status = 'existing';
            }
        },
        duplicateSelectedKey() {
            const key = state.selectedKey;

            if (!key) {
                return;
            }

            const duplicate = {
                ...key,
                id: `new:${crypto.randomUUID()}`,
                originalName: undefined,
                name: `${key.name}_copy`,
                columns: key.columns.map((column) => createKeyColumnDraft(column.columnName)),
                status: 'new',
            } satisfies ModifyTableKeyDraft;
            state.keys.push(duplicate);
            state.selectNode(`key:${duplicate.id}`);
        },
        moveSelectedKeyUp() {
            moveArrayEntry(state.keys, state.selectedKey, 'up');
        },
        moveSelectedKeyDown() {
            moveArrayEntry(state.keys, state.selectedKey, 'down');
        },
        selectKeyColumn(columnId: string) {
            state.selectedKeyColumnId = columnId;
        },
        addSelectedKeyColumn() {
            if (!state.selectedKey) {
                return;
            }

            const nextColumn = createKeyColumnDraft(state.activeColumnNames[0] ?? '');
            state.selectedKey.columns.push(nextColumn);
            state.selectedKeyColumnId = nextColumn.id;
        },
        async removeSelectedKeyColumn() {
            if (!state.selectedKey || !state.selectedKeyColumnId) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Remove key column?',
                    message: `This will remove ${state.selectedKeyColumn?.columnName || 'the selected column'} from ${state.selectedKey.name}.`,
                    confirmLabel: 'Remove',
                }))
            ) {
                return;
            }

            state.selectedKey.columns = state.selectedKey.columns.filter((column) => column.id !== state.selectedKeyColumnId);
            state.selectedKeyColumnId = state.selectedKey.columns[0]?.id;
        },
        moveSelectedKeyColumnUp() {
            moveArrayEntry(state.selectedKey?.columns ?? [], state.selectedKeyColumn, 'up');
        },
        moveSelectedKeyColumnDown() {
            moveArrayEntry(state.selectedKey?.columns ?? [], state.selectedKeyColumn, 'down');
        },
        addForeignKey() {
            const foreignKey = createNewForeignKey(state.foreignKeys, state.activeColumnNames, state.table.name.trim() || state.tableName);
            state.foreignKeys.push(foreignKey);
            state.selectNode(`foreign-key:${foreignKey.id}`);
        },
        async deleteSelectedForeignKey() {
            const foreignKey = state.selectedForeignKey;

            if (!foreignKey) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Delete foreign key?',
                    message: `This will remove the foreign key ${foreignKey.name}.`,
                    detail:
                        foreignKey.status === 'new'
                            ? 'The foreign key will be removed from the draft immediately.'
                            : 'The foreign key will be marked for deletion in the schema change plan.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            if (foreignKey.status === 'new') {
                state.foreignKeys = state.foreignKeys.filter((entry) => entry.id !== foreignKey.id);
                state.selectGroup('foreign-keys');
                return;
            }

            foreignKey.status = 'deleted';
        },
        restoreSelectedForeignKey() {
            if (state.selectedForeignKey?.status === 'deleted') {
                state.selectedForeignKey.status = 'existing';
            }
        },
        duplicateSelectedForeignKey() {
            const foreignKey = state.selectedForeignKey;

            if (!foreignKey) {
                return;
            }

            const duplicate = {
                ...foreignKey,
                id: `new:${crypto.randomUUID()}`,
                originalName: undefined,
                name: `${foreignKey.name}_copy`,
                autoName: undefined,
                columns: foreignKey.columns.map((column) => createForeignKeyColumnDraft(column.columnName, column.targetName)),
                status: 'new',
            } satisfies ModifyTableForeignKeyDraft;
            state.foreignKeys.push(duplicate);
            state.selectNode(`foreign-key:${duplicate.id}`);
        },
        moveSelectedForeignKeyUp() {
            moveArrayEntry(state.foreignKeys, state.selectedForeignKey, 'up');
        },
        moveSelectedForeignKeyDown() {
            moveArrayEntry(state.foreignKeys, state.selectedForeignKey, 'down');
        },
        selectForeignKeyColumn(columnId: string) {
            state.selectedForeignKeyColumnId = columnId;
        },
        addSelectedForeignKeyColumn() {
            if (!state.selectedForeignKey) {
                return;
            }

            const nextColumn = createForeignKeyColumnDraft(state.activeColumnNames[0] ?? '', '');
            state.selectedForeignKey.columns.push(nextColumn);
            state.selectedForeignKeyColumnId = nextColumn.id;
        },
        async removeSelectedForeignKeyColumn() {
            if (!state.selectedForeignKey || !state.selectedForeignKeyColumnId) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Remove foreign key column?',
                    message: `This will remove ${state.selectedForeignKeyColumn?.columnName || 'the selected column'} from ${state.selectedForeignKey.name}.`,
                    confirmLabel: 'Remove',
                }))
            ) {
                return;
            }

            state.selectedForeignKey.columns = state.selectedForeignKey.columns.filter((column) => column.id !== state.selectedForeignKeyColumnId);
            state.selectedForeignKeyColumnId = state.selectedForeignKey.columns[0]?.id;
        },
        moveSelectedForeignKeyColumnUp() {
            moveArrayEntry(state.selectedForeignKey?.columns ?? [], state.selectedForeignKeyColumn, 'up');
        },
        moveSelectedForeignKeyColumnDown() {
            moveArrayEntry(state.selectedForeignKey?.columns ?? [], state.selectedForeignKeyColumn, 'down');
        },
        addIndex() {
            const index = createNewIndex(state.indexes, state.activeColumnNames, state.table.name.trim() || state.tableName);
            state.indexes.push(index);
            state.selectNode(`index:${index.id}`);
        },
        async deleteSelectedIndex() {
            const index = state.selectedIndex;

            if (!index) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Delete index?',
                    message: `This will remove the index ${index.name}.`,
                    detail: index.status === 'new' ? 'The index will be removed from the draft immediately.' : 'The index will be marked for deletion in the schema change plan.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            if (index.status === 'new') {
                state.indexes = state.indexes.filter((entry) => entry.id !== index.id);
                state.selectGroup('indexes');
                return;
            }

            index.status = 'deleted';
        },
        restoreSelectedIndex() {
            if (state.selectedIndex?.status === 'deleted') {
                state.selectedIndex.status = 'existing';
            }
        },
        duplicateSelectedIndex() {
            const index = state.selectedIndex;

            if (!index) {
                return;
            }

            const duplicate = {
                ...index,
                id: `new:${crypto.randomUUID()}`,
                originalName: undefined,
                name: `${index.name}_copy`,
                autoName: undefined,
                columns: index.columns.map((column) => createIndexColumnDraft(column.columnName, column.order)),
                status: 'new',
            } satisfies ModifyTableIndexDraft;
            state.indexes.push(duplicate);
            state.selectNode(`index:${duplicate.id}`);
        },
        moveSelectedIndexUp() {
            moveArrayEntry(state.indexes, state.selectedIndex, 'up');
        },
        moveSelectedIndexDown() {
            moveArrayEntry(state.indexes, state.selectedIndex, 'down');
        },
        selectIndexColumn(columnId: string) {
            state.selectedIndexColumnId = columnId;
        },
        addSelectedIndexColumn() {
            if (!state.selectedIndex) {
                return;
            }

            const nextColumn = createIndexColumnDraft(state.activeColumnNames[0] ?? '');
            state.selectedIndex.columns.push(nextColumn);
            state.selectedIndexColumnId = nextColumn.id;
        },
        async removeSelectedIndexColumn() {
            if (!state.selectedIndex || !state.selectedIndexColumnId) {
                return;
            }

            if (
                !(await confirmAction({
                    title: 'Remove index column?',
                    message: `This will remove ${state.selectedIndexColumn?.columnName || 'the selected column'} from ${state.selectedIndex.name}.`,
                    confirmLabel: 'Remove',
                }))
            ) {
                return;
            }

            state.selectedIndex.columns = state.selectedIndex.columns.filter((column) => column.id !== state.selectedIndexColumnId);
            state.selectedIndexColumnId = state.selectedIndex.columns[0]?.id;
        },
        moveSelectedIndexColumnUp() {
            moveArrayEntry(state.selectedIndex?.columns ?? [], state.selectedIndexColumn, 'up');
        },
        moveSelectedIndexColumnDown() {
            moveArrayEntry(state.selectedIndex?.columns ?? [], state.selectedIndexColumn, 'down');
        },
        addSelectedEntity() {
            if (state.selectedGroupKind === 'columns') {
                state.addColumn();
                return;
            }

            if (state.selectedGroupKind === 'keys') {
                state.addKey();
                return;
            }

            if (state.selectedGroupKind === 'foreign-keys') {
                state.addForeignKey();
                return;
            }

            if (state.selectedGroupKind === 'indexes') {
                state.addIndex();
            }
        },
        async deleteSelectedEntity() {
            if (state.selectedKind === 'column') {
                await state.deleteSelectedColumn();
                return;
            }

            if (state.selectedKind === 'key') {
                await state.deleteSelectedKey();
                return;
            }

            if (state.selectedKind === 'foreign-key') {
                await state.deleteSelectedForeignKey();
                return;
            }

            if (state.selectedKind === 'index') {
                await state.deleteSelectedIndex();
            }
        },
        duplicateSelectedEntity() {
            if (state.selectedKind === 'column') {
                state.duplicateSelectedColumn();
                return;
            }

            if (state.selectedKind === 'key') {
                state.duplicateSelectedKey();
                return;
            }

            if (state.selectedKind === 'foreign-key') {
                state.duplicateSelectedForeignKey();
                return;
            }

            if (state.selectedKind === 'index') {
                state.duplicateSelectedIndex();
            }
        },
        moveSelectedEntityUp() {
            if (state.selectedKind === 'column') {
                state.moveSelectedColumnUp();
                return;
            }

            if (state.selectedKind === 'key') {
                state.moveSelectedKeyUp();
                return;
            }

            if (state.selectedKind === 'foreign-key') {
                state.moveSelectedForeignKeyUp();
                return;
            }

            if (state.selectedKind === 'index') {
                state.moveSelectedIndexUp();
            }
        },
        moveSelectedEntityDown() {
            if (state.selectedKind === 'column') {
                state.moveSelectedColumnDown();
                return;
            }

            if (state.selectedKind === 'key') {
                state.moveSelectedKeyDown();
                return;
            }

            if (state.selectedKind === 'foreign-key') {
                state.moveSelectedForeignKeyDown();
                return;
            }

            if (state.selectedKind === 'index') {
                state.moveSelectedIndexDown();
            }
        },
        undoChanges() {
            draftHistory.undoChanges();
        },
        redoChanges() {
            draftHistory.redoChanges();
        },
        async applyChanges() {
            await applyModifyTableChanges(state);
        },

        duplicateSelectedColumn() {
            const column = state.selectedColumn;

            if (!column) {
                return;
            }

            const newColumn: ModifyTableColumnDraft = {
                ...column,
                id: `new:${crypto.randomUUID()}`,
                name: `${column.name}_copy`,
                originalName: undefined,
                status: 'new',
            };

            const currentIndex = state.columns.findIndex((entry) => entry.id === column.id);

            if (currentIndex < 0) {
                state.columns.push(newColumn);
            } else {
                state.columns.splice(currentIndex + 1, 0, newColumn);
            }

            state.selectNode(`column:${newColumn.id}`);
        },
        moveColumnTo(sourceColumnId: string, targetColumnId: string) {
            if (sourceColumnId === targetColumnId) {
                return;
            }

            const sourceIndex = state.columns.findIndex((column) => column.id === sourceColumnId);
            const targetIndex = state.columns.findIndex((column) => column.id === targetColumnId);

            if (sourceIndex < 0 || targetIndex < 0) {
                return;
            }

            const [movedColumn] = state.columns.splice(sourceIndex, 1);

            if (!movedColumn) {
                return;
            }

            const nextTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
            state.columns.splice(nextTargetIndex, 0, movedColumn);
        },
        moveSelectedColumnUp() {
            moveArrayEntry(state.columns, state.selectedColumn, 'up');
        },
        moveSelectedColumnDown() {
            moveArrayEntry(state.columns, state.selectedColumn, 'down');
        },
    });

    const draftHistory = createModifyTableHistory(state);

    watch(
        () => ({
            columns: state.columns.map((column) => ({
                id: column.id,
                name: column.name,
                status: column.status,
                isPrimaryKey: column.isPrimaryKey,
                primaryKeyOrdinal: column.primaryKeyOrdinal,
            })),
            keys: state.keys.map((key) => ({
                id: key.id,
                isPrimary: key.isPrimary,
                status: key.status,
                columns: key.columns.map((column) => column.columnName),
            })),
        }),
        () => {
            syncColumnsWithPrimaryKeyDraft(state.columns, state.keys);
        },
        { deep: true, flush: 'sync' }
    );

    watch(
        () => ({
            tableName: state.table.name,
            indexes: state.indexes.map((index) => ({
                id: index.id,
                name: index.name,
                autoName: index.autoName,
                columns: index.columns.map((column) => column.columnName),
                status: index.status,
            })),
            foreignKeys: state.foreignKeys.map((foreignKey) => ({
                id: foreignKey.id,
                name: foreignKey.name,
                autoName: foreignKey.autoName,
                columns: foreignKey.columns.map((column) => column.columnName),
                targetTable: foreignKey.targetTable,
                status: foreignKey.status,
            })),
        }),
        () => {
            syncAutoEntityNames(state);
        },
        { deep: true, flush: 'sync' }
    );

    return state;
}

let modifyTableSingleton: ReturnType<typeof _useModifyTable> | undefined;

export function useModifyTable() {
    modifyTableSingleton ??= _useModifyTable();
    return modifyTableSingleton;
}
