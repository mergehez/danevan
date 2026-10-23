import { quoteSqlIdentifier } from '../../../shared/utils/sqlIdentifiers';
import type { TableInfo } from '../../../shared/types';
import {
    buildMsAccessColumnDefinition,
    buildMsAccessForeignKeyActionClause,
    buildMySqlColumnDefinition,
    buildPostgresColumnDefinition,
    buildSqliteColumnDefinition,
    getMsAccessPrimaryKeyConstraintName,
} from './columnDdl';
import {
    buildPreviewIndexColumns,
    escapePreviewSqlString,
    getActiveColumns,
    getActiveForeignKeys,
    getPrimaryKeyDraft,
    getStandaloneIndexDrafts,
    getUniqueKeyDrafts,
    normalizeOptionalText,
} from './drafts';
import type { ModifyTableColumnDraft, ModifyTableForeignKeyDraft, ModifyTableIndexDraft, ModifyTableKeyDraft, ModifyTablePreviewState } from './types';
import { getModifyTableValidationErrors } from './validation';

export function buildSqlitePreviewSql(
    tableName: string,
    tableInfo: TableInfo,
    nextColumns: ModifyTableColumnDraft[],
    keys: ModifyTableKeyDraft[],
    foreignKeys: ModifyTableForeignKeyDraft[],
    indexes: ModifyTableIndexDraft[]
) {
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

    // The rebuild is driven by the drafts, not by the catalog: a key or index the user deleted must
    // disappear from the table being created, and an added one must appear in it.
    getUniqueKeyDrafts(keys)
        .map((key) => key.columns.map((column) => renamedColumns.get(column.columnName) ?? column.columnName))
        .filter((columnNames) => columnNames.length > 0 && columnNames.every((columnName) => nextColumnNames.has(columnName)))
        .forEach((columnNames) => {
            createParts.push(`UNIQUE (${columnNames.map((columnName) => quoteSqlIdentifier(columnName, 'sqlite')).join(', ')})`);
        });

    getActiveForeignKeys(foreignKeys).forEach((foreignKey) => {
        const mappedFromColumns = foreignKey.columns.map((column) => renamedColumns.get(column.columnName) ?? column.columnName);

        if (!mappedFromColumns.every((columnName) => nextColumnNames.has(columnName))) {
            return;
        }

        const parts = [
            `FOREIGN KEY (${mappedFromColumns.map((columnName) => quoteSqlIdentifier(columnName, 'sqlite')).join(', ')})`,
            `REFERENCES ${quoteSqlIdentifier(foreignKey.targetTable, 'sqlite')} (${foreignKey.columns.map((column) => quoteSqlIdentifier(column.targetName, 'sqlite')).join(', ')})`,
        ];
        const onUpdate = normalizeOptionalText(foreignKey.onUpdate)?.replaceAll('_', ' ').toUpperCase();
        const onDelete = normalizeOptionalText(foreignKey.onDelete)?.replaceAll('_', ' ').toUpperCase();

        if (onUpdate && onUpdate !== 'NO ACTION') {
            parts.push(`ON UPDATE ${onUpdate}`);
        }

        if (onDelete && onDelete !== 'NO ACTION') {
            parts.push(`ON DELETE ${onDelete}`);
        }

        createParts.push(parts.join(' '));
    });

    const tempTableName = `${tableName}__modified`;
    const transferableColumns = nextColumns.filter((column) => column.originalName && tableInfo.columns.some((entry) => entry.name === column.originalName));
    const statements = ['PRAGMA foreign_keys = OFF;', 'BEGIN IMMEDIATE;'];
    // The rebuild renames nothing by itself: SQLite has to do it, which is what makes the child
    // foreign keys and the views that name the column follow along.
    nextColumns
        .filter((column) => column.originalName && column.originalName !== column.name && tableInfo.columns.some((entry) => entry.name === column.originalName))
        .forEach((column) => {
            statements.push(
                `ALTER TABLE ${quoteSqlIdentifier(tableName, 'sqlite')} RENAME COLUMN ${quoteSqlIdentifier(column.originalName!, 'sqlite')} TO ${quoteSqlIdentifier(column.name, 'sqlite')};`
            );
        });
    statements.push(`CREATE TABLE ${quoteSqlIdentifier(tempTableName, 'sqlite')} (\n    ${createParts.join(',\n    ')}\n);`);

    if (transferableColumns.length > 0) {
        statements.push(
            `INSERT INTO ${quoteSqlIdentifier(tempTableName, 'sqlite')} (${transferableColumns
                .map((column) => quoteSqlIdentifier(column.name, 'sqlite'))
                .join(', ')}) SELECT ${transferableColumns.map((column) => quoteSqlIdentifier(column.name, 'sqlite')).join(', ')} FROM ${quoteSqlIdentifier(tableName, 'sqlite')};`
        );
    }

    statements.push(`DROP TABLE ${quoteSqlIdentifier(tableName, 'sqlite')};`);
    statements.push(`ALTER TABLE ${quoteSqlIdentifier(tempTableName, 'sqlite')} RENAME TO ${quoteSqlIdentifier(tableName, 'sqlite')};`);

    getStandaloneIndexDrafts(indexes, keys).forEach((index) => {
        const mappedColumns = index.columns.map((column) => renamedColumns.get(column.columnName) ?? column.columnName);

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

export function buildCreateMySqlPreviewStatements(state: ModifyTablePreviewState) {
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

export function buildCreatePostgresPreviewStatements(state: ModifyTablePreviewState) {
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

export function buildCreateSqlitePreviewStatements(state: ModifyTablePreviewState) {
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

export function buildCreateMsAccessPreviewStatements(state: ModifyTablePreviewState) {
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

export function buildCreatePreviewStatements(state: ModifyTablePreviewState) {
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
