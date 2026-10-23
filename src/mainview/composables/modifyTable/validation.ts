import type { DbType } from '../../../shared/types';
import {
    buildForeignKeySignature,
    buildIndexSignature,
    buildKeySignature,
    buildMsAccessColumnSignature,
    createColumnDraft,
    createForeignKeyDrafts,
    createIndexDrafts,
    createKeyDrafts,
    createOriginalColumnsByName,
    getActiveColumns,
    getActiveForeignKeys,
    getActiveIndexes,
    getActiveKeys,
    getPrimaryKeyDraft,
    getStandaloneIndexDrafts,
    getUniqueKeyDrafts,
    normalizeOptionalText,
} from './drafts';
import type { ModifyTableColumnDraft, ModifyTablePreviewState } from './types';

export function getColumnValidationErrors(columns: ModifyTableColumnDraft[], driver: DbType | undefined, originalColumns: ModifyTableColumnDraft[]) {
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

export function getMsAccessExplicitPlanErrors(state: ModifyTablePreviewState) {
    if (!state.currentTableInfo || !state.tableName) {
        return [] as string[];
    }

    const activeColumns = getActiveColumns(state.columns);
    const currentColumns = state.currentTableInfo.columns;
    const currentKeys = createKeyDrafts(state.currentTableInfo, state.driver);
    const currentPrimaryKey = getPrimaryKeyDraft(currentKeys);
    const desiredPrimaryKey = getPrimaryKeyDraft(state.keys);
    const currentUniqueKeys = getUniqueKeyDrafts(currentKeys);
    const currentStandaloneIndexes = getStandaloneIndexDrafts(createIndexDrafts(state.currentTableInfo, state.driver), currentKeys);
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

export function getModifyTableValidationErrors(state: ModifyTablePreviewState) {
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
