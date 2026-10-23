import { quoteSqlIdentifier } from '../../../shared/utils/sqlIdentifiers';
import {
    buildForeignKeySignature,
    buildIndexSignature,
    buildKeySignature,
    buildPreviewIndexColumns,
    createForeignKeyDrafts,
    createIndexDrafts,
    createKeyDrafts,
    escapePreviewSqlString,
    getActiveForeignKeys,
    getPrimaryKeyDraft,
    getStandaloneIndexDrafts,
    getUniqueKeyDrafts,
    normalizeOptionalText,
} from './drafts';
import type { ModifyTablePreviewState } from './types';

export function buildMySqlTableOptionPreviewStatements(state: ModifyTablePreviewState) {
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

export function buildMySqlExtendedPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentInfo = state.currentTableInfo;
    const quotedTableName = quoteSqlIdentifier(state.tableName, 'mysql');
    const currentKeys = createKeyDrafts(currentInfo, state.driver);
    const currentIndexes = createIndexDrafts(currentInfo, state.driver);
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
