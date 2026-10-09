import type { ModifyTableParams, TableInfo } from '../../shared/types';
import { deriveStandaloneIndexes, deriveTableForeignKeys, deriveTableKeys, type ComparisonFixAction } from './compareSchemas';

/**
 * The destination table with the missing object attached. Returns undefined for
 * actions that are not a table mutation (creating a table runs DDL instead).
 */
export function buildFixTableInfo(destination: TableInfo, action: ComparisonFixAction): TableInfo | undefined {
    switch (action.kind) {
        case 'add-column':
            return action.column ? { ...destination, columns: [...destination.columns, action.column] } : undefined;
        case 'add-index':
            return action.index ? { ...destination, indexes: [...destination.indexes, action.index] } : undefined;
        case 'add-foreign-key':
            return action.foreignKeys?.length ? { ...destination, foreignKeys: [...destination.foreignKeys, ...action.foreignKeys] } : undefined;
        case 'add-key': {
            const key = action.key;

            if (!key) {
                return undefined;
            }

            if (!key.isPrimary) {
                return key.index ? { ...destination, indexes: [...destination.indexes, key.index] } : undefined;
            }

            // A primary key lives on the columns, not in the index list.
            const primaryByName = new Map((key.primaryColumns ?? []).map((column) => [column.name.toLowerCase(), column]));

            if (primaryByName.size === 0) {
                return undefined;
            }

            return {
                ...destination,
                columns: destination.columns.map((column) => {
                    const primary = primaryByName.get(column.name.toLowerCase());
                    return primary ? { ...column, isPrimaryKey: true, primaryKeyOrdinal: primary.primaryKeyOrdinal } : column;
                }),
            };
        }
        case 'create-table':
            return undefined;
    }
}

/** Maps a whole table definition onto the modifyTable plan the backend already executes for every driver. */
export function toModifyTableParams(connectionId: number, tableInfo: TableInfo): ModifyTableParams {
    return {
        connectionId,
        tableName: tableInfo.name,
        table: {
            name: tableInfo.name,
            comment: tableInfo.comment ?? null,
            engine: tableInfo.engine ?? null,
            collation: tableInfo.collation ?? null,
            options: tableInfo.options ?? null,
        },
        columns: tableInfo.columns.map((column) => ({
            originalName: column.name,
            name: column.name,
            type: column.type,
            notNull: column.notNull,
            defaultValue: column.defaultValue,
            isPrimaryKey: column.isPrimaryKey,
            primaryKeyOrdinal: column.primaryKeyOrdinal,
            isAutoIncrement: column.isAutoIncrement,
            comment: column.comment,
            collation: column.collation,
            onUpdate: column.onUpdate,
        })),
        keys: deriveTableKeys(tableInfo).map((key) => ({
            originalName: key.name,
            name: key.name,
            isPrimary: key.isPrimary,
            columns: key.columns.map((columnName) => ({ columnName })),
        })),
        foreignKeys: deriveTableForeignKeys(tableInfo).map((foreignKey) => ({
            originalName: foreignKey.name,
            name: foreignKey.name,
            targetTable: foreignKey.targetTable,
            columns: foreignKey.columns.map((column) => ({ columnName: column.from, targetName: column.to })),
            onUpdate: foreignKey.onUpdate || null,
            onDelete: foreignKey.onDelete || null,
            match: foreignKey.match || null,
        })),
        indexes: deriveStandaloneIndexes(tableInfo).map((index) => ({
            originalName: index.name,
            name: index.name,
            comment: index.comment ?? null,
            isUnique: index.isUnique,
            type: index.type ?? null,
            columns: index.columns.map((columnName, position) => ({ columnName, order: index.orders?.[position] ?? null })),
        })),
    };
}

/** Title for the confirmation dialog shown before a fix runs. */
export function getFixActionTitle(action: ComparisonFixAction): string {
    switch (action.kind) {
        case 'add-column':
            return 'Add column?';
        case 'add-key':
            return action.key?.isPrimary ? 'Add primary key?' : 'Add unique key?';
        case 'add-foreign-key':
            return 'Add foreign key?';
        case 'add-index':
            return 'Add index?';
        case 'create-table':
            return 'Create table?';
    }
}
