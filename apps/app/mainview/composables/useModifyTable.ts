import { useConnections } from '@composables/useConnections';
import { useQuery } from '@composables/useQuery';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import { getDbCollationOptionsQuery, normalizeDbCollationOptions } from '@lib/collations';
import type { MonacoDiagnosticMarker } from '@lib/monaco';
import { confirmAction } from '@lib/utils';
import type { DbType, ModifyTableColumnParams, TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '@utils/appClient';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { reactive, watch } from 'vue';

type ModifyTableColumnStatus = 'existing' | 'new' | 'deleted';
type ModifyTableGroupKind = 'columns' | 'keys' | 'foreign-keys' | 'indexes';
type ModifyTableSelectionKind = 'table' | 'group' | 'column' | 'key' | 'foreign-key' | 'index';
type ModifyTableEntityStatus = ModifyTableColumnStatus;
type ModifyTableMode = 'edit' | 'create';

export type ModifyTableColumnDraft = ModifyTableColumnParams & {
    id: string;
    status: ModifyTableColumnStatus;
    hidden: boolean;
    columnKind: string;
};

type ModifyTableTableDraft = {
    name: string;
    comment: string;
    engine: string;
    collation: string;
    options: string;
};

type ModifyTableKeyColumnDraft = {
    id: string;
    columnName: string;
};

type ModifyTableKeyDraft = {
    id: string;
    originalName?: string;
    name: string;
    isPrimary: boolean;
    columns: ModifyTableKeyColumnDraft[];
    status: ModifyTableEntityStatus;
};

type ModifyTableForeignKeyColumnDraft = {
    id: string;
    columnName: string;
    targetName: string;
};

type ModifyTableForeignKeyDraft = {
    id: string;
    originalName?: string;
    name: string;
    targetTable: string;
    columns: ModifyTableForeignKeyColumnDraft[];
    onDelete: string;
    onUpdate: string;
    match: string;
    status: ModifyTableEntityStatus;
};

type ModifyTableIndexColumnDraft = {
    id: string;
    columnName: string;
    order: string;
};

type ModifyTableIndexDraft = {
    id: string;
    originalName?: string;
    name: string;
    comment: string;
    isUnique: boolean;
    type: string;
    columns: ModifyTableIndexColumnDraft[];
    status: ModifyTableEntityStatus;
};

type ModifyTableNavigationItem = {
    id: string;
    title: string;
    kind: ModifyTableSelectionKind;
    rightText?: string;
    status?: ModifyTableEntityStatus;
};

type ModifyTableNavigationSection = {
    id: string;
    title: string;
    kind: ModifyTableGroupKind;
    items: ModifyTableNavigationItem[];
};

type ModifyTableOpenParams =
    | {
          connectionId: number;
          tableName: string;
          mode?: 'edit';
      }
    | {
          connectionId: number;
          tableName?: string;
          mode: 'create';
      };

type ModifyTablePreviewState = {
    mode: ModifyTableMode;
    tableName: string | undefined;
    driver: DbType | undefined;
    currentTableInfo: TableInfo | undefined;
    existingTableNames: string[];
    allowTableRebuild: boolean;
    table: ModifyTableTableDraft;
    columns: ModifyTableColumnDraft[];
    originalColumns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
};

function createPreviewDiagnostic(message: string, severity: MonacoDiagnosticMarker['severity']): MonacoDiagnosticMarker {
    return {
        message,
        severity,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        source: 'modify-table',
    };
}

type ModifyTableHistorySnapshot = {
    allowTableRebuild: boolean;
    table: ModifyTableTableDraft;
    columns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
    selectedNodeId: string | null;
    selectedKeyColumnId: string | null;
    selectedForeignKeyColumnId: string | null;
    selectedIndexColumnId: string | null;
};

function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function createColumnDraft(column: TableColumnInfo): ModifyTableColumnDraft {
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

function cloneColumns(columns: TableColumnInfo[]) {
    return columns.map((column) => createColumnDraft(column));
}

function getActiveColumns(columns: ModifyTableColumnDraft[]) {
    return columns.filter((column) => column.status !== 'deleted');
}

function createOriginalColumnsByName(columns: ModifyTableColumnDraft[]) {
    return new Map(columns.map((column) => [column.originalName ?? column.name, column]));
}

function buildMySqlColumnDefinition(column: ModifyTableColumnDraft) {
    const parts = [quoteSqlIdentifier(column.name, 'mysql'), column.type.trim()];

    parts.push(column.notNull ? 'NOT NULL' : 'NULL');

    if (column.defaultValue) {
        parts.push(`DEFAULT ${column.defaultValue}`);
    } else if (!column.notNull && !column.isAutoIncrement) {
        parts.push('DEFAULT NULL');
    }

    if (column.isAutoIncrement) {
        parts.push('AUTO_INCREMENT');
    }

    if (normalizeOptionalText(column.onUpdate)) {
        parts.push(`ON UPDATE ${normalizeOptionalText(column.onUpdate)}`);
    }

    if (normalizeOptionalText(column.collation)) {
        parts.push(`COLLATE ${normalizeOptionalText(column.collation)}`);
    }

    parts.push(`COMMENT '${(normalizeOptionalText(column.comment) ?? '').replaceAll("'", "''")}'`);
    return parts.join(' ');
}

function buildPostgresColumnDefinition(column: ModifyTableColumnDraft) {
    const parts = [quoteSqlIdentifier(column.name, 'postgresql'), column.type.trim()];

    if (normalizeOptionalText(column.collation)) {
        parts.push(`COLLATE ${quoteSqlIdentifier(normalizeOptionalText(column.collation)!, 'postgresql')}`);
    }

    if (column.isAutoIncrement) {
        parts.push('GENERATED BY DEFAULT AS IDENTITY');
    }

    if (column.defaultValue) {
        parts.push(`DEFAULT ${column.defaultValue}`);
    }

    if (column.notNull) {
        parts.push('NOT NULL');
    }

    return parts.join(' ');
}

function getSqliteColumnType(column: Pick<ModifyTableColumnDraft, 'type' | 'isAutoIncrement'>, inlinePrimaryKey: boolean) {
    if (inlinePrimaryKey && column.isAutoIncrement) {
        return 'INTEGER';
    }

    return column.type.trim();
}

function buildSqliteColumnDefinition(column: ModifyTableColumnDraft, inlinePrimaryKey: boolean) {
    const parts = [quoteSqlIdentifier(column.name, 'sqlite'), getSqliteColumnType(column, inlinePrimaryKey)];

    if (inlinePrimaryKey) {
        parts.push('PRIMARY KEY');

        if (column.isAutoIncrement) {
            parts.push('AUTOINCREMENT');
        }
    }

    if (normalizeOptionalText(column.collation)) {
        parts.push(`COLLATE ${quoteSqlIdentifier(normalizeOptionalText(column.collation)!, 'sqlite')}`);
    }

    if (column.notNull) {
        parts.push('NOT NULL');
    }

    if (column.defaultValue) {
        parts.push(`DEFAULT ${column.defaultValue}`);
    }

    return parts.join(' ');
}

function buildSqlitePreviewSql(tableName: string, tableInfo: TableInfo, nextColumns: ModifyTableColumnDraft[]) {
    const renamedColumns = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column.name]));
    const nextColumnNames = new Set(nextColumns.map((column) => column.name));
    const primaryKeyColumns = nextColumns
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER));
    const inlinePrimaryKeyColumnName = primaryKeyColumns.length === 1 ? primaryKeyColumns[0]?.name : undefined;
    const createParts = nextColumns.map((column) => buildSqliteColumnDefinition(column, column.name === inlinePrimaryKeyColumnName));

    if (primaryKeyColumns.length > 1) {
        createParts.push(`PRIMARY KEY (${primaryKeyColumns.map((column) => quoteSqlIdentifier(column.name, 'sqlite')).join(', ')})`);
    }

    tableInfo.indexes
        .filter((index) => index.origin === 'u' && !index.isPartial)
        .map((index) => index.columns.map((columnName) => renamedColumns.get(columnName) ?? columnName))
        .filter((columnNames) => columnNames.every((columnName) => nextColumnNames.has(columnName)))
        .forEach((columnNames) => {
            createParts.push(`UNIQUE (${columnNames.map((columnName) => quoteSqlIdentifier(columnName, 'sqlite')).join(', ')})`);
        });

    const foreignKeysById = new Map<number, typeof tableInfo.foreignKeys>();

    tableInfo.foreignKeys.forEach((foreignKey) => {
        const group = foreignKeysById.get(foreignKey.id) ?? [];
        group.push(foreignKey);
        foreignKeysById.set(foreignKey.id, group);
    });

    for (const group of foreignKeysById.values()) {
        const mappedFromColumns = group.map((foreignKey) => renamedColumns.get(foreignKey.from) ?? foreignKey.from);

        if (!mappedFromColumns.every((columnName) => nextColumnNames.has(columnName))) {
            continue;
        }

        const parts = [
            `FOREIGN KEY (${mappedFromColumns.map((columnName) => quoteSqlIdentifier(columnName, 'sqlite')).join(', ')})`,
            `REFERENCES ${quoteSqlIdentifier(group[0]!.table, 'sqlite')} (${group.map((foreignKey) => quoteSqlIdentifier(foreignKey.to, 'sqlite')).join(', ')})`,
        ];

        if (group[0]!.onUpdate && group[0]!.onUpdate !== 'NO ACTION') {
            parts.push(`ON UPDATE ${group[0]!.onUpdate}`);
        }

        if (group[0]!.onDelete && group[0]!.onDelete !== 'NO ACTION') {
            parts.push(`ON DELETE ${group[0]!.onDelete}`);
        }

        createParts.push(parts.join(' '));
    }

    const tempTableName = `${tableName}__modified`;
    const transferableColumns = nextColumns.filter((column) => column.originalName && tableInfo.columns.some((entry) => entry.name === column.originalName));
    const statements = ['PRAGMA foreign_keys = OFF;', 'BEGIN IMMEDIATE;', `CREATE TABLE ${quoteSqlIdentifier(tempTableName, 'sqlite')} (\n    ${createParts.join(',\n    ')}\n);`];

    if (transferableColumns.length > 0) {
        statements.push(
            `INSERT INTO ${quoteSqlIdentifier(tempTableName, 'sqlite')} (${transferableColumns
                .map((column) => quoteSqlIdentifier(column.name, 'sqlite'))
                .join(', ')}) SELECT ${transferableColumns
                .map((column) => quoteSqlIdentifier(column.originalName!, 'sqlite'))
                .join(', ')} FROM ${quoteSqlIdentifier(tableName, 'sqlite')};`
        );
    }

    statements.push(`DROP TABLE ${quoteSqlIdentifier(tableName, 'sqlite')};`);
    statements.push(`ALTER TABLE ${quoteSqlIdentifier(tempTableName, 'sqlite')} RENAME TO ${quoteSqlIdentifier(tableName, 'sqlite')};`);

    tableInfo.indexes
        .filter((index) => index.origin === 'c' && !index.isPartial)
        .forEach((index) => {
            const mappedColumns = index.columns.map((columnName) => renamedColumns.get(columnName) ?? columnName);

            if (!mappedColumns.every((columnName) => nextColumnNames.has(columnName))) {
                return;
            }

            statements.push(
                `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'sqlite')} ON ${quoteSqlIdentifier(tableName, 'sqlite')} (${mappedColumns
                    .map((columnName) => quoteSqlIdentifier(columnName, 'sqlite'))
                    .join(', ')});`
            );
        });

    statements.push('COMMIT;');
    statements.push('PRAGMA foreign_keys = ON;');
    return statements;
}

function buildCreateMySqlPreviewStatements(state: ModifyTablePreviewState) {
    const tableName = state.table.name.trim();

    if (!tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const primaryKey = getPrimaryKeyDraft(state.keys);
    const uniqueKeys = getUniqueKeyDrafts(state.keys);
    const standaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const foreignKeys = getActiveForeignKeys(state.foreignKeys);
    const createParts = activeColumns.map((column) => buildMySqlColumnDefinition(column));

    if (primaryKey?.columns.length) {
        createParts.push(`PRIMARY KEY (${primaryKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'mysql')).join(', ')})`);
    }

    uniqueKeys.forEach((key) => {
        createParts.push(`UNIQUE KEY ${quoteSqlIdentifier(key.name, 'mysql')} (${key.columns.map((column) => quoteSqlIdentifier(column.columnName, 'mysql')).join(', ')})`);
    });

    foreignKeys.forEach((foreignKey) => {
        const parts = [
            `CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'mysql')}`,
            `FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'mysql')).join(', ')})`,
            `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'mysql')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'mysql')).join(', ')})`,
        ];

        if (normalizeOptionalText(foreignKey.onDelete)) {
            parts.push(`ON DELETE ${normalizeOptionalText(foreignKey.onDelete)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (normalizeOptionalText(foreignKey.onUpdate)) {
            parts.push(`ON UPDATE ${normalizeOptionalText(foreignKey.onUpdate)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        createParts.push(parts.join(' '));
    });

    const tableOptions = [
        normalizeOptionalText(state.table.engine) ? `ENGINE=${normalizeOptionalText(state.table.engine)}` : undefined,
        normalizeOptionalText(state.table.collation) ? `COLLATE=${normalizeOptionalText(state.table.collation)}` : undefined,
        normalizeOptionalText(state.table.options) ?? undefined,
        normalizeOptionalText(state.table.comment) ? `COMMENT=${escapePreviewSqlString(normalizeOptionalText(state.table.comment)!)} ` : undefined,
    ].filter((value): value is string => !!value);

    const statements = [
        `CREATE TABLE ${quoteSqlIdentifier(tableName, 'mysql')} (\n    ${createParts.join(',\n    ')}\n)${tableOptions.length > 0 ? ` ${tableOptions.join(' ')}` : ''};`,
    ];

    standaloneIndexes.forEach((index) => {
        const clauses = [
            `ALTER TABLE ${quoteSqlIdentifier(tableName, 'mysql')} ADD ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'mysql')}`,
            `(${buildPreviewIndexColumns(index.columns, 'mysql')})`,
        ];

        if (normalizeOptionalText(index.type)) {
            clauses.push(`USING ${normalizeOptionalText(index.type)}`);
        }

        if (normalizeOptionalText(index.comment)) {
            clauses.push(`COMMENT ${escapePreviewSqlString(normalizeOptionalText(index.comment)!)} `);
        }

        statements.push(`${clauses.join(' ')};`);
    });

    return statements;
}

function buildCreatePostgresPreviewStatements(state: ModifyTablePreviewState) {
    const tableName = state.table.name.trim();

    if (!tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const primaryKey = getPrimaryKeyDraft(state.keys);
    const uniqueKeys = getUniqueKeyDrafts(state.keys);
    const standaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const foreignKeys = getActiveForeignKeys(state.foreignKeys);
    const createParts = activeColumns.map((column) => buildPostgresColumnDefinition(column));

    if (primaryKey?.columns.length) {
        createParts.push(`PRIMARY KEY (${primaryKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'postgresql')).join(', ')})`);
    }

    uniqueKeys.forEach((key) => {
        createParts.push(
            `CONSTRAINT ${quoteSqlIdentifier(key.name, 'postgresql')} UNIQUE (${key.columns.map((column) => quoteSqlIdentifier(column.columnName, 'postgresql')).join(', ')})`
        );
    });

    foreignKeys.forEach((foreignKey) => {
        const parts = [
            `CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'postgresql')}`,
            `FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'postgresql')).join(', ')})`,
            `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'postgresql')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'postgresql')).join(', ')})`,
        ];

        if (normalizeOptionalText(foreignKey.match) && normalizeOptionalText(foreignKey.match) !== 'none') {
            parts.push(`MATCH ${normalizeOptionalText(foreignKey.match)!.toUpperCase()}`);
        }

        if (normalizeOptionalText(foreignKey.onDelete)) {
            parts.push(`ON DELETE ${normalizeOptionalText(foreignKey.onDelete)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (normalizeOptionalText(foreignKey.onUpdate)) {
            parts.push(`ON UPDATE ${normalizeOptionalText(foreignKey.onUpdate)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        createParts.push(parts.join(' '));
    });

    const statements = [`CREATE TABLE ${quoteSqlIdentifier(tableName, 'postgresql')} (\n    ${createParts.join(',\n    ')}\n);`];

    if (normalizeOptionalText(state.table.comment)) {
        statements.push(`COMMENT ON TABLE ${quoteSqlIdentifier(tableName, 'postgresql')} IS ${escapePreviewSqlString(normalizeOptionalText(state.table.comment)!)};`);
    }

    activeColumns.forEach((column) => {
        if (!normalizeOptionalText(column.comment)) {
            return;
        }

        statements.push(
            `COMMENT ON COLUMN ${quoteSqlIdentifier(tableName, 'postgresql')}.${quoteSqlIdentifier(column.name, 'postgresql')} IS ${escapePreviewSqlString(normalizeOptionalText(column.comment)!)};`
        );
    });

    standaloneIndexes.forEach((index) => {
        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'postgresql')}${normalizeOptionalText(index.type) ? ` USING ${normalizeOptionalText(index.type)}` : ''} ON ${quoteSqlIdentifier(tableName, 'postgresql')} (${buildPreviewIndexColumns(index.columns, 'postgresql')});`
        );
    });

    return statements;
}

function buildCreateSqlitePreviewStatements(state: ModifyTablePreviewState) {
    const tableName = state.table.name.trim();

    if (!tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const primaryKeyColumns = activeColumns
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER));
    const inlinePrimaryKeyColumnName = primaryKeyColumns.length === 1 ? primaryKeyColumns[0]?.name : undefined;
    const createParts = activeColumns.map((column) => buildSqliteColumnDefinition(column, column.name === inlinePrimaryKeyColumnName));

    if (primaryKeyColumns.length > 1) {
        createParts.push(`PRIMARY KEY (${primaryKeyColumns.map((column) => quoteSqlIdentifier(column.name, 'sqlite')).join(', ')})`);
    }

    getUniqueKeyDrafts(state.keys).forEach((key) => {
        createParts.push(`UNIQUE (${key.columns.map((column) => quoteSqlIdentifier(column.columnName, 'sqlite')).join(', ')})`);
    });

    getActiveForeignKeys(state.foreignKeys).forEach((foreignKey) => {
        const parts = [
            `FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'sqlite')).join(', ')})`,
            `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'sqlite')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'sqlite')).join(', ')})`,
        ];

        if (normalizeOptionalText(foreignKey.onUpdate) && normalizeOptionalText(foreignKey.onUpdate)?.toUpperCase() !== 'NO ACTION') {
            parts.push(`ON UPDATE ${normalizeOptionalText(foreignKey.onUpdate)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (normalizeOptionalText(foreignKey.onDelete) && normalizeOptionalText(foreignKey.onDelete)?.toUpperCase() !== 'NO ACTION') {
            parts.push(`ON DELETE ${normalizeOptionalText(foreignKey.onDelete)!.replaceAll('_', ' ').toUpperCase()}`);
        }

        createParts.push(parts.join(' '));
    });

    const statements = [`CREATE TABLE ${quoteSqlIdentifier(tableName, 'sqlite')} (\n    ${createParts.join(',\n    ')}\n);`];

    getStandaloneIndexDrafts(state.indexes, state.keys).forEach((index) => {
        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'sqlite')} ON ${quoteSqlIdentifier(tableName, 'sqlite')} (${index.columns.map((column) => quoteSqlIdentifier(column.columnName, 'sqlite')).join(', ')});`
        );
    });

    return statements;
}

function buildCreateMsAccessPreviewStatements(state: ModifyTablePreviewState) {
    const tableName = state.table.name.trim();

    if (!tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const primaryKey = getPrimaryKeyDraft(state.keys);
    const uniqueKeys = getUniqueKeyDrafts(state.keys);
    const standaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const foreignKeys = getActiveForeignKeys(state.foreignKeys);
    const statements = [`CREATE TABLE ${quoteSqlIdentifier(tableName, 'msaccess')} (${activeColumns.map((column) => buildMsAccessColumnDefinition(column)).join(', ')});`];

    if (primaryKey?.columns.length) {
        statements.push(
            `ALTER TABLE ${quoteSqlIdentifier(tableName, 'msaccess')} ADD CONSTRAINT ${quoteSqlIdentifier(getMsAccessPrimaryKeyConstraintName(primaryKey), 'msaccess')} PRIMARY KEY (${primaryKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'msaccess')).join(', ')});`
        );
    }

    uniqueKeys.forEach((key) => {
        statements.push(
            `CREATE UNIQUE INDEX ${quoteSqlIdentifier(key.name, 'msaccess')} ON ${quoteSqlIdentifier(tableName, 'msaccess')} (${key.columns.map((column) => quoteSqlIdentifier(column.columnName, 'msaccess')).join(', ')});`
        );
    });

    standaloneIndexes.forEach((index) => {
        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'msaccess')} ON ${quoteSqlIdentifier(tableName, 'msaccess')} (${index.columns.map((column) => `${quoteSqlIdentifier(column.columnName, 'msaccess')}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ')});`
        );
    });

    foreignKeys.forEach((foreignKey) => {
        const actions = [buildMsAccessForeignKeyActionClause('update', foreignKey.onUpdate), buildMsAccessForeignKeyActionClause('delete', foreignKey.onDelete)].filter(
            (value): value is string => !!value
        );

        statements.push(
            `ALTER TABLE ${quoteSqlIdentifier(tableName, 'msaccess')} ADD CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'msaccess')} FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'msaccess')).join(', ')}) REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'msaccess')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'msaccess')).join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
        );
    });

    return statements;
}

function buildCreatePreviewStatements(state: ModifyTablePreviewState) {
    if (!state.driver) {
        return [] as string[];
    }

    const validationErrors = getModifyTableValidationErrors(state);

    if (validationErrors.length > 0) {
        return [] as string[];
    }

    if (state.driver === 'mysql') {
        return buildCreateMySqlPreviewStatements(state);
    }

    if (state.driver === 'postgresql') {
        return buildCreatePostgresPreviewStatements(state);
    }

    if (state.driver === 'sqlite') {
        return buildCreateSqlitePreviewStatements(state);
    }

    if (state.driver === 'msaccess') {
        return buildCreateMsAccessPreviewStatements(state);
    }

    return [] as string[];
}

function buildMsAccessColumnDefinition(column: ModifyTableColumnDraft, primaryKeyConstraintName?: string) {
    const parts = [quoteSqlIdentifier(column.name, 'msaccess'), column.isAutoIncrement ? 'AUTOINCREMENT' : column.type.trim()];

    if (column.isAutoIncrement && primaryKeyConstraintName) {
        parts.push(`CONSTRAINT ${quoteSqlIdentifier(primaryKeyConstraintName, 'msaccess')} PRIMARY KEY`);
    }

    if (!column.isAutoIncrement && column.notNull) {
        parts.push('NOT NULL');
    }

    if (normalizeOptionalText(column.defaultValue)) {
        parts.push(`DEFAULT ${normalizeOptionalText(column.defaultValue)}`);
    }

    return parts.join(' ');
}

function getMsAccessPrimaryKeyConstraintName(primaryKey: ModifyTableKeyDraft | undefined) {
    const normalizedName = primaryKey?.name.trim();

    if (!normalizedName || normalizedName.toLowerCase() === 'primary') {
        return 'PKEY';
    }

    return normalizedName;
}

function buildMsAccessForeignKeyActionClause(kind: 'update' | 'delete', action: string | null | undefined) {
    const normalizedAction = normalizeOptionalText(action)?.replaceAll('_', ' ').toUpperCase();

    if (!normalizedAction || normalizedAction === 'NO ACTION' || normalizedAction === 'RESTRICT') {
        return undefined;
    }

    return `ON ${kind.toUpperCase()} ${normalizedAction}`;
}

function buildMsAccessPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    if (state.allowTableRebuild && getMsAccessExplicitPlanErrors(state).length > 0) {
        return buildMsAccessRebuildPreviewStatements(state);
    }

    const currentTableName = state.tableName;
    const nextTableName = state.table.name.trim() || currentTableName;
    const activeColumns = getActiveColumns(state.columns);
    const currentKeys = createKeyDrafts(state.currentTableInfo);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(createIndexDrafts(state.currentTableInfo), currentKeys);
    const currentForeignKeys = createForeignKeyDrafts(currentTableName, state.currentTableInfo);
    const statements: string[] = [];
    let workingTableName = currentTableName;

    if (nextTableName !== currentTableName) {
        statements.push(`ALTER TABLE ${quoteSqlIdentifier(currentTableName, 'msaccess')} RENAME TO ${quoteSqlIdentifier(nextTableName, 'msaccess')};`);
        workingTableName = nextTableName;
    }

    activeColumns
        .filter((column) => !column.originalName)
        .forEach((column) => {
            statements.push(`ALTER TABLE ${quoteSqlIdentifier(workingTableName, 'msaccess')} ADD COLUMN ${buildMsAccessColumnDefinition(column)};`);
        });

    getUniqueKeyDrafts(state.keys)
        .filter((key) => !currentUniqueKeys.some((currentKey) => currentKey.name.toLowerCase() === (key.originalName ?? key.name).toLowerCase()))
        .forEach((key) => {
            statements.push(
                `CREATE UNIQUE INDEX ${quoteSqlIdentifier(key.name, 'msaccess')} ON ${quoteSqlIdentifier(workingTableName, 'msaccess')} (${key.columns
                    .map((column) => quoteSqlIdentifier(column.columnName, 'msaccess'))
                    .join(', ')});`
            );
        });

    getStandaloneIndexDrafts(state.indexes, state.keys)
        .filter((index) => !currentStandaloneIndexes.some((currentIndex) => currentIndex.name.toLowerCase() === (index.originalName ?? index.name).toLowerCase()))
        .forEach((index) => {
            statements.push(
                `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'msaccess')} ON ${quoteSqlIdentifier(workingTableName, 'msaccess')} (${index.columns
                    .map((column) => `${quoteSqlIdentifier(column.columnName, 'msaccess')}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`)
                    .join(', ')});`
            );
        });

    getActiveForeignKeys(state.foreignKeys)
        .filter(
            (foreignKey) => !currentForeignKeys.some((currentForeignKey) => currentForeignKey.name.toLowerCase() === (foreignKey.originalName ?? foreignKey.name).toLowerCase())
        )
        .forEach((foreignKey) => {
            const targetTableName = foreignKey.targetTable.trim().toLowerCase() === currentTableName.toLowerCase() ? nextTableName : foreignKey.targetTable;
            const actions = [buildMsAccessForeignKeyActionClause('update', foreignKey.onUpdate), buildMsAccessForeignKeyActionClause('delete', foreignKey.onDelete)].filter(
                (value): value is string => !!value
            );

            statements.push(
                `ALTER TABLE ${quoteSqlIdentifier(workingTableName, 'msaccess')} ADD CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'msaccess')} FOREIGN KEY (${foreignKey.columns
                    .map((column) => quoteSqlIdentifier(column.columnName, 'msaccess'))
                    .join(', ')}) REFERENCES ${quoteSqlIdentifier(targetTableName, 'msaccess')} (${foreignKey.columns
                    .map((column) => quoteSqlIdentifier(column.targetName, 'msaccess'))
                    .join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
            );
        });

    return statements;
}

function buildMsAccessRebuildPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentTableName = state.tableName;
    const nextTableName = state.table.name.trim() || currentTableName;
    const activeColumns = getActiveColumns(state.columns);
    const primaryKey = getPrimaryKeyDraft(state.keys);
    const uniqueKeys = getUniqueKeyDrafts(state.keys);
    const standaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const tempTableName = `${currentTableName}__modified`;
    const createParts = activeColumns.map((column) => buildMsAccessColumnDefinition(column));

    const statements = ['BEGIN TRANSACTION;', `CREATE TABLE ${quoteSqlIdentifier(tempTableName, 'msaccess')} (${createParts.join(', ')});`];
    const transferableColumns = activeColumns.filter(
        (column) => column.originalName && state.currentTableInfo!.columns.some((currentColumn) => currentColumn.name.toLowerCase() === column.originalName!.toLowerCase())
    );

    if (transferableColumns.length > 0) {
        statements.push(
            `INSERT INTO ${quoteSqlIdentifier(tempTableName, 'msaccess')} (${transferableColumns.map((column) => quoteSqlIdentifier(column.name, 'msaccess')).join(', ')}) ` +
                `SELECT ${transferableColumns.map((column) => quoteSqlIdentifier(column.originalName!, 'msaccess')).join(', ')} FROM ${quoteSqlIdentifier(state.tableName, 'msaccess')};`
        );
    }

    statements.push(`DROP TABLE ${quoteSqlIdentifier(currentTableName, 'msaccess')};`);

    if (primaryKey && primaryKey.columns.length > 0) {
        statements.push(
            `ALTER TABLE ${quoteSqlIdentifier(tempTableName, 'msaccess')} ADD CONSTRAINT ${quoteSqlIdentifier(getMsAccessPrimaryKeyConstraintName(primaryKey), 'msaccess')} PRIMARY KEY (${primaryKey.columns
                .map((column) => quoteSqlIdentifier(column.columnName, 'msaccess'))
                .join(', ')});`
        );
    }

    statements.push(`ALTER TABLE ${quoteSqlIdentifier(tempTableName, 'msaccess')} RENAME TO ${quoteSqlIdentifier(nextTableName, 'msaccess')};`);

    uniqueKeys.forEach((key) => {
        statements.push(
            `CREATE UNIQUE INDEX ${quoteSqlIdentifier(key.name, 'msaccess')} ON ${quoteSqlIdentifier(nextTableName, 'msaccess')} (${key.columns
                .map((column) => quoteSqlIdentifier(column.columnName, 'msaccess'))
                .join(', ')});`
        );
    });

    standaloneIndexes.forEach((index) => {
        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'msaccess')} ON ${quoteSqlIdentifier(nextTableName, 'msaccess')} (${index.columns
                .map((column) => `${quoteSqlIdentifier(column.columnName, 'msaccess')}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`)
                .join(', ')});`
        );
    });

    getActiveForeignKeys(state.foreignKeys).forEach((foreignKey) => {
        const targetTableName = foreignKey.targetTable.trim().toLowerCase() === currentTableName.toLowerCase() ? nextTableName : foreignKey.targetTable;
        const actions = [buildMsAccessForeignKeyActionClause('update', foreignKey.onUpdate), buildMsAccessForeignKeyActionClause('delete', foreignKey.onDelete)].filter(
            (value): value is string => !!value
        );

        statements.push(
            `ALTER TABLE ${quoteSqlIdentifier(nextTableName, 'msaccess')} ADD CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'msaccess')} FOREIGN KEY (${foreignKey.columns
                .map((column) => quoteSqlIdentifier(column.columnName, 'msaccess'))
                .join(', ')}) REFERENCES ${quoteSqlIdentifier(targetTableName, 'msaccess')} (${foreignKey.columns
                .map((column) => quoteSqlIdentifier(column.targetName, 'msaccess'))
                .join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
        );
    });

    statements.push('COMMIT;');
    return statements;
}

function getColumnValidationErrors(columns: ModifyTableColumnDraft[], driver: DbType | undefined, originalColumns: ModifyTableColumnDraft[]) {
    const errors: string[] = [];

    if (driver === 'sqlserver') {
        return ['Modify Table is not supported for SQL Server yet.'];
    }

    const activeColumns = getActiveColumns(columns);
    const seenNames = new Set<string>();
    const originalColumnsByName = createOriginalColumnsByName(originalColumns);

    for (const column of activeColumns) {
        const name = column.name.trim();
        const type = column.type.trim();

        if (!name) {
            errors.push('Column name is required.');
            continue;
        }

        if (!type) {
            errors.push(`Column ${name} is missing a data type.`);
        }

        const lowerName = name.toLowerCase();

        if (seenNames.has(lowerName)) {
            errors.push(`Column ${name} is duplicated.`);
        }

        seenNames.add(lowerName);

        if (column.isAutoIncrement && !column.isPrimaryKey) {
            errors.push(`Column ${name} can only be auto-increment when it is part of the primary key.`);
        }

        if (driver === 'postgresql' && normalizeOptionalText(column.onUpdate)) {
            errors.push(`Column ${name} cannot use ON UPDATE on PostgreSQL.`);
        }

        if (driver === 'postgresql' && column.originalName) {
            const originalColumn = originalColumnsByName.get(column.originalName);

            if (originalColumn && normalizeOptionalText(column.collation) !== normalizeOptionalText(originalColumn.collation)) {
                errors.push(`Column ${name} cannot change collation on PostgreSQL in Modify Table.`);
            }

            if (originalColumn && column.isAutoIncrement !== originalColumn.isAutoIncrement) {
                errors.push(`Column ${name} cannot change identity mode on PostgreSQL in Modify Table.`);
            }
        }
    }

    return [...new Set(errors)];
}

function normalizePreviewList(values: (string | null | undefined)[]) {
    return values.map((value) => normalizeOptionalText(value) ?? '').join('|');
}

function getActiveKeys(keys: ModifyTableKeyDraft[]) {
    return keys.filter((key) => key.status !== 'deleted');
}

function getActiveForeignKeys(foreignKeys: ModifyTableForeignKeyDraft[]) {
    return foreignKeys.filter((foreignKey) => foreignKey.status !== 'deleted');
}

function getActiveIndexes(indexes: ModifyTableIndexDraft[]) {
    return indexes.filter((index) => index.status !== 'deleted');
}

function buildKeySignature(key: Pick<ModifyTableKeyDraft, 'name' | 'isPrimary' | 'columns'>) {
    return [key.isPrimary ? 'primary' : 'unique', key.name.trim().toLowerCase(), normalizePreviewList(key.columns.map((column) => column.columnName))].join('::');
}

function buildForeignKeySignature(foreignKey: Pick<ModifyTableForeignKeyDraft, 'name' | 'targetTable' | 'columns' | 'onDelete' | 'onUpdate' | 'match'>) {
    return [
        foreignKey.name.trim().toLowerCase(),
        foreignKey.targetTable.trim().toLowerCase(),
        normalizePreviewList(foreignKey.columns.map((column) => `${column.columnName}->${column.targetName}`)),
        normalizeOptionalText(foreignKey.onDelete) ?? '',
        normalizeOptionalText(foreignKey.onUpdate) ?? '',
        normalizeOptionalText(foreignKey.match) ?? '',
    ].join('::');
}

function buildIndexSignature(index: Pick<ModifyTableIndexDraft, 'name' | 'comment' | 'isUnique' | 'type' | 'columns'>) {
    return [
        index.name.trim().toLowerCase(),
        index.isUnique ? 'unique' : 'plain',
        normalizeOptionalText(index.comment) ?? '',
        normalizeOptionalText(index.type) ?? '',
        normalizePreviewList(index.columns.map((column) => `${column.columnName}:${column.order}`)),
    ].join('::');
}

function buildMsAccessColumnSignature(
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

function getMsAccessExplicitPlanErrors(state: ModifyTablePreviewState) {
    if (!state.currentTableInfo || !state.tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const currentColumns = state.currentTableInfo.columns;
    const currentKeys = createKeyDrafts(state.currentTableInfo);
    const currentPrimaryKey = getPrimaryKeyDraft(currentKeys);
    const desiredPrimaryKey = getPrimaryKeyDraft(state.keys);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(createIndexDrafts(state.currentTableInfo), currentKeys);
    const currentForeignKeys = createForeignKeyDrafts(state.tableName, state.currentTableInfo);
    const errors: string[] = [];

    currentColumns.forEach((currentColumn) => {
        const desiredColumn = activeColumns.find((column) => (column.originalName ?? column.name).toLowerCase() === currentColumn.name.toLowerCase());

        if (!desiredColumn) {
            errors.push(`MS Access cannot drop existing column ${currentColumn.name}: not possible because ALTER TABLE ... DROP COLUMN is not supported by UCanAccess.`);
            return;
        }

        if (desiredColumn.name.trim().toLowerCase() !== currentColumn.name.toLowerCase()) {
            errors.push(
                `MS Access cannot rename existing column ${currentColumn.name}: not possible because ALTER TABLE ... RENAME [old] TO [new] is not supported by UCanAccess.`
            );
            return;
        }

        if (buildMsAccessColumnSignature(desiredColumn) !== buildMsAccessColumnSignature(createColumnDraft(currentColumn))) {
            errors.push(`MS Access cannot alter existing column ${currentColumn.name}: not possible because ALTER TABLE ... ALTER COLUMN is not supported by UCanAccess.`);
        }
    });

    if (
        activeColumns.length < currentColumns.length ||
        !activeColumns.slice(0, currentColumns.length).every((column, index) => (column.originalName ?? column.name).toLowerCase() === currentColumns[index]?.name.toLowerCase())
    ) {
        errors.push(
            'MS Access can only append new columns with explicit commands: ALTER TABLE ... ADD COLUMN works in UCanAccess, but reordering columns or inserting a column between existing columns is not supported.'
        );
    }

    if (
        (currentPrimaryKey && !desiredPrimaryKey) ||
        (!currentPrimaryKey && desiredPrimaryKey) ||
        (currentPrimaryKey && desiredPrimaryKey && buildKeySignature(currentPrimaryKey) !== buildKeySignature(desiredPrimaryKey))
    ) {
        errors.push(
            'MS Access cannot change the primary key here: this would require dropping or recreating the existing constraint, and ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.'
        );
    }

    currentUniqueKeys.forEach((currentKey) => {
        const desiredKey = getUniqueKeyDrafts(state.keys).find((key) => (key.originalName ?? key.name).toLowerCase() === currentKey.name.toLowerCase());

        if (!desiredKey) {
            errors.push(`MS Access cannot drop existing unique key ${currentKey.name}: not possible because DROP INDEX is not supported by UCanAccess.`);
            return;
        }

        if (buildKeySignature(currentKey) !== buildKeySignature(desiredKey)) {
            errors.push(
                `MS Access cannot modify existing unique key ${currentKey.name}: this would require DROP INDEX or ALTER INDEX, and those operations are not supported by UCanAccess.`
            );
        }
    });

    currentStandaloneIndexes.forEach((currentIndex) => {
        const desiredIndex = getStandaloneIndexDrafts(state.indexes, state.keys).find(
            (index) => (index.originalName ?? index.name).toLowerCase() === currentIndex.name.toLowerCase()
        );

        if (!desiredIndex) {
            errors.push(`MS Access cannot drop existing index ${currentIndex.name}: not possible because DROP INDEX is not supported by UCanAccess.`);
            return;
        }

        if (buildIndexSignature(currentIndex) !== buildIndexSignature(desiredIndex)) {
            errors.push(
                `MS Access cannot modify existing index ${currentIndex.name}: this would require DROP INDEX or ALTER INDEX, and those operations are not supported by UCanAccess.`
            );
        }
    });

    currentForeignKeys.forEach((currentForeignKey) => {
        const desiredForeignKey = getActiveForeignKeys(state.foreignKeys).find(
            (foreignKey) => (foreignKey.originalName ?? foreignKey.name).toLowerCase() === currentForeignKey.name.toLowerCase()
        );

        if (!desiredForeignKey) {
            errors.push(
                `MS Access cannot drop existing foreign key ${currentForeignKey.name}: not possible because ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.`
            );
            return;
        }

        if (buildForeignKeySignature(currentForeignKey) !== buildForeignKeySignature(desiredForeignKey)) {
            errors.push(
                `MS Access cannot modify existing foreign key ${currentForeignKey.name}: this would require dropping or recreating the existing constraint, and ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.`
            );
        }
    });

    return [...new Set(errors)];
}

function escapePreviewSqlString(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

function getPrimaryKeyDraft(keys: ModifyTableKeyDraft[]) {
    return getActiveKeys(keys).find((key) => key.isPrimary);
}

function syncColumnsWithPrimaryKeyDraft(columns: ModifyTableColumnDraft[], keys: ModifyTableKeyDraft[]) {
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

function getUniqueKeyDrafts(keys: ModifyTableKeyDraft[]) {
    return getActiveKeys(keys).filter((key) => !key.isPrimary);
}

function isPrimaryIndexDraft(index: Pick<ModifyTableIndexDraft, 'name' | 'columns'>, primaryKeyColumns: string[]) {
    if (index.name.trim().toLowerCase() === 'primary') {
        return true;
    }

    return (
        primaryKeyColumns.length > 0 &&
        index.columns.length === primaryKeyColumns.length &&
        index.columns.every((column, indexPosition) => column.columnName === primaryKeyColumns[indexPosition])
    );
}

function getStandaloneIndexDrafts(indexes: ModifyTableIndexDraft[], keys: ModifyTableKeyDraft[]) {
    const primaryKeyColumns = getPrimaryKeyDraft(keys)?.columns.map((column) => column.columnName) ?? [];
    const excludedNames = new Set(getActiveKeys(keys).map((key) => key.name.toLowerCase()));
    excludedNames.add('primary');
    return getActiveIndexes(indexes).filter((index) => !excludedNames.has(index.name.toLowerCase()) && !isPrimaryIndexDraft(index, primaryKeyColumns));
}

function buildPreviewIndexColumns(columns: Array<{ columnName: string; order?: string | null }>, driver: DbType) {
    return columns.map((column) => `${quoteSqlIdentifier(column.columnName, driver)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ');
}

function buildMySqlTableOptionPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentInfo = state.currentTableInfo;
    const quotedTableName = quoteSqlIdentifier(state.tableName, 'mysql');
    const statements: string[] = [];

    if (normalizeOptionalText(state.table.comment) !== normalizeOptionalText(currentInfo.comment)) {
        statements.push(`ALTER TABLE ${quotedTableName} COMMENT = ${escapePreviewSqlString(state.table.comment ?? '')};`);
    }

    if (normalizeOptionalText(state.table.engine) && normalizeOptionalText(state.table.engine) !== normalizeOptionalText(currentInfo.engine)) {
        statements.push(`ALTER TABLE ${quotedTableName} ENGINE = ${normalizeOptionalText(state.table.engine)};`);
    }

    if (normalizeOptionalText(state.table.collation) && normalizeOptionalText(state.table.collation) !== normalizeOptionalText(currentInfo.collation)) {
        statements.push(`ALTER TABLE ${quotedTableName} COLLATE = ${normalizeOptionalText(state.table.collation)};`);
    }

    if (normalizeOptionalText(state.table.options) && normalizeOptionalText(state.table.options) !== normalizeOptionalText(currentInfo.options)) {
        statements.push(`ALTER TABLE ${quotedTableName} ${normalizeOptionalText(state.table.options)};`);
    }

    if ((state.table.name.trim() || state.tableName) !== state.tableName) {
        statements.push(`RENAME TABLE ${quotedTableName} TO ${quoteSqlIdentifier(state.table.name.trim(), 'mysql')};`);
    }

    return statements;
}

function buildMySqlExtendedPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentInfo = state.currentTableInfo;
    const quotedTableName = quoteSqlIdentifier(state.tableName, 'mysql');
    const currentKeys = createKeyDrafts(currentInfo);
    const currentIndexes = createIndexDrafts(currentInfo);
    const currentForeignKeys = createForeignKeyDrafts(state.tableName, currentInfo);
    const desiredPrimaryKey = getPrimaryKeyDraft(state.keys);
    const currentPrimaryKey = getPrimaryKeyDraft(currentKeys);
    const desiredUniqueKeys = getUniqueKeyDrafts(state.keys);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const desiredStandaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(currentIndexes, currentKeys);
    const desiredForeignKeys = getActiveForeignKeys(state.foreignKeys);
    const statements: string[] = [];

    currentForeignKeys.forEach((foreignKey) => {
        const desiredForeignKey = desiredForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

        if (!desiredForeignKey || buildForeignKeySignature(foreignKey) !== buildForeignKeySignature(desiredForeignKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP FOREIGN KEY ${quoteSqlIdentifier(foreignKey.name, 'mysql')};`);
        }
    });

    currentUniqueKeys.forEach((key) => {
        const desiredKey = desiredUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!desiredKey || buildKeySignature(key) !== buildKeySignature(desiredKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${quoteSqlIdentifier(key.name, 'mysql')};`);
        }
    });

    currentStandaloneIndexes.forEach((index) => {
        const desiredIndex = desiredStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!desiredIndex || buildIndexSignature(index) !== buildIndexSignature(desiredIndex)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${quoteSqlIdentifier(index.name, 'mysql')};`);
        }
    });

    if (currentPrimaryKey && (!desiredPrimaryKey || buildKeySignature(currentPrimaryKey) !== buildKeySignature(desiredPrimaryKey))) {
        statements.push(`ALTER TABLE ${quotedTableName} DROP PRIMARY KEY;`);
    }

    if (desiredPrimaryKey && (!currentPrimaryKey || buildKeySignature(currentPrimaryKey) !== buildKeySignature(desiredPrimaryKey))) {
        statements.push(
            `ALTER TABLE ${quotedTableName} ADD PRIMARY KEY (${desiredPrimaryKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'mysql')).join(', ')});`
        );
    }

    desiredUniqueKeys.forEach((key) => {
        const currentKey = currentUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!currentKey || buildKeySignature(currentKey) !== buildKeySignature(key)) {
            statements.push(
                `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${quoteSqlIdentifier(key.name, 'mysql')} UNIQUE (${key.columns
                    .map((column) => quoteSqlIdentifier(column.columnName, 'mysql'))
                    .join(', ')});`
            );
        }
    });

    desiredStandaloneIndexes.forEach((index) => {
        const currentIndex = currentStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!currentIndex || buildIndexSignature(currentIndex) !== buildIndexSignature(index)) {
            const clauses = [
                `ALTER TABLE ${quotedTableName} ADD ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'mysql')}`,
                `(${buildPreviewIndexColumns(index.columns, 'mysql')})`,
            ];

            if (normalizeOptionalText(index.type)) {
                clauses.push(`USING ${normalizeOptionalText(index.type)}`);
            }

            if (normalizeOptionalText(index.comment)) {
                clauses.push(`COMMENT ${escapePreviewSqlString(normalizeOptionalText(index.comment)!)}`);
            }

            statements.push(`${clauses.join(' ')};`);
        }
    });

    desiredForeignKeys.forEach((foreignKey) => {
        const currentForeignKey = currentForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

        if (!currentForeignKey || buildForeignKeySignature(currentForeignKey) !== buildForeignKeySignature(foreignKey)) {
            const clauses = [
                `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'mysql')}`,
                `FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'mysql')).join(', ')})`,
                `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'mysql')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'mysql')).join(', ')})`,
            ];

            if (normalizeOptionalText(foreignKey.onDelete)) {
                clauses.push(`ON DELETE ${normalizeOptionalText(foreignKey.onDelete)!.replaceAll('_', ' ').toUpperCase()}`);
            }

            if (normalizeOptionalText(foreignKey.onUpdate)) {
                clauses.push(`ON UPDATE ${normalizeOptionalText(foreignKey.onUpdate)!.replaceAll('_', ' ').toUpperCase()}`);
            }

            statements.push(`${clauses.join(' ')};`);
        }
    });

    statements.push(...buildMySqlTableOptionPreviewStatements(state));

    return statements;
}

function buildPostgresExtendedPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentInfo = state.currentTableInfo;
    const quotedTableName = quoteSqlIdentifier(state.tableName, 'postgresql');
    const currentKeys = createKeyDrafts(currentInfo);
    const currentIndexes = createIndexDrafts(currentInfo);
    const currentForeignKeys = createForeignKeyDrafts(state.tableName, currentInfo);
    const desiredPrimaryKey = getPrimaryKeyDraft(state.keys);
    const currentPrimaryKey = getPrimaryKeyDraft(currentKeys);
    const desiredUniqueKeys = getUniqueKeyDrafts(state.keys);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const desiredStandaloneIndexes = getStandaloneIndexDrafts(state.indexes, state.keys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(currentIndexes, currentKeys);
    const desiredForeignKeys = getActiveForeignKeys(state.foreignKeys);
    const statements: string[] = [];

    currentForeignKeys.forEach((foreignKey) => {
        const desiredForeignKey = desiredForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

        if (!desiredForeignKey || buildForeignKeySignature(foreignKey) !== buildForeignKeySignature(desiredForeignKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'postgresql')};`);
        }
    });

    currentUniqueKeys.forEach((key) => {
        const desiredKey = desiredUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!desiredKey || buildKeySignature(key) !== buildKeySignature(desiredKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${quoteSqlIdentifier(key.name, 'postgresql')};`);
        }
    });

    currentStandaloneIndexes.forEach((index) => {
        const desiredIndex = desiredStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!desiredIndex || buildIndexSignature(index) !== buildIndexSignature(desiredIndex)) {
            statements.push(`DROP INDEX ${quoteSqlIdentifier(index.name, 'postgresql')};`);
        }
    });

    if (currentPrimaryKey && (!desiredPrimaryKey || buildKeySignature(currentPrimaryKey) !== buildKeySignature(desiredPrimaryKey))) {
        statements.push(`ALTER TABLE ${quotedTableName} DROP CONSTRAINT ${quoteSqlIdentifier(`${state.tableName}_pkey`, 'postgresql')};`);
    }

    if (desiredPrimaryKey && (!currentPrimaryKey || buildKeySignature(currentPrimaryKey) !== buildKeySignature(desiredPrimaryKey))) {
        statements.push(
            `ALTER TABLE ${quotedTableName} ADD PRIMARY KEY (${desiredPrimaryKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'postgresql')).join(', ')});`
        );
    }

    desiredUniqueKeys.forEach((key) => {
        const currentKey = currentUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!currentKey || buildKeySignature(currentKey) !== buildKeySignature(key)) {
            statements.push(
                `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${quoteSqlIdentifier(key.name, 'postgresql')} UNIQUE (${key.columns
                    .map((column) => quoteSqlIdentifier(column.columnName, 'postgresql'))
                    .join(', ')});`
            );
        }
    });

    desiredStandaloneIndexes.forEach((index) => {
        const currentIndex = currentStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!currentIndex || buildIndexSignature(currentIndex) !== buildIndexSignature(index)) {
            statements.push(
                `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteSqlIdentifier(index.name, 'postgresql')}${normalizeOptionalText(index.type) ? ` USING ${normalizeOptionalText(index.type)}` : ''} ON ${quotedTableName} (${buildPreviewIndexColumns(index.columns, 'postgresql')});`
            );
        }
    });

    desiredForeignKeys.forEach((foreignKey) => {
        const currentForeignKey = currentForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

        if (!currentForeignKey || buildForeignKeySignature(currentForeignKey) !== buildForeignKeySignature(foreignKey)) {
            const clauses = [
                `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${quoteSqlIdentifier(foreignKey.name, 'postgresql')}`,
                `FOREIGN KEY (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.columnName, 'postgresql')).join(', ')})`,
                `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'postgresql')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'postgresql')).join(', ')})`,
            ];

            if (normalizeOptionalText(foreignKey.match) && normalizeOptionalText(foreignKey.match) !== 'none') {
                clauses.push(`MATCH ${normalizeOptionalText(foreignKey.match)!.toUpperCase()}`);
            }

            if (normalizeOptionalText(foreignKey.onDelete)) {
                clauses.push(`ON DELETE ${normalizeOptionalText(foreignKey.onDelete)!.replaceAll('_', ' ').toUpperCase()}`);
            }

            if (normalizeOptionalText(foreignKey.onUpdate)) {
                clauses.push(`ON UPDATE ${normalizeOptionalText(foreignKey.onUpdate)!.replaceAll('_', ' ').toUpperCase()}`);
            }

            statements.push(`${clauses.join(' ')};`);
        }
    });

    if (normalizeOptionalText(state.table.comment) !== normalizeOptionalText(currentInfo.comment)) {
        statements.push(
            `COMMENT ON TABLE ${quotedTableName} IS ${normalizeOptionalText(state.table.comment) ? escapePreviewSqlString(normalizeOptionalText(state.table.comment)!) : 'NULL'};`
        );
    }

    if ((state.table.name.trim() || state.tableName) !== state.tableName) {
        statements.push(`ALTER TABLE ${quotedTableName} RENAME TO ${quoteSqlIdentifier(state.table.name.trim(), 'postgresql')};`);
    }

    return statements;
}

function hasExtendedSchemaChanges(state: ModifyTablePreviewState) {
    const currentTableInfo = state.currentTableInfo;

    if (!currentTableInfo) {
        return false;
    }

    if ((state.table.name.trim() || state.tableName || '') !== (currentTableInfo.name || state.tableName || '')) {
        return true;
    }

    if (normalizeOptionalText(state.table.comment) !== normalizeOptionalText(currentTableInfo.comment)) {
        return true;
    }

    if (normalizeOptionalText(state.table.engine) !== normalizeOptionalText(currentTableInfo.engine)) {
        return true;
    }

    if (normalizeOptionalText(state.table.collation) !== normalizeOptionalText(currentTableInfo.collation)) {
        return true;
    }

    if (normalizeOptionalText(state.table.options) !== normalizeOptionalText(currentTableInfo.options)) {
        return true;
    }

    const currentPrimaryKey = [...currentTableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);
    const currentKeys = [
        ...(currentPrimaryKey.length > 0
            ? [
                  buildKeySignature({
                      name: 'PRIMARY',
                      isPrimary: true,
                      columns: currentPrimaryKey.map((columnName) => ({ id: columnName, columnName })),
                  }),
              ]
            : []),
        ...currentTableInfo.indexes
            .filter((index) => index.isUnique && !isPrimaryIndex(index, currentPrimaryKey))
            .map((index) =>
                buildKeySignature({
                    name: index.name,
                    isPrimary: false,
                    columns: index.columns.map((columnName) => ({ id: columnName, columnName })),
                })
            ),
    ].sort();
    const nextKeys = getActiveKeys(state.keys)
        .map((key) => buildKeySignature(key))
        .sort();

    if (currentKeys.join('\n') !== nextKeys.join('\n')) {
        return true;
    }

    const currentForeignKeysByGroup = new Map<string, TableForeignKeyInfo[]>();

    currentTableInfo.foreignKeys.forEach((foreignKey) => {
        const groupKey = foreignKey.name ?? String(foreignKey.id);
        const group = currentForeignKeysByGroup.get(groupKey) ?? [];
        group.push(foreignKey);
        currentForeignKeysByGroup.set(groupKey, group);
    });

    const currentForeignKeys = [...currentForeignKeysByGroup.entries()]
        .map(([groupKey, group]) => {
            const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);
            return buildForeignKeySignature({
                name: sortedGroup[0]?.name ?? groupKey,
                targetTable: sortedGroup[0]?.table ?? '',
                columns: sortedGroup.map((foreignKey) => ({ id: `${foreignKey.id}:${foreignKey.sequence}`, columnName: foreignKey.from, targetName: foreignKey.to })),
                onDelete: sortedGroup[0]?.onDelete?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
                onUpdate: sortedGroup[0]?.onUpdate?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
                match: sortedGroup[0]?.match?.toLowerCase() ?? 'none',
            });
        })
        .sort();
    const nextForeignKeys = getActiveForeignKeys(state.foreignKeys)
        .map((foreignKey) => buildForeignKeySignature(foreignKey))
        .sort();

    if (currentForeignKeys.join('\n') !== nextForeignKeys.join('\n')) {
        return true;
    }

    const currentIndexes = currentTableInfo.indexes.map((index) =>
        buildIndexSignature({
            name: index.name,
            comment: index.comment ?? '',
            isUnique: index.isUnique,
            type: index.type ?? 'btree',
            columns: index.columns.map((columnName, indexPosition) => ({ id: `${index.name}:${columnName}`, columnName, order: index.orders?.[indexPosition] ?? 'NONE' })),
        })
    );
    const nextIndexes = getActiveIndexes(state.indexes).map((index) => buildIndexSignature(index));

    return currentIndexes.sort().join('\n') !== nextIndexes.sort().join('\n');
}

function hasColumnSchemaChanges(state: ModifyTablePreviewState) {
    const activeColumns = getActiveColumns(state.columns);
    const originalColumnsByName = createOriginalColumnsByName(state.originalColumns);

    if (activeColumns.length !== state.originalColumns.length) {
        return true;
    }

    return activeColumns.some((column) => {
        const originalColumn = column.originalName ? originalColumnsByName.get(column.originalName) : undefined;

        if (!originalColumn) {
            return true;
        }

        return (
            column.name !== originalColumn.name ||
            column.type.trim() !== originalColumn.type.trim() ||
            column.notNull !== originalColumn.notNull ||
            normalizeOptionalText(column.defaultValue) !== normalizeOptionalText(originalColumn.defaultValue) ||
            column.isPrimaryKey !== originalColumn.isPrimaryKey ||
            (column.primaryKeyOrdinal ?? null) !== (originalColumn.primaryKeyOrdinal ?? null) ||
            column.isAutoIncrement !== originalColumn.isAutoIncrement ||
            normalizeOptionalText(column.comment) !== normalizeOptionalText(originalColumn.comment) ||
            normalizeOptionalText(column.collation) !== normalizeOptionalText(originalColumn.collation) ||
            normalizeOptionalText(column.onUpdate) !== normalizeOptionalText(originalColumn.onUpdate) ||
            column.hidden !== originalColumn.hidden ||
            normalizeOptionalText(column.columnKind) !== normalizeOptionalText(originalColumn.columnKind)
        );
    });
}

function getModifyTableValidationErrors(state: ModifyTablePreviewState) {
    const errors = [...getColumnValidationErrors(state.columns, state.driver, state.originalColumns)];
    const tableName = state.table.name.trim();
    const activeColumns = getActiveColumns(state.columns);

    if (activeColumns.length === 0) {
        errors.push('At least one column is required.');
    }

    if (state.driver === 'msaccess') {
        if (!state.allowTableRebuild) {
            errors.push(...getMsAccessExplicitPlanErrors(state));
        }

        if (normalizeOptionalText(state.table.comment)) {
            errors.push('MS Access modify-table does not support table comments.');
        }

        if (normalizeOptionalText(state.table.engine)) {
            errors.push('MS Access modify-table does not support table engine changes.');
        }

        if (normalizeOptionalText(state.table.collation)) {
            errors.push('MS Access modify-table does not support table collation changes.');
        }

        if (normalizeOptionalText(state.table.options)) {
            errors.push('MS Access modify-table does not support table option changes.');
        }

        getActiveColumns(state.columns).forEach((column) => {
            if (normalizeOptionalText(column.comment)) {
                errors.push(`Column ${column.name.trim() || '(unnamed)'} cannot store comments on MS Access.`);
            }

            if (normalizeOptionalText(column.collation)) {
                errors.push(`Column ${column.name.trim() || '(unnamed)'} cannot set collation on MS Access.`);
            }

            if (normalizeOptionalText(column.onUpdate)) {
                errors.push(`Column ${column.name.trim() || '(unnamed)'} cannot use ON UPDATE on MS Access.`);
            }

            if (column.hidden) {
                errors.push(`Column ${column.name.trim() || '(unnamed)'} cannot be hidden on MS Access.`);
            }

            if (normalizeOptionalText(column.columnKind) && normalizeOptionalText(column.columnKind)?.toUpperCase() !== 'NORMAL') {
                errors.push(`Column ${column.name.trim() || '(unnamed)'} cannot use column kind ${column.columnKind} on MS Access.`);
            }
        });
    }

    if (!tableName) {
        errors.push('Table name is required.');
    }

    const hasExistingTableName = state.existingTableNames.some((existingName) => existingName.toLowerCase() === tableName.toLowerCase());

    if (tableName) {
        if (state.mode === 'create' && hasExistingTableName) {
            errors.push(`Table ${tableName} already exists.`);
        }

        if (state.mode === 'edit' && state.tableName && tableName.toLowerCase() !== state.tableName.toLowerCase() && hasExistingTableName) {
            errors.push(`Table ${tableName} already exists.`);
        }
    }

    const activeColumnNames = new Set(activeColumns.map((column) => column.name.trim()).filter((columnName) => columnName.length > 0));
    const activeKeys = getActiveKeys(state.keys);
    const primaryKeys = activeKeys.filter((key) => key.isPrimary);
    const keyNames = new Set<string>();

    if (primaryKeys.length > 1) {
        errors.push('Only one primary key is allowed.');
    }

    activeKeys.forEach((key) => {
        const normalizedName = key.name.trim();

        if (!key.isPrimary && !normalizedName) {
            errors.push('Key name is required.');
        }

        if (!key.columns.length) {
            errors.push(`Key ${normalizedName || 'PRIMARY'} must include at least one column.`);
        }

        key.columns.forEach((column) => {
            if (!column.columnName.trim()) {
                errors.push(`Key ${normalizedName || 'PRIMARY'} has an empty column.`);
                return;
            }

            if (!activeColumnNames.has(column.columnName.trim())) {
                errors.push(`Key ${normalizedName || 'PRIMARY'} references unknown column ${column.columnName.trim()}.`);
            }
        });

        if (!key.isPrimary && normalizedName) {
            const loweredName = normalizedName.toLowerCase();

            if (keyNames.has(loweredName)) {
                errors.push(`Key ${normalizedName} is duplicated.`);
            }

            keyNames.add(loweredName);
        }
    });

    const foreignKeyNames = new Set<string>();

    getActiveForeignKeys(state.foreignKeys).forEach((foreignKey) => {
        const normalizedName = foreignKey.name.trim();

        if (state.driver === 'msaccess' && normalizeOptionalText(foreignKey.match) && normalizeOptionalText(foreignKey.match)?.toUpperCase() !== 'NONE') {
            errors.push(`Foreign key ${normalizedName || '(unnamed)'} cannot use MATCH on MS Access.`);
        }

        if (!normalizedName) {
            errors.push('Foreign key name is required.');
        }

        if (!foreignKey.targetTable.trim()) {
            errors.push(`Foreign key ${normalizedName || '(unnamed)'} requires a target table.`);
        }

        if (!foreignKey.columns.length) {
            errors.push(`Foreign key ${normalizedName || '(unnamed)'} must include at least one column mapping.`);
        }

        foreignKey.columns.forEach((column) => {
            if (!column.columnName.trim() || !column.targetName.trim()) {
                errors.push(`Foreign key ${normalizedName || '(unnamed)'} has an incomplete column mapping.`);
                return;
            }

            if (!activeColumnNames.has(column.columnName.trim())) {
                errors.push(`Foreign key ${normalizedName || '(unnamed)'} references unknown column ${column.columnName.trim()}.`);
            }
        });

        if (normalizedName) {
            const loweredName = normalizedName.toLowerCase();

            if (foreignKeyNames.has(loweredName)) {
                errors.push(`Foreign key ${normalizedName} is duplicated.`);
            }

            foreignKeyNames.add(loweredName);
        }
    });

    const indexNames = new Set<string>();

    getActiveIndexes(state.indexes).forEach((index) => {
        const normalizedName = index.name.trim();

        if (!normalizedName) {
            errors.push('Index name is required.');
        }

        if (!index.columns.length) {
            errors.push(`Index ${normalizedName || '(unnamed)'} must include at least one column.`);
        }

        index.columns.forEach((column) => {
            if (!column.columnName.trim()) {
                errors.push(`Index ${normalizedName || '(unnamed)'} has an empty column.`);
                return;
            }

            if (!activeColumnNames.has(column.columnName.trim())) {
                errors.push(`Index ${normalizedName || '(unnamed)'} references unknown column ${column.columnName.trim()}.`);
            }
        });

        if (normalizedName) {
            const loweredName = normalizedName.toLowerCase();

            if (indexNames.has(loweredName)) {
                errors.push(`Index ${normalizedName} is duplicated.`);
            }

            indexNames.add(loweredName);
        }
    });

    return [...new Set(errors)];
}

function buildPreviewStatements(state: ModifyTablePreviewState) {
    if (state.mode === 'create') {
        return buildCreatePreviewStatements(state);
    }

    if (!state.tableName || !state.driver || !state.currentTableInfo) {
        return [] as string[];
    }

    const validationErrors = getModifyTableValidationErrors(state);

    if (validationErrors.length > 0) {
        return [];
    }

    if (!hasColumnSchemaChanges(state) && !hasExtendedSchemaChanges(state)) {
        return [];
    }

    const activeColumns = getActiveColumns(state.columns);
    const quotedTableName = quoteSqlIdentifier(state.tableName, state.driver);
    const originalColumnsByName = createOriginalColumnsByName(state.originalColumns);
    const droppedColumns = state.originalColumns.filter(
        (column) => !activeColumns.some((activeColumn) => (activeColumn.originalName ?? activeColumn.name) === (column.originalName ?? column.name))
    );

    if (state.driver === 'msaccess') {
        return buildMsAccessPreviewStatements(state);
    }

    if (state.driver === 'sqlite') {
        const sqliteStatements = buildSqlitePreviewSql(state.tableName, state.currentTableInfo, activeColumns);

        if (hasExtendedSchemaChanges(state)) {
            sqliteStatements.unshift('-- Additional table, key, foreign key, or index changes are included in the SQLite table rebuild.');
        }

        return sqliteStatements;
    }

    const statements: string[] = [];

    droppedColumns.forEach((column) => {
        statements.push(`ALTER TABLE ${quotedTableName} DROP COLUMN ${quoteSqlIdentifier(column.name, state.driver!)};`);
    });

    if (state.driver === 'mysql') {
        activeColumns.forEach((column, index) => {
            const originalColumn = column.originalName ? originalColumnsByName.get(column.originalName) : undefined;

            if (!originalColumn) {
                const previousColumn = [...activeColumns]
                    .slice(0, index)
                    .reverse()
                    .find(() => true);
                const placementClause = previousColumn ? ` AFTER ${quoteSqlIdentifier(previousColumn.name, 'mysql')}` : ' FIRST';
                statements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${buildMySqlColumnDefinition(column)}${placementClause};`);
                return;
            }

            const changed =
                column.name !== originalColumn.name ||
                column.type.trim() !== originalColumn.type.trim() ||
                column.notNull !== originalColumn.notNull ||
                normalizeOptionalText(column.defaultValue) !== normalizeOptionalText(originalColumn.defaultValue) ||
                column.isAutoIncrement !== originalColumn.isAutoIncrement ||
                normalizeOptionalText(column.comment) !== normalizeOptionalText(originalColumn.comment) ||
                normalizeOptionalText(column.collation) !== normalizeOptionalText(originalColumn.collation) ||
                normalizeOptionalText(column.onUpdate) !== normalizeOptionalText(originalColumn.onUpdate);

            if (changed) {
                statements.push(`ALTER TABLE ${quotedTableName} CHANGE COLUMN ${quoteSqlIdentifier(originalColumn.name, 'mysql')} ${buildMySqlColumnDefinition(column)};`);
            }
        });

        statements.push(...buildMySqlExtendedPreviewStatements(state));

        return statements;
    }

    activeColumns.forEach((column) => {
        const originalColumn = column.originalName ? originalColumnsByName.get(column.originalName) : undefined;
        const quotedColumnName = quoteSqlIdentifier(column.name, 'postgresql');

        if (!originalColumn) {
            statements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${buildPostgresColumnDefinition(column)};`);

            if (normalizeOptionalText(column.comment)) {
                statements.push(`COMMENT ON COLUMN ${quotedTableName}.${quotedColumnName} IS '${normalizeOptionalText(column.comment)!.replaceAll("'", "''")}';`);
            }

            return;
        }

        if (column.name !== originalColumn.name) {
            statements.push(`ALTER TABLE ${quotedTableName} RENAME COLUMN ${quoteSqlIdentifier(originalColumn.name, 'postgresql')} TO ${quotedColumnName};`);
        }

        if (column.type.trim() !== originalColumn.type.trim()) {
            statements.push(`ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedColumnName} TYPE ${column.type.trim()};`);
        }

        if (normalizeOptionalText(column.defaultValue) !== normalizeOptionalText(originalColumn.defaultValue)) {
            statements.push(
                normalizeOptionalText(column.defaultValue)
                    ? `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedColumnName} SET DEFAULT ${normalizeOptionalText(column.defaultValue)};`
                    : `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedColumnName} DROP DEFAULT;`
            );
        }

        if (column.notNull !== originalColumn.notNull) {
            statements.push(
                column.notNull
                    ? `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedColumnName} SET NOT NULL;`
                    : `ALTER TABLE ${quotedTableName} ALTER COLUMN ${quotedColumnName} DROP NOT NULL;`
            );
        }

        if (normalizeOptionalText(column.comment) !== normalizeOptionalText(originalColumn.comment)) {
            statements.push(
                `COMMENT ON COLUMN ${quotedTableName}.${quotedColumnName} IS ${normalizeOptionalText(column.comment) ? `'${normalizeOptionalText(column.comment)!.replaceAll("'", "''")}'` : 'NULL'};`
            );
        }
    });

    if (state.driver === 'postgresql') {
        statements.push(...buildPostgresExtendedPreviewStatements(state));
    } else if (hasExtendedSchemaChanges(state)) {
        statements.push('-- Additional table, key, foreign key, or index changes will be applied by the backend driver.');
    }

    return statements;
}

function createNewColumn(columns: ModifyTableColumnDraft[], driver: DbType | undefined): ModifyTableColumnDraft {
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

function createUniqueName(existingNames: string[], baseName: string) {
    const normalizedNames = new Set(existingNames.map((name) => name.toLowerCase()));
    let sequence = 1;
    let name = baseName;

    while (normalizedNames.has(name.toLowerCase())) {
        sequence += 1;
        name = `${baseName}_${sequence}`;
    }

    return name;
}

function moveArrayEntry<TItem extends { id: string }>(items: TItem[], item: TItem | undefined, direction: 'up' | 'down') {
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

function createTableDraft(tableName: string, driver: DbType | undefined, tableInfo?: TableInfo): ModifyTableTableDraft {
    return {
        name: tableInfo?.name ?? tableName,
        comment: tableInfo?.comment ?? '',
        engine: tableInfo?.engine ?? (driver === 'mysql' ? 'InnoDB' : ''),
        collation: tableInfo?.collation ?? '',
        options: tableInfo?.options ?? '',
    };
}

function createKeyColumnDraft(columnName: string): ModifyTableKeyColumnDraft {
    return {
        id: `key-column:${crypto.randomUUID()}`,
        columnName,
    };
}

function createForeignKeyColumnDraft(columnName: string, targetName: string): ModifyTableForeignKeyColumnDraft {
    return {
        id: `foreign-key-column:${crypto.randomUUID()}`,
        columnName,
        targetName,
    };
}

function createIndexColumnDraft(columnName: string, order = 'NONE'): ModifyTableIndexColumnDraft {
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

function isPrimaryIndex(index: TableIndexInfo, primaryKeyColumns: string[]) {
    if (index.name.toLowerCase() === 'primary' || index.origin === 'pk') {
        return true;
    }

    return (
        primaryKeyColumns.length > 0 &&
        index.columns.length === primaryKeyColumns.length &&
        index.columns.every((columnName, indexPosition) => columnName === primaryKeyColumns[indexPosition])
    );
}

function createKeyDrafts(tableInfo: TableInfo) {
    const primaryKeyColumns = [...tableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);
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
        .filter((index) => index.isUnique && !isPrimaryIndex(index, primaryKeyColumns))
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

function createForeignKeyDrafts(tableName: string, tableInfo: TableInfo) {
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

function createIndexDrafts(tableInfo: TableInfo): ModifyTableIndexDraft[] {
    const primaryKeyColumns = [...tableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);
    const hasPrimaryIndex = tableInfo.indexes.some((index) => isPrimaryIndex(index, primaryKeyColumns));
    const indexes = tableInfo.indexes.map((index) => ({
        id: `existing:${index.name}`,
        originalName: index.name,
        name: index.name,
        comment: index.comment ?? '',
        isUnique: index.isUnique,
        type: index.type ?? 'btree',
        columns: index.columns.map((columnName, indexPosition) => createIndexColumnDraft(columnName, index.orders?.[indexPosition] ?? 'NONE')),
        status: 'existing' as const,
    }));

    if (!hasPrimaryIndex && primaryKeyColumns.length > 0) {
        indexes.unshift({
            id: 'existing:PRIMARY',
            originalName: 'PRIMARY',
            name: 'PRIMARY',
            comment: '',
            isUnique: true,
            type: '',
            columns: primaryKeyColumns.map((columnName) => createIndexColumnDraft(columnName)),
            status: 'existing',
        });
    }

    return indexes;
}

function createNewKey(keys: ModifyTableKeyDraft[], columnNames: string[]) {
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

function createPrimaryKeyDraft(columnName: string) {
    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name: 'PRIMARY',
        isPrimary: true,
        columns: [createKeyColumnDraft(columnName)],
        status: 'new',
    } satisfies ModifyTableKeyDraft;
}

function createNewForeignKey(foreignKeys: ModifyTableForeignKeyDraft[], columnNames: string[]) {
    const name = createUniqueName(
        foreignKeys.map((foreignKey) => foreignKey.name),
        'new_foreign_key'
    );

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        targetTable: '',
        columns: [createForeignKeyColumnDraft(columnNames[0] ?? '', '')],
        onDelete: 'no_action',
        onUpdate: 'no_action',
        match: 'none',
        status: 'new',
    } satisfies ModifyTableForeignKeyDraft;
}

function createNewIndex(indexes: ModifyTableIndexDraft[], columnNames: string[]) {
    const name = createUniqueName(
        indexes.map((index) => index.name),
        'new_index'
    );

    return {
        id: `new:${crypto.randomUUID()}`,
        originalName: undefined,
        name,
        comment: '',
        isUnique: false,
        type: 'btree',
        columns: [createIndexColumnDraft(columnNames[0] ?? '')],
        status: 'new',
    } satisfies ModifyTableIndexDraft;
}

function cloneModifyTableHistorySnapshot(snapshot: ModifyTableHistorySnapshot) {
    return JSON.parse(JSON.stringify(snapshot)) as ModifyTableHistorySnapshot;
}

export function _useModifyTable() {
    const connections = useConnections();
    const servers = useServers();
    const query = useQuery();
    const undoStack: ModifyTableHistorySnapshot[] = [];
    const redoStack: ModifyTableHistorySnapshot[] = [];
    let currentHistorySnapshot: ModifyTableHistorySnapshot | undefined;
    let suppressHistory = false;

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
            return [
                {
                    id: 'group:columns',
                    title: 'columns',
                    kind: 'columns',
                    items: state.columns.map((column) => ({
                        id: `column:${column.id}`,
                        title: column.name,
                        kind: 'column',
                        rightText: column.status === 'new' ? 'new' : column.status === 'deleted' ? 'removed' : column.type || 'type',
                        status: column.status,
                    })),
                },
                {
                    id: 'group:keys',
                    title: 'keys',
                    kind: 'keys',
                    items: state.keys.map((key) => ({
                        id: `key:${key.id}`,
                        title: key.name,
                        kind: 'key',
                        rightText: `(${key.columns
                            .map((column) => column.columnName)
                            .filter(Boolean)
                            .join(', ')})`,
                        status: key.status,
                    })),
                },
                {
                    id: 'group:foreign-keys',
                    title: 'foreign keys',
                    kind: 'foreign-keys',
                    items: state.foreignKeys.map((foreignKey) => ({
                        id: `foreign-key:${foreignKey.id}`,
                        title: foreignKey.name,
                        kind: 'foreign-key',
                        rightText: `(${foreignKey.columns
                            .map((column) => column.columnName)
                            .filter(Boolean)
                            .join(', ')}) -> ${foreignKey.targetTable || 'target'}`,
                        status: foreignKey.status,
                    })),
                },
                {
                    id: 'group:indexes',
                    title: 'indexes',
                    kind: 'indexes',
                    items: state.indexes.map((index) => ({
                        id: `index:${index.id}`,
                        title: index.name,
                        kind: 'index',
                        rightText: `${index.columns
                            .map((column) => column.columnName)
                            .filter(Boolean)
                            .join(', ')}${index.isUnique ? '  UNIQUE' : index.type ? `  ${index.type}` : ''}`,
                        status: index.status,
                    })),
                },
            ] satisfies ModifyTableNavigationSection[];
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
            return undoStack.length > 0;
        },
        get canRedo() {
            return redoStack.length > 0;
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

            state.open = true;
            state.loading = true;
            state.errorMessage = '';
            state.mode = mode;
            state.connectionId = params.connectionId;
            state.tableName = mode === 'edit' ? params.tableName : undefined;

            try {
                if (mode === 'create') {
                    await Promise.all([connections.ensureConnectionTables(params.connectionId), state.loadCollationOptions(params.connectionId)]);

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
                    const tableInfo = connections.getTableDetailsState(params.connectionId, tableName).info;

                    if (!tableInfo) {
                        throw new Error('Unable to load table details.');
                    }

                    state.currentTableInfo = tableInfo;
                    state.table = createTableDraft(tableInfo.name, state.driver, tableInfo);
                    state.originalColumns = cloneColumns(tableInfo.columns);
                    state.columns = cloneColumns(tableInfo.columns);
                    state.keys = createKeyDrafts(tableInfo);
                    state.foreignKeys = createForeignKeyDrafts(tableInfo.name, tableInfo);
                    state.indexes = createIndexDrafts(tableInfo);
                }

                state.selectedNodeId = 'table';
                state.selectedKeyColumnId = undefined;
                state.selectedForeignKeyColumnId = undefined;
                state.selectedIndexColumnId = undefined;
                state.allowTableRebuild = false;
                resetHistory();
            } catch (error) {
                state.errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
                state.loading = false;
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
            resetHistory();
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
            const foreignKey = createNewForeignKey(state.foreignKeys, state.activeColumnNames);
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
            const index = createNewIndex(state.indexes, state.activeColumnNames);
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
            const previousSnapshot = undoStack.pop();

            if (!previousSnapshot || !currentHistorySnapshot) {
                return;
            }

            redoStack.push(cloneModifyTableHistorySnapshot(currentHistorySnapshot));
            applyHistorySnapshot(previousSnapshot);
        },
        redoChanges() {
            const nextSnapshot = redoStack.pop();

            if (!nextSnapshot || !currentHistorySnapshot) {
                return;
            }

            undoStack.push(cloneModifyTableHistorySnapshot(currentHistorySnapshot));
            applyHistorySnapshot(nextSnapshot);
        },
        async applyChanges() {
            if (!state.connectionId || !state.canApply) {
                return;
            }

            state.applying = true;
            state.errorMessage = '';
            const nextTableName = state.table.name.trim() || state.tableName;

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

                await connections.ensureConnectionTables(state.connectionId, true);
                await connections.ensureTableDetails(state.connectionId, finalTableName, true);

                if (query.selectedTableName === currentTableName && connections.selectedConnectionId === state.connectionId) {
                    query.selectedTableName = finalTableName;
                    await query.loadSelectedTable();
                }

                state.closeModal();
            } catch (error) {
                state.errorMessage = error instanceof Error ? error.message : String(error);
            } finally {
                state.applying = false;
            }
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

    function captureHistorySnapshot(): ModifyTableHistorySnapshot {
        return cloneModifyTableHistorySnapshot({
            allowTableRebuild: state.allowTableRebuild,
            table: state.table,
            columns: state.columns,
            keys: state.keys,
            foreignKeys: state.foreignKeys,
            indexes: state.indexes,
            selectedNodeId: state.selectedNodeId ?? null,
            selectedKeyColumnId: state.selectedKeyColumnId ?? null,
            selectedForeignKeyColumnId: state.selectedForeignKeyColumnId ?? null,
            selectedIndexColumnId: state.selectedIndexColumnId ?? null,
        });
    }

    function resetHistory() {
        undoStack.length = 0;
        redoStack.length = 0;
        currentHistorySnapshot = state.open && !state.loading ? captureHistorySnapshot() : undefined;
    }

    function applyHistorySnapshot(snapshot: ModifyTableHistorySnapshot) {
        suppressHistory = true;
        state.allowTableRebuild = snapshot.allowTableRebuild;
        state.table = cloneModifyTableHistorySnapshot({
            ...snapshot,
            table: snapshot.table,
            columns: [],
            keys: [],
            foreignKeys: [],
            indexes: [],
            selectedNodeId: null,
            selectedKeyColumnId: null,
            selectedForeignKeyColumnId: null,
            selectedIndexColumnId: null,
            allowTableRebuild: snapshot.allowTableRebuild,
        }).table;
        state.columns = cloneModifyTableHistorySnapshot(snapshot).columns;
        state.keys = cloneModifyTableHistorySnapshot(snapshot).keys;
        state.foreignKeys = cloneModifyTableHistorySnapshot(snapshot).foreignKeys;
        state.indexes = cloneModifyTableHistorySnapshot(snapshot).indexes;
        state.selectedNodeId = snapshot.selectedNodeId ?? undefined;
        state.selectedKeyColumnId = snapshot.selectedKeyColumnId ?? undefined;
        state.selectedForeignKeyColumnId = snapshot.selectedForeignKeyColumnId ?? undefined;
        state.selectedIndexColumnId = snapshot.selectedIndexColumnId ?? undefined;
        currentHistorySnapshot = cloneModifyTableHistorySnapshot(snapshot);
        suppressHistory = false;
    }

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
            open: state.open,
            loading: state.loading,
            allowTableRebuild: state.allowTableRebuild,
            table: state.table,
            columns: state.columns,
            keys: state.keys,
            foreignKeys: state.foreignKeys,
            indexes: state.indexes,
            selectedNodeId: state.selectedNodeId ?? null,
            selectedKeyColumnId: state.selectedKeyColumnId ?? null,
            selectedForeignKeyColumnId: state.selectedForeignKeyColumnId ?? null,
            selectedIndexColumnId: state.selectedIndexColumnId ?? null,
        }),
        () => {
            if (suppressHistory || !state.open || state.loading) {
                return;
            }

            const nextSnapshot = captureHistorySnapshot();

            if (!currentHistorySnapshot) {
                currentHistorySnapshot = nextSnapshot;
                undoStack.length = 0;
                redoStack.length = 0;
                return;
            }

            if (JSON.stringify(nextSnapshot) === JSON.stringify(currentHistorySnapshot)) {
                return;
            }

            undoStack.push(cloneModifyTableHistorySnapshot(currentHistorySnapshot));
            currentHistorySnapshot = nextSnapshot;
            redoStack.length = 0;
        },
        { deep: true }
    );

    return state;
}

let modifyTableSingleton: ReturnType<typeof _useModifyTable> | undefined;

export function useModifyTable() {
    modifyTableSingleton ??= _useModifyTable();
    return modifyTableSingleton;
}
