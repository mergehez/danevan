/**
 * Modify-table plumbing shared by the remote (MySQL / PostgreSQL) drivers: key and index
 * signatures, primary-key and dropped-column derivation, and the ALTER statements that are pure
 * text. Free of TypeORM and the query runner, so the planning can be asserted directly the way
 * `sqliteTableDdl.ts` is.
 */
import type { TableForeignKeyInfo, TableInfo } from '../shared/types';
import type { ModifySchemaColumn, ModifySchemaForeignKey, ModifySchemaKey, ModifySchemaPlan } from './useSqliteDriver.ts';

/** The columns a primary key is derived from: `TableInfo` and `ModifySchemaColumn` both fit. */
type PrimaryKeySourceColumn = {
    name: string;
    isPrimaryKey: boolean;
    primaryKeyOrdinal: number | null;
};

/** The columns a key signature compares: order matters, casing does not. */
export function serializeColumns(columns: string[]) {
    return columns.map((columnName) => columnName.toLowerCase()).join('|');
}

export function serializeIndexColumns(columns: Array<{ columnName: string; order?: string | null }>) {
    return columns.map((column) => `${column.columnName.toLowerCase()}:${(column.order ?? '').toUpperCase()}`).join('|');
}

export function buildPrimaryKeyFromColumns(columns: PrimaryKeySourceColumn[]) {
    const primaryColumns = [...columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => ({ columnName: column.name }));

    if (!primaryColumns.length) {
        return undefined;
    }

    return {
        name: 'PRIMARY',
        isPrimary: true,
        columns: primaryColumns,
    } satisfies ModifySchemaKey;
}

/** The primary key the plan asks for: an explicit key wins, otherwise the flagged columns. */
export function getDesiredPrimaryKey(plan: ModifySchemaPlan) {
    return plan.keys.find((key) => key.isPrimary) ?? buildPrimaryKeyFromColumns(plan.columns);
}

export function getCurrentPrimaryKey(currentInfo: TableInfo) {
    return buildPrimaryKeyFromColumns(currentInfo.columns);
}

/** Unique indexes that are not the primary key. */
export function getCurrentUniqueKeys(currentInfo: TableInfo) {
    const primarySignature = keySignature(getCurrentPrimaryKey(currentInfo));

    return currentInfo.indexes
        .filter((index) => index.isUnique && serializeColumns(index.columns) !== primarySignature)
        .map((index) => ({
            name: index.name,
            isPrimary: false,
            columns: index.columns.map((columnName) => ({ columnName })),
        })) satisfies ModifySchemaKey[];
}

/** Foreign-key columns in their declared order, grouped back into one entry per constraint. */
export function groupCurrentForeignKeys(currentInfo: TableInfo) {
    const groups = new Map<string, TableForeignKeyInfo[]>();

    currentInfo.foreignKeys.forEach((foreignKey) => {
        const groupKey = foreignKey.name ?? `${foreignKey.id}`;
        const nextGroup = groups.get(groupKey) ?? [];
        nextGroup.push(foreignKey);
        groups.set(groupKey, nextGroup);
    });

    return [...groups.entries()].map(([name, group]) => {
        const first = group[0];

        return {
            name,
            targetTable: first.table,
            columns: [...group].sort((left, right) => left.sequence - right.sequence).map((foreignKey) => ({ columnName: foreignKey.from, targetName: foreignKey.to })),
            onUpdate: first.onUpdate,
            onDelete: first.onDelete,
            match: first.match,
        } satisfies ModifySchemaForeignKey;
    });
}

export function keySignature(key: Pick<ModifySchemaKey, 'columns'> | undefined) {
    return key ? serializeColumns(key.columns.map((column) => column.columnName)) : '';
}

export function foreignKeySignature(foreignKey: ModifySchemaForeignKey) {
    return [
        foreignKey.targetTable.toLowerCase(),
        foreignKey.columns.map((column) => `${column.columnName.toLowerCase()}=>${column.targetName.toLowerCase()}`).join('|'),
        (foreignKey.onDelete ?? '').toLowerCase(),
        (foreignKey.onUpdate ?? '').toLowerCase(),
        (foreignKey.match ?? '').toLowerCase(),
    ].join('::');
}

/** Columns the plan leaves out, matching a rename through `originalName`. */
export function getDroppedColumns(currentInfo: TableInfo, nextColumns: ModifySchemaColumn[]) {
    const nextColumnsByOriginalName = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column]));

    return currentInfo.columns.filter((column) => !nextColumnsByOriginalName.has(column.name) && !nextColumns.some((entry) => !entry.originalName && entry.name === column.name));
}

export function buildDropColumnStatements(quoteIdentifier: (identifier: string) => string, tableName: string, currentInfo: TableInfo, nextColumns: ModifySchemaColumn[]) {
    const quotedTableName = quoteIdentifier(tableName);

    return getDroppedColumns(currentInfo, nextColumns).map((column) => `ALTER TABLE ${quotedTableName} DROP COLUMN ${quoteIdentifier(column.name)};`);
}

export function buildIndexColumns(quoteIdentifier: (identifier: string) => string, columns: Array<{ columnName: string; order?: string | null }>) {
    return columns.map((column) => `${quoteIdentifier(column.columnName)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ');
}
