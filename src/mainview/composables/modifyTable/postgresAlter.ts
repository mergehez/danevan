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

export function buildPostgresExtendedPreviewStatements(state: ModifyTablePreviewState) {
    if (!state.tableName || !state.currentTableInfo) {
        return [] as string[];
    }

    const currentInfo = state.currentTableInfo;
    const quotedTableName = quoteSqlIdentifier(state.tableName, 'postgresql');
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
