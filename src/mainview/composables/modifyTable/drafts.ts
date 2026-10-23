import { quoteSqlIdentifier } from '../../../shared/utils/sqlIdentifiers';
import type { DbType, TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '../../../shared/types';
import type {
    ModifyTableColumnDraft,
    ModifyTableForeignKeyColumnDraft,
    ModifyTableForeignKeyDraft,
    ModifyTableHistorySnapshot,
    ModifyTableIndexColumnDraft,
    ModifyTableIndexDraft,
    ModifyTableKeyColumnDraft,
    ModifyTableKeyDraft,
    ModifyTableTableDraft,
} from './types';

export function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

export function createColumnDraft(column: TableColumnInfo): ModifyTableColumnDraft {
    return {
        id: `existing:${column.name}`,
        originalName: column.name,
        name: column.name,
        type: column.type || '',
        notNull: column.notNull,
        defaultValue: column.defaultValue,
        isPrimaryKey: column.isPrimaryKey,
        primaryKeyOrdinal: column.primaryKeyOrdinal,
        isAutoIncrement: column.isAutoIncrement,
        comment: column.comment,
        collation: column.collation,
        onUpdate: column.onUpdate,
        status: 'existing',
        hidden: false,
        columnKind: 'NORMAL',
    };
}

export function cloneColumns(columns: TableColumnInfo[]) {
    return columns.map((column) => createColumnDraft(column));
}

export function getActiveColumns(columns: ModifyTableColumnDraft[]) {
    return columns.filter((column) => column.status !== 'deleted');
}

export function createOriginalColumnsByName(columns: ModifyTableColumnDraft[]) {
    return new Map(columns.map((column) => [column.originalName ?? column.name, column]));
}

export function normalizePreviewList(values: (string | null | undefined)[]) {
    return values.map((value) => normalizeOptionalText(value) ?? '').join('|');
}

export function getActiveKeys(keys: ModifyTableKeyDraft[]) {
    return keys.filter((key) => key.status !== 'deleted');
}

export function getActiveForeignKeys(foreignKeys: ModifyTableForeignKeyDraft[]) {
    return foreignKeys.filter((foreignKey) => foreignKey.status !== 'deleted');
}

export function getActiveIndexes(indexes: ModifyTableIndexDraft[]) {
    return indexes.filter((index) => index.status !== 'deleted');
}

export function buildKeySignature(key: Pick<ModifyTableKeyDraft, 'name' | 'isPrimary' | 'columns'>) {
    return [key.isPrimary ? 'primary' : 'unique', key.name.trim().toLowerCase(), normalizePreviewList(key.columns.map((column) => column.columnName))].join('::');
}

export function buildForeignKeySignature(foreignKey: Pick<ModifyTableForeignKeyDraft, 'name' | 'targetTable' | 'columns' | 'onDelete' | 'onUpdate' | 'match'>) {
    return [
        foreignKey.name.trim().toLowerCase(),
        foreignKey.targetTable.trim().toLowerCase(),
        normalizePreviewList(foreignKey.columns.map((column) => `${column.columnName}->${column.targetName}`)),
        normalizeOptionalText(foreignKey.onDelete) ?? '',
        normalizeOptionalText(foreignKey.onUpdate) ?? '',
        normalizeOptionalText(foreignKey.match) ?? '',
    ].join('::');
}

export function buildIndexSignature(index: Pick<ModifyTableIndexDraft, 'name' | 'comment' | 'isUnique' | 'type' | 'columns'>) {
    return [
        index.name.trim().toLowerCase(),
        index.isUnique ? 'unique' : 'plain',
        normalizeOptionalText(index.comment) ?? '',
        normalizeOptionalText(index.type) ?? '',
        normalizePreviewList(index.columns.map((column) => `${column.columnName}:${column.order}`)),
    ].join('::');
}

export function buildMsAccessColumnSignature(
    column: Pick<ModifyTableColumnDraft, 'name' | 'type' | 'notNull' | 'defaultValue' | 'isPrimaryKey' | 'primaryKeyOrdinal' | 'isAutoIncrement'>
) {
    return [
        column.name.trim().toLowerCase(),
        column.type.trim().toLowerCase(),
        column.notNull ? 'not-null' : 'nullable',
        normalizeOptionalText(column.defaultValue) ?? '',
        column.isPrimaryKey ? 'primary' : 'plain',
        String(column.primaryKeyOrdinal ?? ''),
        column.isAutoIncrement ? 'autoincrement' : 'manual',
    ].join('::');
}

export function escapePreviewSqlString(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

export function getPrimaryKeyDraft(keys: ModifyTableKeyDraft[]) {
    return getActiveKeys(keys).find((key) => key.isPrimary);
}

export function syncColumnsWithPrimaryKeyDraft(columns: ModifyTableColumnDraft[], keys: ModifyTableKeyDraft[]) {
    const primaryKey = getPrimaryKeyDraft(keys);
    const ordinalsByName = new Map<string, number>();
    let changed = false;

    primaryKey?.columns.forEach((column, index) => {
        const normalizedName = column.columnName.trim().toLowerCase();

        if (!normalizedName || ordinalsByName.has(normalizedName)) {
            return;
        }

        ordinalsByName.set(normalizedName, index + 1);
    });

    columns.forEach((column) => {
        const ordinal = column.status === 'deleted' ? null : (ordinalsByName.get(column.name.trim().toLowerCase()) ?? null);
        const isPrimaryKey = ordinal !== null;

        if (column.isPrimaryKey !== isPrimaryKey) {
            column.isPrimaryKey = isPrimaryKey;
            changed = true;
        }

        if ((column.primaryKeyOrdinal ?? null) !== ordinal) {
            column.primaryKeyOrdinal = ordinal;
            changed = true;
        }
    });

    return changed;
}

export function getUniqueKeyDrafts(keys: ModifyTableKeyDraft[]) {
    return getActiveKeys(keys).filter((key) => !key.isPrimary);
}

export function getStandaloneIndexDrafts(indexes: ModifyTableIndexDraft[], keys: ModifyTableKeyDraft[]) {
    const excludedNames = new Set(getActiveKeys(keys).map((key) => key.name.toLowerCase()));
    return getActiveIndexes(indexes).filter((index) => !excludedNames.has(index.name.toLowerCase()));
}

export function buildPreviewIndexColumns(columns: Array<{ columnName: string; order?: string | null }>, driver: DbType) {
    return columns.map((column) => `${quoteSqlIdentifier(column.columnName, driver)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ');
}

export function createNewColumn(columns: ModifyTableColumnDraft[], driver: DbType | undefined): ModifyTableColumnDraft {
    const existingNames = new Set(columns.map((column) => column.name.toLowerCase()));
    let sequence = 1;
    let name = existingNames.size ? 'new_column' : 'id';
    const type = existingNames.size ? (driver === 'postgresql' ? 'text' : 'varchar(255)') : 'int';

    while (existingNames.has(name.toLowerCase())) {
        sequence += 1;
        name = `new_column_${sequence}`;
    }

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        type,
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
        status: 'new',
        hidden: false,
        columnKind: 'NORMAL',
    };
}

export function createUniqueName(existingNames: string[], baseName: string) {
    const normalizedNames = new Set(existingNames.map((name) => name.toLowerCase()));
    let sequence = 1;
    let name = baseName;

    while (normalizedNames.has(name.toLowerCase())) {
        sequence += 1;
        name = `${baseName}_${sequence}`;
    }

    return name;
}

export function moveArrayEntry<TItem extends { id: string }>(items: TItem[], item: TItem | undefined, direction: 'up' | 'down') {
    if (!item) {
        return;
    }

    const currentIndex = items.findIndex((entry) => entry.id === item.id);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
        return;
    }

    const temp = items[targetIndex];
    items[targetIndex] = items[currentIndex];
    items[currentIndex] = temp;
}

export function createTableDraft(tableName: string, driver: DbType | undefined, tableInfo?: TableInfo): ModifyTableTableDraft {
    return {
        name: tableInfo?.name ?? tableName,
        comment: tableInfo?.comment ?? '',
        engine: tableInfo?.engine ?? (driver === 'mysql' ? 'InnoDB' : ''),
        collation: tableInfo?.collation ?? '',
        options: tableInfo?.options ?? '',
    };
}

export function createKeyColumnDraft(columnName: string): ModifyTableKeyColumnDraft {
    return {
        id: `key-column:${crypto.randomUUID()}`,
        columnName,
    };
}

export function createForeignKeyColumnDraft(columnName: string, targetName: string): ModifyTableForeignKeyColumnDraft {
    return {
        id: `foreign-key-column:${crypto.randomUUID()}`,
        columnName,
        targetName,
    };
}

export function createIndexColumnDraft(columnName: string, order = 'NONE'): ModifyTableIndexColumnDraft {
    return {
        id: `index-column:${crypto.randomUUID()}`,
        columnName,
        order,
    };
}

export function resolveForeignKeyDraftName(tableName: string, tableInfo: Pick<TableInfo, 'indexes'>, group: TableForeignKeyInfo[], fallbackName?: string) {
    const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);
    const explicitName = sortedGroup.find((foreignKey) => foreignKey.name?.trim())?.name?.trim();

    if (explicitName) {
        return explicitName;
    }

    const sourceColumns = sortedGroup.map((foreignKey) => foreignKey.from);
    const prefixMatches = tableInfo.indexes.filter(
        (index) => index.name && index.name.toLowerCase() !== 'primary' && sourceColumns.every((columnName, indexPosition) => index.columns[indexPosition] === columnName)
    );
    const exactMatches = prefixMatches.filter((index) => index.columns.length === sourceColumns.length);
    const preferredMatch = [...exactMatches, ...prefixMatches].find((index) => index.name.toLowerCase().includes('foreign')) ?? exactMatches[0] ?? prefixMatches[0];

    if (preferredMatch?.name) {
        return preferredMatch.name;
    }

    return fallbackName?.trim() || `${tableName}_${sortedGroup[0]?.from ?? 'foreign'}_foreign`;
}

/**
 * Whether a catalog index *is* a unique constraint (a key in the dialog) rather than a unique index
 * the user created. TypeORM reports the two separately for PostgreSQL and SQLite (origin `unique`
 * versus `index`); MySQL and Access have no such distinction — a unique key and a unique index are
 * one object there.
 */

/**
 * Whether a catalog index *is* a unique constraint (a key in the dialog) rather than a unique index
 * the user created. TypeORM reports the two separately for PostgreSQL and SQLite (origin `unique`
 * versus `index`); MySQL and Access have no such distinction — a unique key and a unique index are
 * one object there.
 */
export function isUniqueConstraintIndex(index: TableIndexInfo, driver: DbType | undefined) {
    if (driver === 'sqlite' || driver === 'postgresql') {
        return index.origin === 'unique';
    }

    return true;
}

/**
 * The index that backs the table's primary key, when the catalog lists it. The drivers leave
 * constraint-backed indexes out (MySQL's `statistics` query, TypeORM's table loader), so this only
 * matches a catalog that names it; an index that merely covers those columns is a separate index.
 */

/**
 * The index that backs the table's primary key, when the catalog lists it. The drivers leave
 * constraint-backed indexes out (MySQL's `statistics` query, TypeORM's table loader), so this only
 * matches a catalog that names it; an index that merely covers those columns is a separate index.
 */
export function findPrimaryIndex(tableInfo: TableInfo) {
    return tableInfo.indexes.find((index) => index.name.toLowerCase() === 'primary' || index.origin === 'pk');
}

export function createKeyDrafts(tableInfo: TableInfo, driver: DbType | undefined) {
    const primaryKeyColumns = [...tableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);
    const primaryIndexName = findPrimaryIndex(tableInfo)?.name;
    const keys: ModifyTableKeyDraft[] = [];

    if (primaryKeyColumns.length > 0) {
        keys.push({
            id: 'primary',
            originalName: 'PRIMARY',
            name: 'PRIMARY',
            isPrimary: true,
            columns: primaryKeyColumns.map((columnName) => createKeyColumnDraft(columnName)),
            status: 'existing',
        });
    }

    tableInfo.indexes
        .filter((index) => index.isUnique && index.name !== primaryIndexName && isUniqueConstraintIndex(index, driver))
        .forEach((index) => {
            keys.push({
                id: `existing:${index.name}`,
                originalName: index.name,
                name: index.name,
                isPrimary: false,
                columns: index.columns.map((columnName) => createKeyColumnDraft(columnName)),
                status: 'existing',
            });
        });

    return keys;
}

export function createForeignKeyDrafts(tableName: string, tableInfo: TableInfo) {
    const groups = new Map<string, TableForeignKeyInfo[]>();

    tableInfo.foreignKeys.forEach((foreignKey) => {
        const groupKey = foreignKey.name ?? String(foreignKey.id);
        const nextGroup = groups.get(groupKey) ?? [];
        nextGroup.push(foreignKey);
        groups.set(groupKey, nextGroup);
    });

    return [...groups.entries()].map(([foreignKeyName, group]) => {
        const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);
        const baseName = resolveForeignKeyDraftName(tableName, tableInfo, sortedGroup, foreignKeyName);

        return {
            id: `existing:${baseName}`,
            originalName: baseName,
            name: baseName,
            targetTable: sortedGroup[0]?.table ?? '',
            columns: sortedGroup.map((foreignKey) => createForeignKeyColumnDraft(foreignKey.from, foreignKey.to)),
            onDelete: sortedGroup[0]?.onDelete?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            onUpdate: sortedGroup[0]?.onUpdate?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            match: sortedGroup[0]?.match?.toLowerCase() ?? 'none',
            status: 'existing',
        } satisfies ModifyTableForeignKeyDraft;
    });
}

export function createIndexDrafts(tableInfo: TableInfo, driver: DbType | undefined): ModifyTableIndexDraft[] {
    const primaryIndexName = findPrimaryIndex(tableInfo)?.name;
    const keyNames = new Set(getActiveKeys(createKeyDrafts(tableInfo, driver)).map((key) => key.name.toLowerCase()));

    // The primary key and the unique constraints are edited as keys. A second entry under "indexes"
    // would be a copy the plan ignores: it excludes indexes whose name a key already carries.
    return tableInfo.indexes
        .filter((index) => index.name !== primaryIndexName && !keyNames.has(index.name.toLowerCase()))
        .map((index) => ({
            id: `existing:${index.name}`,
            originalName: index.name,
            name: index.name,
            comment: index.comment ?? '',
            isUnique: index.isUnique,
            type: index.type ?? 'btree',
            columns: index.columns.map((columnName, indexPosition) => createIndexColumnDraft(columnName, index.orders?.[indexPosition] ?? 'NONE')),
            status: 'existing' as const,
        }));
}

/** Long identifiers are truncated by the dialects anyway; keep our own names inside MySQL's 64. */
const AUTO_NAME_MAX_LENGTH = 60;

function clampAutoName(name: string) {
    return name.length <= AUTO_NAME_MAX_LENGTH ? name : name.slice(0, AUTO_NAME_MAX_LENGTH);
}

function columnSuffix(columns: string[]) {
    return columns
        .map((columnName) => columnName.trim())
        .filter(Boolean)
        .join('_');
}

export function buildAutoIndexName(tableName: string, columns: string[]) {
    const suffix = columnSuffix(columns);
    return clampAutoName(suffix ? `IX_${tableName}_${suffix}` : `IX_${tableName}`);
}

export function buildAutoForeignKeyName(tableName: string, columns: string[], targetTable: string) {
    const suffix = columnSuffix(columns);
    const target = targetTable.trim();
    return clampAutoName(['FK', tableName, suffix, target].filter(Boolean).join('_'));
}

/** A generated name that no other draft already holds (`_2`, `_3`, …). */
export function resolveAutoName(baseName: string, takenNames: string[]) {
    const taken = new Set(takenNames.map((name) => name.trim().toLowerCase()));

    if (!taken.has(baseName.toLowerCase())) {
        return baseName;
    }

    let sequence = 2;

    while (taken.has(`${baseName}_${sequence}`.toLowerCase())) {
        sequence += 1;
    }

    return `${baseName}_${sequence}`;
}

type AutoNameHost = {
    table: { name: string };
    tableName?: string;
    indexes: ModifyTableIndexDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
};

/**
 * Keeps the generated names of new indexes and foreign keys in step with what the form holds. A
 * name the user typed wins: the draft's `autoName` is the value we last generated, so a name that no
 * longer matches it was typed by hand and is left alone.
 */
export function syncAutoEntityNames(state: AutoNameHost) {
    const tableName = (state.table.name.trim() || state.tableName || 'table').trim();

    state.indexes.forEach((index, position) => {
        if (index.autoName === undefined) {
            return;
        }

        if (index.name !== index.autoName) {
            index.autoName = undefined;
            return;
        }

        const taken = state.indexes.filter((_, otherPosition) => otherPosition !== position).map((other) => other.name);
        index.name = resolveAutoName(
            buildAutoIndexName(
                tableName,
                index.columns.map((column) => column.columnName)
            ),
            taken
        );
        index.autoName = index.name;
    });

    state.foreignKeys.forEach((foreignKey, position) => {
        if (foreignKey.autoName === undefined) {
            return;
        }

        if (foreignKey.name !== foreignKey.autoName) {
            foreignKey.autoName = undefined;
            return;
        }

        const taken = state.foreignKeys.filter((_, otherPosition) => otherPosition !== position).map((other) => other.name);
        foreignKey.name = resolveAutoName(
            buildAutoForeignKeyName(
                tableName,
                foreignKey.columns.map((column) => column.columnName),
                foreignKey.targetTable
            ),
            taken
        );
        foreignKey.autoName = foreignKey.name;
    });
}

export function createNewKey(keys: ModifyTableKeyDraft[], columnNames: string[]) {
    const name = createUniqueName(
        keys.map((key) => key.name),
        'new_key'
    );

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        isPrimary: false,
        columns: [createKeyColumnDraft(columnNames[0] ?? '')],
        status: 'new',
    } satisfies ModifyTableKeyDraft;
}

export function createPrimaryKeyDraft(columnName: string) {
    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name: 'PRIMARY',
        isPrimary: true,
        columns: [createKeyColumnDraft(columnName)],
        status: 'new',
    } satisfies ModifyTableKeyDraft;
}

export function createNewForeignKey(foreignKeys: ModifyTableForeignKeyDraft[], columnNames: string[], tableName = '') {
    const name = resolveAutoName(
        buildAutoForeignKeyName(tableName, [columnNames[0] ?? ''], ''),
        foreignKeys.map((foreignKey) => foreignKey.name)
    );

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        autoName: name,
        targetTable: '',
        columns: [createForeignKeyColumnDraft(columnNames[0] ?? '', '')],
        onDelete: 'no_action',
        onUpdate: 'no_action',
        match: 'none',
        status: 'new',
    } satisfies ModifyTableForeignKeyDraft;
}

export function createNewIndex(indexes: ModifyTableIndexDraft[], columnNames: string[], tableName = '') {
    const baseName = buildAutoIndexName(tableName, [columnNames[0] ?? '']);
    const name = resolveAutoName(
        baseName,
        indexes.map((index) => index.name)
    );

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        autoName: name,
        comment: '',
        isUnique: false,
        type: 'btree',
        columns: [createIndexColumnDraft(columnNames[0] ?? '')],
        status: 'new',
    } satisfies ModifyTableIndexDraft;
}

export function cloneModifyTableHistorySnapshot(snapshot: ModifyTableHistorySnapshot) {
    // structuredClone is far cheaper than a JSON round-trip, and this runs on every
    // change to the table definition.
    if (typeof structuredClone === 'function') {
        return structuredClone(snapshot);
    }

    return JSON.parse(JSON.stringify(snapshot)) as ModifyTableHistorySnapshot;
}
