import { quoteSqlIdentifier } from '../../../shared/utils/sqlIdentifiers';
import { buildMsAccessColumnDefinition, buildMsAccessForeignKeyActionClause, getMsAccessPrimaryKeyConstraintName } from './columnDdl';
import {
    createForeignKeyDrafts,
    createIndexDrafts,
    createKeyDrafts,
    getActiveColumns,
    getActiveForeignKeys,
    getPrimaryKeyDraft,
    getStandaloneIndexDrafts,
    getUniqueKeyDrafts,
} from './drafts';
import type { ModifyTablePreviewState } from './types';
import { getMsAccessExplicitPlanErrors } from './validation';

export function buildMsAccessPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    if (state.allowTableRebuild && getMsAccessExplicitPlanErrors(state).length > 0) {
        return buildMsAccessRebuildPreviewStatements(state);
    }

    const currentTableName = state.tableName;
    const nextTableName = state.table.name.trim() || currentTableName;
    const activeColumns = getActiveColumns(state.columns);
    const currentKeys = createKeyDrafts(state.currentTableInfo, state.driver);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(createIndexDrafts(state.currentTableInfo, state.driver), currentKeys);
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

export function buildMsAccessRebuildPreviewStatements(state: ModifyTablePreviewState) {
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
