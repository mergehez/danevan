import { quoteSqlIdentifier } from '../../../shared/utils/sqlIdentifiers';
import type { TableForeignKeyInfo } from '../../../shared/types';
import { buildMySqlColumnDefinition, buildPostgresColumnDefinition } from './columnDdl';
import { buildCreatePreviewStatements, buildSqlitePreviewSql } from './createPreview';
import {
    buildForeignKeySignature,
    buildIndexSignature,
    buildKeySignature,
    createIndexDrafts,
    createKeyDrafts,
    createOriginalColumnsByName,
    getActiveColumns,
    getActiveForeignKeys,
    getActiveIndexes,
    getActiveKeys,
    normalizeOptionalText,
} from './drafts';
import { buildMsAccessPreviewStatements } from './msAccessAlter';
import { buildMySqlExtendedPreviewStatements } from './mysqlAlter';
import { buildPostgresExtendedPreviewStatements } from './postgresAlter';
import type { ModifyTablePreviewState } from './types';
import { getModifyTableValidationErrors } from './validation';

export function hasExtendedSchemaChanges(state: ModifyTablePreviewState) {
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

    const currentKeys = getActiveKeys(createKeyDrafts(currentTableInfo, state.driver))
        .map((key) => buildKeySignature(key))
        .sort();
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

    // The drafts the dialog opened with are the baseline: the catalog alone would report the
    // primary key MySQL hides from `statistics` (and the one synthesized for it) as a difference.
    const currentIndexes = getActiveIndexes(createIndexDrafts(currentTableInfo, state.driver)).map((index) => buildIndexSignature(index));
    const nextIndexes = getActiveIndexes(state.indexes).map((index) => buildIndexSignature(index));

    return currentIndexes.sort().join('\n') !== nextIndexes.sort().join('\n');
}

export function hasColumnSchemaChanges(state: ModifyTablePreviewState) {
    const activeColumns = getActiveColumns(state.columns);
    const originalColumnsByName = createOriginalColumnsByName(state.originalColumns);

    if (activeColumns.length !== state.originalColumns.length) {
        return true;
    }

    // A pure reorder of existing columns (with no metadata change) still counts
    // as a schema change. Compare the order of the existing columns.
    const originalOrder = state.originalColumns.map((column) => column.originalName ?? column.name);
    const activeOrder = activeColumns.map((column) => column.originalName ?? column.name);
    if (!originalOrder.every((name, index) => name === activeOrder[index])) {
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

export function buildPreviewStatements(state: ModifyTablePreviewState) {
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
        const sqliteStatements = buildSqlitePreviewSql(state.tableName, state.currentTableInfo, activeColumns, state.keys, state.foreignKeys, state.indexes);

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
        // Column order the listed statements leave behind, kept in step with them so a
        // column that moves twice in one batch is still detected and anchored correctly.
        const droppedColumnNames = new Set(droppedColumns.map((column) => column.originalName ?? column.name));
        const simulatedOrder = state.originalColumns
            .filter((column) => !droppedColumnNames.has(column.originalName ?? column.name))
            .map((column) => column.originalName ?? column.name);

        activeColumns.forEach((column, index) => {
            const originalColumn = column.originalName ? originalColumnsByName.get(column.originalName) : undefined;
            const previousDesiredColumn = index > 0 ? activeColumns[index - 1] : undefined;
            const placementClause = previousDesiredColumn ? ` AFTER ${quoteSqlIdentifier(previousDesiredColumn.name, 'mysql')}` : ' FIRST';

            if (!originalColumn) {
                statements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${buildMySqlColumnDefinition(column)}${placementClause};`);
                simulatedOrder.splice(index, 0, column.name);
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

            const positionChanged = simulatedOrder[index] !== originalColumn.name;

            if (changed || positionChanged) {
                statements.push(
                    `ALTER TABLE ${quotedTableName} CHANGE COLUMN ${quoteSqlIdentifier(originalColumn.name, 'mysql')} ${buildMySqlColumnDefinition(column)}${placementClause};`
                );
            }

            if (positionChanged) {
                simulatedOrder.splice(simulatedOrder.indexOf(originalColumn.name), 1);
                simulatedOrder.splice(index, 0, originalColumn.name);
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
