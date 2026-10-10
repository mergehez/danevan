/**
 * MySQL ALTER generation for the modify-table plan. Pure statement builders: the TypeORM
 * memory-sql parts (drop/add primary key, foreign keys, rename) stay in the driver, everything
 * that is plain text lives here so it can be asserted without a server.
 */
import type { TableInfo } from '../shared/types';
import type { ModifySchemaColumn, ModifySchemaIndex, ModifySchemaPlan, ModifySchemaTable } from './useSqliteDriver.ts';
import {
    buildDropColumnStatements,
    buildIndexColumns,
    getCurrentPrimaryKey,
    getCurrentUniqueKeys,
    getDroppedColumns,
    keySignature,
    serializeColumns,
    serializeIndexColumns,
} from './remoteTableDdl.ts';

export type MySqlTableDdlDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    quoteIdentifier: (identifier: string) => string;
};

/** MySQL compares an index including its comment; PostgreSQL has no index comments to compare. */
export function indexSignature(index: ModifySchemaIndex) {
    return [serializeIndexColumns(index.columns), index.isUnique ? '1' : '0', (index.type ?? '').toLowerCase(), (index.comment ?? '').toLowerCase()].join('::');
}

/** Indexes the plan asks for, minus the ones carried by a key (and the primary key name). */
export function getDesiredStandaloneIndexes(plan: ModifySchemaPlan) {
    const excludedNames = new Set(plan.keys.map((key) => key.name.toLowerCase()));
    excludedNames.add('primary');

    return plan.indexes.filter((index) => !excludedNames.has(index.name.toLowerCase()));
}

export function getCurrentStandaloneIndexes(currentInfo: TableInfo) {
    const primarySignature = keySignature(getCurrentPrimaryKey(currentInfo));

    return currentInfo.indexes
        .filter((index) => !(index.isUnique && serializeColumns(index.columns) !== primarySignature))
        .filter((index) => serializeColumns(index.columns) !== primarySignature)
        .map((index) => ({
            name: index.name,
            comment: index.comment ?? null,
            isUnique: index.isUnique,
            type: index.type ?? null,
            columns: index.columns.map((columnName, indexPosition) => ({
                columnName,
                order: index.orders?.[indexPosition] ?? null,
            })),
        })) satisfies ModifySchemaIndex[];
}

/** Table-level options MySQL keeps outside the columns: comment, engine, collation, extras. */
export function buildTableOptionStatements(deps: MySqlTableDdlDeps, tableName: string, currentInfo: TableInfo, table: ModifySchemaTable) {
    const quotedTableName = deps.quoteIdentifier(tableName);
    const statements: string[] = [];

    if ((table.comment ?? '') !== (currentInfo.comment ?? '')) {
        statements.push(`ALTER TABLE ${quotedTableName} COMMENT = ${deps.escapeSqlString(table.comment ?? '')};`);
    }

    if (table.engine && table.engine !== currentInfo.engine) {
        statements.push(`ALTER TABLE ${quotedTableName} ENGINE = ${table.engine};`);
    }

    if (table.collation && table.collation !== currentInfo.collation) {
        statements.push(`ALTER TABLE ${quotedTableName} COLLATE = ${table.collation};`);
    }

    if (table.options && table.options !== currentInfo.options) {
        statements.push(`ALTER TABLE ${quotedTableName} ${table.options};`);
    }

    return statements;
}

export function buildDropForeignKeyStatement(deps: MySqlTableDdlDeps, tableName: string, foreignKeyName: string) {
    return `ALTER TABLE ${deps.quoteIdentifier(tableName)} DROP FOREIGN KEY ${deps.quoteIdentifier(foreignKeyName)};`;
}

/** The `ADD COLUMN` / `CHANGE COLUMN` batch, with the column order the statements leave behind. */
export function buildColumnChangeStatements(deps: MySqlTableDdlDeps, tableName: string, currentInfo: TableInfo, nextColumns: ModifySchemaColumn[]) {
    const quotedTableName = deps.quoteIdentifier(tableName);
    const currentColumnsByName = new Map(currentInfo.columns.map((column) => [column.name, column]));
    const statements: string[] = [];

    // Column order the emitted statements leave behind, kept in step with them so a
    // column that moves twice in one batch is still detected and anchored correctly.
    const droppedColumnNames = new Set(getDroppedColumns(currentInfo, nextColumns).map((column) => column.name));
    const simulatedOrder = currentInfo.columns.filter((column) => !droppedColumnNames.has(column.name)).map((column) => column.name);

    nextColumns.forEach((column, index) => {
        const currentColumn = column.originalName ? currentColumnsByName.get(column.originalName) : undefined;
        const definitionParts = [deps.quoteIdentifier(column.name), column.type];

        definitionParts.push(column.notNull ? 'NOT NULL' : 'NULL');

        if (column.defaultValue) {
            definitionParts.push(`DEFAULT ${column.defaultValue}`);
        } else if (!column.notNull && !column.isAutoIncrement) {
            definitionParts.push('DEFAULT NULL');
        }

        if (column.isAutoIncrement) {
            definitionParts.push('AUTO_INCREMENT');
        }

        if (column.onUpdate) {
            definitionParts.push(`ON UPDATE ${column.onUpdate}`);
        }

        if (column.collation) {
            definitionParts.push(`COLLATE ${column.collation}`);
        }

        definitionParts.push(`COMMENT ${deps.escapeSqlString(column.comment ?? '')}`);
        const definition = definitionParts.join(' ');
        const previousDesiredColumn = index > 0 ? nextColumns[index - 1] : undefined;
        const placementClause = previousDesiredColumn ? ` AFTER ${deps.quoteIdentifier(previousDesiredColumn.name)}` : ' FIRST';

        if (!currentColumn) {
            statements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${definition}${placementClause};`);
            simulatedOrder.splice(index, 0, column.name);
            return;
        }

        const metadataChanged =
            column.name !== currentColumn.name ||
            column.type !== currentColumn.type ||
            column.notNull !== currentColumn.notNull ||
            column.defaultValue !== deps.normalizeOptionalText(currentColumn.defaultValue) ||
            column.isAutoIncrement !== currentColumn.isAutoIncrement ||
            column.comment !== deps.normalizeOptionalText(currentColumn.comment) ||
            column.collation !== deps.normalizeOptionalText(currentColumn.collation) ||
            column.onUpdate !== deps.normalizeOptionalText(currentColumn.onUpdate);
        const positionChanged = simulatedOrder[index] !== currentColumn.name;

        if (metadataChanged || positionChanged) {
            statements.push(`ALTER TABLE ${quotedTableName} CHANGE COLUMN ${deps.quoteIdentifier(currentColumn.name)} ${definition}${placementClause};`);
        }

        if (positionChanged) {
            simulatedOrder.splice(simulatedOrder.indexOf(currentColumn.name), 1);
            simulatedOrder.splice(index, 0, currentColumn.name);
        }
    });

    return statements;
}

/** Every ALTER statement the plan needs that does not go through TypeORM's memory sql. */
export function buildAlterStatements(deps: MySqlTableDdlDeps, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const quotedTableName = deps.quoteIdentifier(tableName);
    const currentUniqueKeys = getCurrentUniqueKeys(currentInfo);
    const desiredUniqueKeys = nextPlan.keys.filter((key) => !key.isPrimary);
    const desiredStandaloneIndexes = getDesiredStandaloneIndexes(nextPlan);
    const currentStandaloneIndexes = getCurrentStandaloneIndexes(currentInfo);
    const statements: string[] = [];

    currentUniqueKeys.forEach((key) => {
        const desiredKey = desiredUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!desiredKey || keySignature(key) !== keySignature(desiredKey)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${deps.quoteIdentifier(key.name)};`);
        }
    });

    currentStandaloneIndexes.forEach((index) => {
        const desiredIndex = desiredStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!desiredIndex || indexSignature(index) !== indexSignature(desiredIndex)) {
            statements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${deps.quoteIdentifier(index.name)};`);
        }
    });

    statements.push(...buildDropColumnStatements(deps.quoteIdentifier, tableName, currentInfo, nextPlan.columns));
    statements.push(...buildColumnChangeStatements(deps, tableName, currentInfo, nextPlan.columns));

    desiredUniqueKeys.forEach((key) => {
        const currentKey = currentUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

        if (!currentKey || keySignature(currentKey) !== keySignature(key)) {
            statements.push(
                `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${deps.quoteIdentifier(key.name)} UNIQUE (${key.columns.map((column) => deps.quoteIdentifier(column.columnName)).join(', ')});`
            );
        }
    });

    desiredStandaloneIndexes.forEach((index) => {
        const currentIndex = currentStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

        if (!currentIndex || indexSignature(currentIndex) !== indexSignature(index)) {
            const clauses = [
                `ALTER TABLE ${quotedTableName} ADD ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${deps.quoteIdentifier(index.name)}`,
                `(${buildIndexColumns(deps.quoteIdentifier, index.columns)})`,
            ];

            if (index.type) {
                clauses.push(`USING ${index.type}`);
            }

            if (index.comment) {
                clauses.push(`COMMENT ${deps.escapeSqlString(index.comment)}`);
            }

            statements.push(`${clauses.join(' ')};`);
        }
    });

    return statements;
}
