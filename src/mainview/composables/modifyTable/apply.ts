import { prunePersistedGridLayout } from '../../../datagrid/dataGridLayoutStorage';
import type { DbType } from '../../../shared/types';
import { useConnections } from '../useConnections';
import { useQuery } from '../useQuery';
import { useSqlHistory } from '../useSqlHistory';
import { tasks } from '../useTasks';
import { getActiveColumns, normalizeOptionalText } from './drafts';
import type { ModifyTablePreviewState } from './types';

/** The dialog state the apply step reads (and the modal it closes on success). */
export type ModifyTableApplyHost = ModifyTablePreviewState & {
    connectionId: number | undefined;
    errorMessage: string;
    canApply: boolean;
    applying: boolean;
    isCreateMode: boolean;
    previewStatements: string[];
    driver: DbType | undefined;
    closeModal(): void;
};

/**
 * Creates the table (one statement at a time) or posts the whole plan, then reloads what the change
 * touched: the table list, the table details, the persisted grid layout and the open data grid.
 */
export async function applyModifyTableChanges(state: ModifyTableApplyHost) {
    const connections = useConnections();
    const query = useQuery();
    const history = useSqlHistory();

    if (!state.connectionId || !state.canApply) {
        return;
    }

    state.applying = true;
    state.errorMessage = '';
    const nextTableName = state.table.name.trim() || state.tableName;
    let modifyAttempted = false;
    let modifySucceeded = false;

    try {
        if (state.isCreateMode) {
            if (!nextTableName) {
                throw new Error('Table name is required.');
            }

            for (const [index, statement] of state.previewStatements.entries()) {
                await tasks.runQuery.run(
                    {
                        connectionId: state.connectionId,
                        sql: statement,
                    },
                    `create-table:${state.connectionId}:${nextTableName}:${index}`
                );
            }

            await connections.ensureConnectionTables(state.connectionId, true);
            await connections.ensureTableDetails(state.connectionId, nextTableName, true);
            state.closeModal();
            return;
        }

        if (!state.tableName) {
            throw new Error('Table name is required.');
        }

        const currentTableName = state.tableName;
        const finalTableName = nextTableName ?? currentTableName;

        const modifySql = state.previewStatements.join(';\n') || `Modify table ${currentTableName}`;
        modifyAttempted = true;

        await tasks.modifyTable.run(
            {
                connectionId: state.connectionId,
                tableName: currentTableName,
                table: {
                    name: finalTableName,
                    comment: normalizeOptionalText(state.table.comment),
                    engine: normalizeOptionalText(state.table.engine),
                    collation: normalizeOptionalText(state.table.collation),
                    options: normalizeOptionalText(state.table.options),
                },
                columns: getActiveColumns(state.columns).map((column) => ({
                    originalName: column.originalName,
                    name: column.name.trim(),
                    type: column.type.trim(),
                    notNull: column.notNull,
                    defaultValue: normalizeOptionalText(column.defaultValue),
                    isPrimaryKey: column.isPrimaryKey,
                    primaryKeyOrdinal: column.primaryKeyOrdinal,
                    isAutoIncrement: column.isAutoIncrement,
                    comment: normalizeOptionalText(column.comment),
                    collation: normalizeOptionalText(column.collation),
                    onUpdate: normalizeOptionalText(column.onUpdate),
                    hidden: column.hidden,
                    columnKind: normalizeOptionalText(column.columnKind),
                })),
                keys: state.keys
                    .filter((key) => key.status !== 'deleted')
                    .map((key) => ({
                        originalName: key.originalName,
                        name: key.name.trim(),
                        isPrimary: key.isPrimary,
                        columns: key.columns.map((column) => ({
                            columnName: column.columnName.trim(),
                        })),
                    })),
                foreignKeys: state.foreignKeys
                    .filter((foreignKey) => foreignKey.status !== 'deleted')
                    .map((foreignKey) => ({
                        originalName: foreignKey.originalName,
                        name: foreignKey.name.trim(),
                        targetTable: foreignKey.targetTable.trim(),
                        columns: foreignKey.columns.map((column) => ({
                            columnName: column.columnName.trim(),
                            targetName: column.targetName.trim(),
                        })),
                        onDelete: normalizeOptionalText(foreignKey.onDelete),
                        onUpdate: normalizeOptionalText(foreignKey.onUpdate),
                        match: normalizeOptionalText(foreignKey.match),
                    })),
                indexes: state.indexes
                    .filter((index) => index.status !== 'deleted')
                    .map((index) => ({
                        originalName: index.originalName,
                        name: index.name.trim(),
                        comment: normalizeOptionalText(index.comment),
                        isUnique: index.isUnique,
                        type: normalizeOptionalText(index.type),
                        columns: index.columns.map((column) => ({
                            columnName: column.columnName.trim(),
                            order: normalizeOptionalText(column.order),
                        })),
                    })),
                allowTableRebuild: state.allowTableRebuild,
            },
            `modify-table:${state.connectionId}:${currentTableName}`
        );

        modifySucceeded = true;
        history.record({
            source: 'modify-table',
            sql: modifySql,
            connectionId: state.connectionId,
            dialect: state.driver,
            status: 'success',
        });

        await connections.ensureConnectionTables(state.connectionId, true);
        await connections.ensureTableDetails(state.connectionId, finalTableName, true);

        // The schema changed: drop the persisted grid layout entries for columns that no longer
        // exist before anything reloads the grid.
        prunePersistedGridLayout(
            state.connectionId,
            finalTableName,
            connections.getTableDetailsState(state.connectionId, finalTableName).info?.columns.map((column) => column.name) ?? []
        );

        if (query.selectedTableName === currentTableName && connections.selectedConnectionId === state.connectionId) {
            query.selectedTableName = finalTableName;
            await query.loadSelectedTable(state.connectionId, finalTableName);
        }

        state.closeModal();
    } catch (error) {
        state.errorMessage = error instanceof Error ? error.message : String(error);

        if (modifyAttempted && !modifySucceeded) {
            history.record({
                source: 'modify-table',
                sql: state.previewStatements.join(';\n') || `Modify table ${state.tableName}`,
                connectionId: state.connectionId,
                dialect: state.driver,
                status: 'error',
                errorMessage: state.errorMessage,
            });
        }
    } finally {
        state.applying = false;
    }
}
