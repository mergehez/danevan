import { executeTextCommand } from '@backend/bunSubprocess.ts';
import type { DriverTools, NormalizedApplyTableChanges } from '@backend/db-tools.ts';
import { MS_ACCESS_BRIDGE_SOURCE } from '@backend/msAccessBridgeSource.ts';
import {
    getMsAccessRuntimeJarName,
    getMsAccessRuntimeJarUrl,
    getMsAccessRuntimePlatformJreFolderName,
    MS_ACCESS_RUNTIME_BRIDGE_FILE_NAME,
    MS_ACCESS_RUNTIME_FOLDER_NAME,
    MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_LIB_FOLDER_NAME,
    MS_ACCESS_RUNTIME_SUPPORTED_JRE_PLATFORMS,
    msAccessRuntimeArtifacts,
} from '@backend/msAccessRuntimeManifest.ts';
import type { ModifySchemaColumn, ModifySchemaKey, ModifySchemaPlan } from '@backend/useSqliteDriver.ts';
import type {
    ApplyTableChangesResult,
    MsAccessRuntimeStatus,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlValue,
    TableData,
    TableInfo,
    TableSummary,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '@utils/appClient';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';

export type MsAccessConnectionRecord = {
    id: number;
    server_id: number;
    name: string;
    database_name?: string | null;
};

export type MsAccessServerRecord = {
    driver: string;
    kind: string;
    file_path?: string | null;
    name: string;
};

type MsAccessDriverToolsDeps = {
    getConnection: (connectionId: number) => MsAccessConnectionRecord | undefined;
    getServer: (serverId: number) => MsAccessServerRecord | undefined;
    listConnections: (serverId: number) => MsAccessConnectionRecord[];
    getUserDataDir: () => string;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
};

type MsAccessRuntime = {
    javaCommand: string;
    classPath: string;
    bridgeLaunchArgs: string[];
    runtimeDir: string;
};

type BundledMsAccessRuntime = {
    rootDir: string;
    libDir: string;
    javaCommand?: string;
};

type MsAccessWorkerResponse<T> = {
    ok?: unknown;
    result?: T;
    error?: unknown;
};

type PendingMsAccessWorkerRequest = {
    op: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
};

type MsAccessReferencingForeignKey = {
    name?: string;
    table?: string;
    from?: string;
    to?: string;
};

type MsAccessWorker = {
    key: string;
    child: ReturnType<typeof Bun.spawn>;
    stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
    stderrPromise: Promise<string>;
    responseBuffer: string;
    activeRequest?: PendingMsAccessWorkerRequest;
    requestChain: Promise<void>;
    closed: boolean;
    exitedPromise: Promise<void>;
};

function logMsAccessPerf(label: string, startedAt: number, details?: Record<string, unknown>) {
    const durationMs = Math.round(performance.now() - startedAt);
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    console.log(`[perf][msaccess] ${label} ${durationMs}ms${suffix}`);
}

const runtimeInitPromises = new Map<string, Promise<MsAccessRuntime>>();
const workerInitPromises = new Map<string, Promise<MsAccessWorker>>();
const MS_ACCESS_BRIDGE_CLASS_NAME = 'MsAccessBridge';

function encodeBase64Utf8(value: string) {
    return Buffer.from(value, 'utf8').toString('base64');
}

function encodeSqlValue(value: SqlValue) {
    if (value == null) {
        return 'null:';
    }

    if (typeof value === 'bigint') {
        return `bigint:${value.toString()}`;
    }

    if (typeof value === 'number') {
        return `number:${Number.isFinite(value) ? value.toString() : '0'}`;
    }

    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return `bytes:${Buffer.from(value).toString('base64')}`;
    }

    return `string:${encodeBase64Utf8(String(value))}`;
}

function decodeQueryRows(rows: unknown): Array<Record<string, SqlValue>> {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map((row) => {
        if (!row || typeof row !== 'object') {
            return {} as Record<string, SqlValue>;
        }

        return Object.fromEntries(
            Object.entries(row).map(([key, value]) => {
                if (typeof value === 'boolean') {
                    return [key, value ? 1 : 0];
                }

                return [key, value as SqlValue];
            })
        ) as Record<string, SqlValue>;
    });
}

function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function quoteMsAccessIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `[${part.replaceAll(']', ']]')}]`)
        .join('.');
}

function buildPrimaryKeyFromColumns(columns: ModifySchemaColumn[]) {
    const primaryColumns = [...columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER));

    if (primaryColumns.length === 0) {
        return undefined;
    }

    return {
        name: 'PRIMARY',
        isPrimary: true,
        columns: primaryColumns.map((column) => ({ columnName: column.name })),
    } satisfies ModifySchemaKey;
}

function getDesiredPrimaryKey(nextPlan: ModifySchemaPlan) {
    return nextPlan.keys.find((key) => key.isPrimary) ?? buildPrimaryKeyFromColumns(nextPlan.columns);
}

function getMsAccessUniqueKeys(nextPlan: ModifySchemaPlan) {
    return nextPlan.keys.filter((key) => !key.isPrimary);
}

function isMsAccessPrimaryBackingIndex(index: { name: string; columns: Array<{ columnName: string }> }, primaryKeyColumns: Array<{ columnName: string }> | undefined) {
    if (index.name.trim().toLowerCase() === 'primary') {
        return true;
    }

    return (
        !!primaryKeyColumns &&
        primaryKeyColumns.length > 0 &&
        index.columns.length === primaryKeyColumns.length &&
        index.columns.every((column, indexPosition) => column.columnName === primaryKeyColumns[indexPosition]?.columnName)
    );
}

function getMsAccessStandaloneIndexes(nextPlan: ModifySchemaPlan) {
    const primaryKeyColumns = getDesiredPrimaryKey(nextPlan)?.columns;
    const excludedNames = new Set(nextPlan.keys.map((key) => key.name.toLowerCase()));
    excludedNames.add('primary');
    return nextPlan.indexes.filter((index) => !excludedNames.has(index.name.toLowerCase()) && !isMsAccessPrimaryBackingIndex(index, primaryKeyColumns));
}

function getMsAccessPrimaryKeyConstraintName(primaryKey: ModifySchemaKey | undefined) {
    const normalizedName = primaryKey?.name.trim();

    if (!normalizedName || normalizedName.toLowerCase() === 'primary') {
        return 'PKEY';
    }

    return normalizedName;
}

function buildMsAccessColumnDefinition(column: ModifySchemaColumn, primaryKeyConstraintName?: string) {
    const parts = [quoteMsAccessIdentifier(column.name), column.isAutoIncrement ? 'AUTOINCREMENT' : column.type.trim()];

    if (column.isAutoIncrement && primaryKeyConstraintName) {
        parts.push(`CONSTRAINT ${quoteMsAccessIdentifier(primaryKeyConstraintName)} PRIMARY KEY`);
    }

    if (!column.isAutoIncrement && column.notNull) {
        parts.push('NOT NULL');
    }

    if (normalizeOptionalText(column.defaultValue)) {
        parts.push(`DEFAULT ${normalizeOptionalText(column.defaultValue)}`);
    }

    return parts.join(' ');
}

function buildMsAccessForeignKeyActionClause(kind: 'update' | 'delete', action: string | null | undefined) {
    const normalizedAction = normalizeOptionalText(action)?.replaceAll('_', ' ').toUpperCase();

    if (!normalizedAction || normalizedAction === 'NO ACTION' || normalizedAction === 'RESTRICT') {
        return undefined;
    }

    if (normalizedAction === 'CASCADE' || normalizedAction === 'SET NULL' || normalizedAction === 'SET DEFAULT') {
        return `ON ${kind.toUpperCase()} ${normalizedAction}`;
    }

    throw new Error(`MS Access does not support foreign key action ${normalizedAction}.`);
}

function buildMsAccessColumnSignature(column: Pick<ModifySchemaColumn, 'name' | 'type' | 'notNull' | 'defaultValue' | 'isPrimaryKey' | 'primaryKeyOrdinal' | 'isAutoIncrement'>) {
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

function buildMsAccessCreateStatementsFromTableInfo(tableName: string, tableInfo: TableInfo) {
    const primaryColumns = [...tableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => ({ columnName: column.name }));
    const primaryKey = primaryColumns.length
        ? ({
              name: 'PRIMARY',
              isPrimary: true,
              columns: primaryColumns,
          } satisfies ModifySchemaKey)
        : undefined;
    const primaryKeyConstraintName = getMsAccessPrimaryKeyConstraintName(primaryKey);
    const inlineAutoIncrementPrimaryKey = tableInfo.columns.find((column) => column.isAutoIncrement && column.isPrimaryKey);
    const statements = [
        `CREATE TABLE ${quoteMsAccessIdentifier(tableName)} (${tableInfo.columns.map((column) => buildMsAccessColumnDefinition(column, column.name === inlineAutoIncrementPrimaryKey?.name ? primaryKeyConstraintName : undefined)).join(', ')});`,
    ];

    if (primaryKey?.columns.length && !inlineAutoIncrementPrimaryKey) {
        statements.push(
            `ALTER TABLE ${quoteMsAccessIdentifier(tableName)} ADD CONSTRAINT ${quoteMsAccessIdentifier(primaryKeyConstraintName)} PRIMARY KEY (${primaryKey.columns.map((column) => quoteMsAccessIdentifier(column.columnName)).join(', ')});`
        );
    }

    const primaryKeySignature = primaryKey ? primaryKey.columns.map((column) => column.columnName.toLowerCase()).join('|') : '';

    tableInfo.indexes.forEach((index) => {
        const indexSignature = index.columns.map((columnName) => columnName.toLowerCase()).join('|');

        if (primaryKeySignature && indexSignature === primaryKeySignature) {
            return;
        }

        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteMsAccessIdentifier(index.name)} ON ${quoteMsAccessIdentifier(tableName)} (${index.columns.map((columnName) => quoteMsAccessIdentifier(columnName)).join(', ')});`
        );
    });

    const foreignKeyGroups = new Map<string, Array<TableInfo['foreignKeys'][number]>>();

    tableInfo.foreignKeys.forEach((foreignKey) => {
        const key = foreignKey.name?.trim() || `${foreignKey.id}`;
        const group = foreignKeyGroups.get(key) ?? [];
        group.push(foreignKey);
        foreignKeyGroups.set(key, group);
    });

    foreignKeyGroups.forEach((group, key) => {
        const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);
        const actions = [buildMsAccessForeignKeyActionClause('update', sortedGroup[0]?.onUpdate), buildMsAccessForeignKeyActionClause('delete', sortedGroup[0]?.onDelete)].filter(
            (value): value is string => !!value
        );

        statements.push(
            `ALTER TABLE ${quoteMsAccessIdentifier(tableName)} ADD CONSTRAINT ${quoteMsAccessIdentifier(key)} FOREIGN KEY (${sortedGroup.map((foreignKey) => quoteMsAccessIdentifier(foreignKey.from)).join(', ')}) REFERENCES ${quoteMsAccessIdentifier(sortedGroup[0]?.table ?? '')} (${sortedGroup.map((foreignKey) => quoteMsAccessIdentifier(foreignKey.to)).join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
        );
    });

    return statements;
}

function buildMsAccessKeySignature(key: Pick<ModifySchemaKey, 'name' | 'isPrimary' | 'columns'>) {
    return [key.isPrimary ? 'primary' : 'unique', key.name.trim().toLowerCase(), key.columns.map((column) => column.columnName.trim().toLowerCase()).join('|')].join('::');
}

function buildMsAccessForeignKeySignature(foreignKey: Pick<ModifySchemaPlan['foreignKeys'][number], 'name' | 'targetTable' | 'columns' | 'onDelete' | 'onUpdate' | 'match'>) {
    return [
        foreignKey.name.trim().toLowerCase(),
        foreignKey.targetTable.trim().toLowerCase(),
        foreignKey.columns.map((column) => `${column.columnName.trim().toLowerCase()}->${column.targetName.trim().toLowerCase()}`).join('|'),
        normalizeOptionalText(foreignKey.onDelete) ?? '',
        normalizeOptionalText(foreignKey.onUpdate) ?? '',
        normalizeOptionalText(foreignKey.match) ?? '',
    ].join('::');
}

function buildMsAccessIndexSignature(index: Pick<ModifySchemaPlan['indexes'][number], 'name' | 'isUnique' | 'columns'>) {
    return [index.name.trim().toLowerCase(), index.isUnique ? 'unique' : 'plain', index.columns.map((column) => column.columnName.trim().toLowerCase()).join('|')].join('::');
}

function createMsAccessCurrentColumn(column: TableInfo['columns'][number]) {
    return {
        name: column.name,
        type: column.type || '',
        notNull: column.notNull,
        defaultValue: column.defaultValue,
        isPrimaryKey: column.isPrimaryKey,
        primaryKeyOrdinal: column.primaryKeyOrdinal,
        isAutoIncrement: column.isAutoIncrement,
    } satisfies Pick<ModifySchemaColumn, 'name' | 'type' | 'notNull' | 'defaultValue' | 'isPrimaryKey' | 'primaryKeyOrdinal' | 'isAutoIncrement'>;
}

function getCurrentMsAccessUniqueKeys(currentInfo: TableInfo) {
    const primaryKeyColumns = [...currentInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);

    return currentInfo.indexes
        .filter(
            (index) =>
                index.isUnique &&
                !isMsAccessPrimaryBackingIndex(
                    {
                        name: index.name,
                        columns: index.columns.map((columnName) => ({ columnName })),
                    },
                    primaryKeyColumns.map((columnName) => ({ columnName }))
                )
        )
        .map((index) => ({
            name: index.name,
            isPrimary: false,
            columns: index.columns.map((columnName) => ({ columnName })),
        })) satisfies ModifySchemaKey[];
}

function getCurrentMsAccessStandaloneIndexes(currentInfo: TableInfo) {
    const primaryKeyColumns = [...currentInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => ({ columnName: column.name }));
    const excludedNames = new Set(getCurrentMsAccessUniqueKeys(currentInfo).map((key) => key.name.toLowerCase()));
    excludedNames.add('primary');

    return currentInfo.indexes
        .filter(
            (index) =>
                !excludedNames.has(index.name.toLowerCase()) &&
                !isMsAccessPrimaryBackingIndex(
                    {
                        name: index.name,
                        columns: index.columns.map((columnName) => ({ columnName })),
                    },
                    primaryKeyColumns
                )
        )
        .map((index) => ({
            name: index.name,
            isUnique: index.isUnique,
            comment: null,
            type: null,
            columns: index.columns.map((columnName) => ({
                columnName,
                order: null,
            })),
        })) satisfies ModifySchemaPlan['indexes'];
}

function getCurrentMsAccessForeignKeys(currentInfo: TableInfo) {
    const groups = new Map<string, TableInfo['foreignKeys']>();

    currentInfo.foreignKeys.forEach((foreignKey) => {
        const key = foreignKey.name ?? String(foreignKey.id);
        const group = groups.get(key) ?? [];
        group.push(foreignKey);
        groups.set(key, group);
    });

    return [...groups.values()].map((group) => {
        const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);
        return {
            name: sortedGroup[0]?.name ?? String(sortedGroup[0]?.id ?? ''),
            targetTable: sortedGroup[0]?.table ?? '',
            columns: sortedGroup.map((foreignKey) => ({
                columnName: foreignKey.from,
                targetName: foreignKey.to,
            })),
            onDelete: sortedGroup[0]?.onDelete?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            onUpdate: sortedGroup[0]?.onUpdate?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            match: sortedGroup[0]?.match?.toLowerCase() ?? 'none',
        };
    }) satisfies ModifySchemaPlan['foreignKeys'];
}

export function getMsAccessExplicitPlanErrors(currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const errors: string[] = [];
    const nextColumns = nextPlan.columns;
    const currentPrimaryKey = buildPrimaryKeyFromColumns(
        currentInfo.columns.map((column) => ({
            name: column.name,
            type: column.type || '',
            notNull: column.notNull,
            defaultValue: column.defaultValue,
            isPrimaryKey: column.isPrimaryKey,
            primaryKeyOrdinal: column.primaryKeyOrdinal,
            isAutoIncrement: column.isAutoIncrement,
            comment: column.comment ?? null,
            collation: column.collation ?? null,
            onUpdate: column.onUpdate ?? null,
        }))
    );
    const desiredPrimaryKey = getDesiredPrimaryKey(nextPlan);

    currentInfo.columns.forEach((currentColumn) => {
        const desiredColumn = nextColumns.find((column) => (column.originalName ?? column.name).toLowerCase() === currentColumn.name.toLowerCase());

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

        if (buildMsAccessColumnSignature(desiredColumn) !== buildMsAccessColumnSignature(createMsAccessCurrentColumn(currentColumn))) {
            errors.push(`MS Access cannot alter existing column ${currentColumn.name}: not possible because ALTER TABLE ... ALTER COLUMN is not supported by UCanAccess.`);
        }
    });

    if (
        nextColumns.length < currentInfo.columns.length ||
        !nextColumns
            .slice(0, currentInfo.columns.length)
            .every((column, index) => (column.originalName ?? column.name).toLowerCase() === currentInfo.columns[index]?.name.toLowerCase())
    ) {
        errors.push(
            'MS Access can only append new columns with explicit commands: ALTER TABLE ... ADD COLUMN works in UCanAccess, but reordering columns or inserting a column between existing columns is not supported.'
        );
    }

    if (
        (currentPrimaryKey && !desiredPrimaryKey) ||
        (!currentPrimaryKey && desiredPrimaryKey) ||
        (currentPrimaryKey && desiredPrimaryKey && buildMsAccessKeySignature(currentPrimaryKey) !== buildMsAccessKeySignature(desiredPrimaryKey))
    ) {
        errors.push(
            'MS Access cannot change the primary key here: this would require dropping or recreating the existing constraint, and ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.'
        );
    }

    getCurrentMsAccessUniqueKeys(currentInfo).forEach((currentKey) => {
        const desiredKey = getMsAccessUniqueKeys(nextPlan).find((key) => (key.originalName ?? key.name).toLowerCase() === currentKey.name.toLowerCase());

        if (!desiredKey) {
            errors.push(`MS Access cannot drop existing unique key ${currentKey.name}: not possible because DROP INDEX is not supported by UCanAccess.`);
            return;
        }

        if (buildMsAccessKeySignature(currentKey) !== buildMsAccessKeySignature(desiredKey)) {
            errors.push(
                `MS Access cannot modify existing unique key ${currentKey.name}: this would require DROP INDEX or ALTER INDEX, and those operations are not supported by UCanAccess.`
            );
        }
    });

    getCurrentMsAccessStandaloneIndexes(currentInfo).forEach((currentIndex) => {
        const desiredIndex = getMsAccessStandaloneIndexes(nextPlan).find((index) => (index.originalName ?? index.name).toLowerCase() === currentIndex.name.toLowerCase());

        if (!desiredIndex) {
            errors.push(`MS Access cannot drop existing index ${currentIndex.name}: not possible because DROP INDEX is not supported by UCanAccess.`);
            return;
        }

        if (buildMsAccessIndexSignature(currentIndex) !== buildMsAccessIndexSignature(desiredIndex)) {
            errors.push(
                `MS Access cannot modify existing index ${currentIndex.name}: this would require DROP INDEX or ALTER INDEX, and those operations are not supported by UCanAccess.`
            );
        }
    });

    getCurrentMsAccessForeignKeys(currentInfo).forEach((currentForeignKey) => {
        const desiredForeignKey = nextPlan.foreignKeys.find((foreignKey) => (foreignKey.originalName ?? foreignKey.name).toLowerCase() === currentForeignKey.name.toLowerCase());

        if (!desiredForeignKey) {
            errors.push(
                `MS Access cannot drop existing foreign key ${currentForeignKey.name}: not possible because ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.`
            );
            return;
        }

        if (buildMsAccessForeignKeySignature(currentForeignKey) !== buildMsAccessForeignKeySignature(desiredForeignKey)) {
            errors.push(
                `MS Access cannot modify existing foreign key ${currentForeignKey.name}: this would require dropping or recreating the existing constraint, and ALTER TABLE ... DROP CONSTRAINT is not supported by UCanAccess.`
            );
        }
    });

    return [...new Set(errors)];
}

function buildMsAccessRebuildModifyTableStatements(tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const nextTableName = nextPlan.table.name;
    const tempTableName = `__danevan_modify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nextColumns = nextPlan.columns;
    const nextColumnNames = new Set(nextColumns.map((column) => column.name.toLowerCase()));
    const primaryKey = getDesiredPrimaryKey(nextPlan);
    const createParts = nextColumns.map((column) => buildMsAccessColumnDefinition(column));

    const transferableColumns = nextColumns
        .filter((column) => column.originalName && currentInfo.columns.some((currentColumn) => currentColumn.name.toLowerCase() === column.originalName!.toLowerCase()))
        .map((column) => ({ target: column.name, source: column.originalName! }))
        .filter((column) => nextColumnNames.has(column.target.toLowerCase()));

    const statements = [`CREATE TABLE ${quoteMsAccessIdentifier(tempTableName)} (${createParts.join(', ')});`];

    if (transferableColumns.length > 0) {
        statements.push(
            `INSERT INTO ${quoteMsAccessIdentifier(tempTableName)} (${transferableColumns.map((column) => quoteMsAccessIdentifier(column.target)).join(', ')}) ` +
                `SELECT ${transferableColumns.map((column) => quoteMsAccessIdentifier(column.source)).join(', ')} FROM ${quoteMsAccessIdentifier(tableName)};`
        );
    }

    statements.push(`DROP TABLE ${quoteMsAccessIdentifier(tableName)};`);

    if (primaryKey && primaryKey.columns.length > 0) {
        statements.push(
            `ALTER TABLE ${quoteMsAccessIdentifier(tempTableName)} ADD CONSTRAINT ${quoteMsAccessIdentifier(getMsAccessPrimaryKeyConstraintName(primaryKey))} PRIMARY KEY (${primaryKey.columns
                .map((column) => quoteMsAccessIdentifier(column.columnName))
                .join(', ')});`
        );
    }

    statements.push(`ALTER TABLE ${quoteMsAccessIdentifier(tempTableName)} RENAME TO ${quoteMsAccessIdentifier(nextTableName)};`);

    getMsAccessUniqueKeys(nextPlan).forEach((key) => {
        statements.push(
            `CREATE UNIQUE INDEX ${quoteMsAccessIdentifier(key.name)} ON ${quoteMsAccessIdentifier(nextTableName)} (${key.columns
                .map((column) => quoteMsAccessIdentifier(column.columnName))
                .join(', ')});`
        );
    });

    getMsAccessStandaloneIndexes(nextPlan).forEach((index) => {
        statements.push(
            `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteMsAccessIdentifier(index.name)} ON ${quoteMsAccessIdentifier(nextTableName)} (${index.columns
                .map((column) => `${quoteMsAccessIdentifier(column.columnName)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`)
                .join(', ')});`
        );
    });

    nextPlan.foreignKeys.forEach((foreignKey) => {
        const targetTableName = foreignKey.targetTable.toLowerCase() === tableName.toLowerCase() ? nextTableName : foreignKey.targetTable;
        const actions = [buildMsAccessForeignKeyActionClause('update', foreignKey.onUpdate), buildMsAccessForeignKeyActionClause('delete', foreignKey.onDelete)].filter(
            (value): value is string => !!value
        );

        statements.push(
            `ALTER TABLE ${quoteMsAccessIdentifier(nextTableName)} ADD CONSTRAINT ${quoteMsAccessIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns
                .map((column) => quoteMsAccessIdentifier(column.columnName))
                .join(', ')}) REFERENCES ${quoteMsAccessIdentifier(targetTableName)} (${foreignKey.columns
                .map((column) => quoteMsAccessIdentifier(column.targetName))
                .join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
        );
    });

    return statements;
}

function validateMsAccessModifyTablePlan(currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const errors: string[] = [];

    if (normalizeOptionalText(nextPlan.table.comment)) {
        errors.push('MS Access modify-table does not support table comments.');
    }

    if (normalizeOptionalText(nextPlan.table.engine)) {
        errors.push('MS Access modify-table does not support table engine changes.');
    }

    if (normalizeOptionalText(nextPlan.table.collation)) {
        errors.push('MS Access modify-table does not support table collation changes.');
    }

    if (normalizeOptionalText(nextPlan.table.options)) {
        errors.push('MS Access modify-table does not support table option changes.');
    }

    nextPlan.columns.forEach((column) => {
        if (normalizeOptionalText(column.comment)) {
            errors.push(`Column ${column.name} cannot store comments on MS Access.`);
        }

        if (normalizeOptionalText(column.collation)) {
            errors.push(`Column ${column.name} cannot set collation on MS Access.`);
        }

        if (normalizeOptionalText(column.onUpdate)) {
            errors.push(`Column ${column.name} cannot use ON UPDATE on MS Access.`);
        }

        if (column.hidden) {
            errors.push(`Column ${column.name} cannot be hidden on MS Access.`);
        }

        if (normalizeOptionalText(column.columnKind) && normalizeOptionalText(column.columnKind)?.toUpperCase() !== 'NORMAL') {
            errors.push(`Column ${column.name} cannot use column kind ${column.columnKind} on MS Access.`);
        }
    });

    nextPlan.foreignKeys.forEach((foreignKey) => {
        if (normalizeOptionalText(foreignKey.match) && normalizeOptionalText(foreignKey.match)?.toUpperCase() !== 'NONE') {
            errors.push(`Foreign key ${foreignKey.name} cannot use MATCH on MS Access.`);
        }
    });

    if (!nextPlan.allowTableRebuild) {
        errors.push(...getMsAccessExplicitPlanErrors(currentInfo, nextPlan));
    }

    return [...new Set(errors)];
}

export function buildMsAccessModifyTableStatements(tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const explicitPlanErrors = getMsAccessExplicitPlanErrors(currentInfo, nextPlan);
    const validationErrors = validateMsAccessModifyTablePlan(currentInfo, nextPlan);

    if (validationErrors.length > 0) {
        throw new Error(validationErrors.join('\n'));
    }

    if (nextPlan.allowTableRebuild && explicitPlanErrors.length > 0) {
        return buildMsAccessRebuildModifyTableStatements(tableName, currentInfo, nextPlan);
    }

    const nextTableName = nextPlan.table.name;
    const currentUniqueKeys = getCurrentMsAccessUniqueKeys(currentInfo);
    const currentStandaloneIndexes = getCurrentMsAccessStandaloneIndexes(currentInfo);
    const currentForeignKeys = getCurrentMsAccessForeignKeys(currentInfo);
    const statements: string[] = [];
    let workingTableName = tableName;

    if (nextTableName !== tableName) {
        statements.push(`ALTER TABLE ${quoteMsAccessIdentifier(tableName)} RENAME TO ${quoteMsAccessIdentifier(nextTableName)};`);
        workingTableName = nextTableName;
    }

    nextPlan.columns
        .filter((column) => !column.originalName)
        .forEach((column) => {
            statements.push(`ALTER TABLE ${quoteMsAccessIdentifier(workingTableName)} ADD COLUMN ${buildMsAccessColumnDefinition(column)};`);
        });

    getMsAccessUniqueKeys(nextPlan)
        .filter((key) => !currentUniqueKeys.some((currentKey) => currentKey.name.toLowerCase() === (key.originalName ?? key.name).toLowerCase()))
        .forEach((key) => {
            statements.push(
                `CREATE UNIQUE INDEX ${quoteMsAccessIdentifier(key.name)} ON ${quoteMsAccessIdentifier(workingTableName)} (${key.columns
                    .map((column) => quoteMsAccessIdentifier(column.columnName))
                    .join(', ')});`
            );
        });

    getMsAccessStandaloneIndexes(nextPlan)
        .filter((index) => !currentStandaloneIndexes.some((currentIndex) => currentIndex.name.toLowerCase() === (index.originalName ?? index.name).toLowerCase()))
        .forEach((index) => {
            statements.push(
                `CREATE ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quoteMsAccessIdentifier(index.name)} ON ${quoteMsAccessIdentifier(workingTableName)} (${index.columns
                    .map((column) => `${quoteMsAccessIdentifier(column.columnName)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`)
                    .join(', ')});`
            );
        });

    nextPlan.foreignKeys
        .filter(
            (foreignKey) => !currentForeignKeys.some((currentForeignKey) => currentForeignKey.name.toLowerCase() === (foreignKey.originalName ?? foreignKey.name).toLowerCase())
        )
        .forEach((foreignKey) => {
            const targetTableName = foreignKey.targetTable.toLowerCase() === tableName.toLowerCase() ? nextTableName : foreignKey.targetTable;
            const actions = [buildMsAccessForeignKeyActionClause('update', foreignKey.onUpdate), buildMsAccessForeignKeyActionClause('delete', foreignKey.onDelete)].filter(
                (value): value is string => !!value
            );

            statements.push(
                `ALTER TABLE ${quoteMsAccessIdentifier(workingTableName)} ADD CONSTRAINT ${quoteMsAccessIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns
                    .map((column) => quoteMsAccessIdentifier(column.columnName))
                    .join(', ')}) REFERENCES ${quoteMsAccessIdentifier(targetTableName)} (${foreignKey.columns
                    .map((column) => quoteMsAccessIdentifier(column.targetName))
                    .join(', ')})${actions.length > 0 ? ` ${actions.join(' ')}` : ''};`
            );
        });

    return statements;
}

function normalizeMsAccessReferencingForeignKeys(value: unknown) {
    if (!Array.isArray(value)) {
        return [] as MsAccessReferencingForeignKey[];
    }

    return value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
            name: typeof entry.name === 'string' ? entry.name : undefined,
            table: typeof entry.table === 'string' ? entry.table : undefined,
            from: typeof entry.from === 'string' ? entry.from : undefined,
            to: typeof entry.to === 'string' ? entry.to : undefined,
        }))
        .filter((entry) => !!entry.table);
}

function getMsAccessInboundForeignKeyError(tableName: string, foreignKeys: MsAccessReferencingForeignKey[]) {
    if (foreignKeys.length === 0) {
        return undefined;
    }

    const details = foreignKeys
        .map((foreignKey) => {
            const name = foreignKey.name?.trim() || '(unnamed constraint)';
            const table = foreignKey.table?.trim() || '(unknown table)';
            const from = foreignKey.from?.trim();
            const to = foreignKey.to?.trim();
            const columnDetails = from && to ? ` (${table}.${from} -> ${tableName}.${to})` : '';
            return `${name} on ${table}${columnDetails}`;
        })
        .join(', ');

    return `MS Access cannot rebuild table ${tableName} while it is referenced by foreign keys from other tables: ${details}. Remove those referencing constraints first, then retry the rebuild.`;
}

function getMsAccessWorkerKey(databasePath: string) {
    return resolve(databasePath);
}

function encodeWorkerRequest(args: string[]) {
    return args.map((value) => encodeBase64Utf8(value)).join('\t');
}

function getWorkerErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'string' && error.trim()) {
        return error;
    }

    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return fallback;
}

function rejectActiveWorkerRequest(worker: MsAccessWorker, error: unknown) {
    if (!worker.activeRequest) {
        return;
    }

    const activeRequest = worker.activeRequest;
    worker.activeRequest = undefined;
    activeRequest.reject(new Error(getWorkerErrorMessage(error, `MS Access worker request failed during ${activeRequest.op}.`)));
}

function handleWorkerResponseLine(worker: MsAccessWorker, line: string) {
    if (!line) {
        return;
    }

    const activeRequest = worker.activeRequest;

    if (!activeRequest) {
        return;
    }

    try {
        const response = JSON.parse(line) as MsAccessWorkerResponse<unknown>;
        worker.activeRequest = undefined;

        if (response.ok !== true) {
            activeRequest.reject(new Error(getWorkerErrorMessage(response.error, `MS Access worker request failed during ${activeRequest.op}.`)));
            return;
        }

        activeRequest.resolve(response.result);
    } catch (error) {
        worker.activeRequest = undefined;
        activeRequest.reject(new Error(getWorkerErrorMessage(error, `MS Access worker returned invalid JSON during ${activeRequest.op}.`)));
    }
}

function drainWorkerResponseBuffer(worker: MsAccessWorker, flush = false) {
    let newlineIndex = worker.responseBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
        const line = worker.responseBuffer.slice(0, newlineIndex).trim();
        worker.responseBuffer = worker.responseBuffer.slice(newlineIndex + 1);
        handleWorkerResponseLine(worker, line);
        newlineIndex = worker.responseBuffer.indexOf('\n');
    }

    if (flush) {
        const remaining = worker.responseBuffer.trim();
        worker.responseBuffer = '';

        if (remaining) {
            handleWorkerResponseLine(worker, remaining);
        }
    }
}

async function readWorkerResponses(worker: MsAccessWorker) {
    const decoder = new TextDecoder();

    while (true) {
        const { value, done } = await worker.stdoutReader.read();

        if (done) {
            worker.responseBuffer += decoder.decode();
            drainWorkerResponseBuffer(worker, true);
            return;
        }

        worker.responseBuffer += decoder.decode(value, { stream: true });
        drainWorkerResponseBuffer(worker);
    }
}

function getMsAccessRuntimeDir(appDataDir: string) {
    return join(appDataDir, MS_ACCESS_RUNTIME_FOLDER_NAME);
}

function getBundledJavaCandidates(runtimeRootDir: string) {
    const javaBinaryName = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates = [
        process.env.DANEVAN_MSACCESS_JAVA_HOME?.trim() ? join(process.env.DANEVAN_MSACCESS_JAVA_HOME.trim(), 'bin', javaBinaryName) : undefined,
        join(runtimeRootDir, getMsAccessRuntimePlatformJreFolderName(process.platform), 'bin', javaBinaryName),
        join(runtimeRootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME, 'bin', javaBinaryName),
        join(runtimeRootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME, 'bin', javaBinaryName),
    ];

    return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

function getBundledJrePlatforms(runtimeRootDir: string) {
    return [...MS_ACCESS_RUNTIME_SUPPORTED_JRE_PLATFORMS].filter((platform) => existsSync(join(runtimeRootDir, getMsAccessRuntimePlatformJreFolderName(platform))));
}

function getBundledRuntimeCandidateDirs() {
    const execDir = dirname(process.execPath);
    const candidates = [
        process.env.DANEVAN_MSACCESS_RUNTIME_DIR?.trim(),
        resolve(process.cwd(), 'assets', MS_ACCESS_RUNTIME_FOLDER_NAME),
        process.platform === 'darwin'
            ? resolve(execDir, '..', 'Resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME)
            : resolve(execDir, 'resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME),
        resolve(execDir, '..', 'resources', 'app', MS_ACCESS_RUNTIME_FOLDER_NAME),
    ];

    return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

function findBundledRuntime(): BundledMsAccessRuntime | undefined {
    for (const runtimeRootDir of getBundledRuntimeCandidateDirs()) {
        const libDir = join(runtimeRootDir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
        const hasAllJars = msAccessRuntimeArtifacts.every((artifact) => existsSync(join(libDir, getMsAccessRuntimeJarName(artifact))));

        if (!hasAllJars) {
            continue;
        }

        const javaCommand = getBundledJavaCandidates(runtimeRootDir).find((candidate) => existsSync(candidate));

        return {
            rootDir: runtimeRootDir,
            libDir,
            javaCommand,
        } satisfies BundledMsAccessRuntime;
    }

    return undefined;
}

function hasDownloadedRuntime(appDataDir: string) {
    const libDir = join(getMsAccessRuntimeDir(appDataDir), MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
    return msAccessRuntimeArtifacts.every((artifact) => existsSync(join(libDir, getMsAccessRuntimeJarName(artifact))));
}

export function inspectMsAccessRuntime(appDataDir: string): MsAccessRuntimeStatus {
    const bundledRuntime = findBundledRuntime();
    const downloadedRuntime = hasDownloadedRuntime(appDataDir);
    const runtimePath = bundledRuntime?.rootDir ?? (downloadedRuntime ? getMsAccessRuntimeDir(appDataDir) : undefined);

    return {
        runtimeSource: bundledRuntime ? 'bundled' : downloadedRuntime ? 'downloaded' : 'missing',
        runtimePath,
        hasGenericBundledJre: bundledRuntime
            ? existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME)) || existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME))
            : false,
        bundledJrePlatforms: bundledRuntime ? getBundledJrePlatforms(bundledRuntime.rootDir) : [],
        currentPlatformHasBundledJre: bundledRuntime
            ? existsSync(join(bundledRuntime.rootDir, getMsAccessRuntimePlatformJreFolderName(process.platform))) ||
              existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME)) ||
              existsSync(join(bundledRuntime.rootDir, MS_ACCESS_RUNTIME_JRE_FOLDER_NAME))
            : false,
        runtimeDownloadsDisabled: /^(1|true|yes|on)$/i.test(process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS || ''),
    } satisfies MsAccessRuntimeStatus;
}

function getMsAccessDatabasePath(deps: MsAccessDriverToolsDeps, connectionId: number) {
    const connection = deps.getConnection(connectionId);

    if (!connection) {
        throw new Error('The selected connection could not be found.');
    }

    const server = deps.getServer(connection.server_id);

    if (!server) {
        throw new Error('The selected server could not be found.');
    }

    if (server.driver !== 'msaccess') {
        throw new Error(`The '${server.driver}' driver is not implemented here.`);
    }

    if (server.kind !== 'file') {
        throw new Error('MS Access connections must use a file-based source.');
    }

    const filePath = server.file_path?.trim();

    if (!filePath) {
        throw new Error('The selected MS Access source is missing its file path.');
    }

    if (!existsSync(filePath)) {
        throw new Error(`The MS Access file does not exist: ${filePath}`);
    }

    return filePath;
}

async function downloadFile(url: string, destinationPath: string) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to download ${url} (${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(destinationPath, bytes);
}

function parseJavaMajorVersion(versionOutput: string) {
    const match = versionOutput.match(/version\s+"(\d+)(?:\.(\d+))?/i) ?? versionOutput.match(/openjdk\s+(\d+)(?:\.(\d+))?/i);

    if (!match) {
        return undefined;
    }

    return Number(match[1]);
}

async function ensureJavaCommand(preferredCandidates: Array<string | undefined> = []) {
    const candidates = [
        ...preferredCandidates,
        process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : undefined,
        'java',
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
        try {
            const [stdout, stderr, exitCode] = await executeTextCommand({
                command: candidate,
                args: ['-version'],
            });

            const versionOutput = `${stdout}\n${stderr}`;
            const majorVersion = parseJavaMajorVersion(versionOutput);

            if (exitCode === 0 && typeof majorVersion === 'number' && majorVersion >= 11) {
                return candidate;
            }
        } catch {
            // try next candidate
        }
    }

    throw new Error('MS Access support requires Java 11 or newer. Install Java or bundle a JRE under msaccess-runtime/jre.');
}

async function findJavaCompiler(preferredCandidates: Array<string | undefined> = []) {
    const compilerBinaryName = process.platform === 'win32' ? 'javac.exe' : 'javac';
    const javaHomeCandidates = [process.env.DANEVAN_MSACCESS_JAVA_HOME, process.env.JAVA_HOME].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    const candidates = [...preferredCandidates, ...javaHomeCandidates.map((javaHome) => join(javaHome, 'bin', compilerBinaryName)), compilerBinaryName].filter(
        (candidate): candidate is string => Boolean(candidate)
    );

    for (const candidate of candidates) {
        try {
            const [stdout, stderr, exitCode] = await executeTextCommand({
                command: candidate,
                args: ['-version'],
            });

            const versionOutput = `${stdout}\n${stderr}`;
            const majorVersion = parseJavaMajorVersion(versionOutput);

            if (exitCode === 0 && typeof majorVersion === 'number' && majorVersion >= 11) {
                return candidate;
            }
        } catch {
            // try next candidate
        }
    }

    return undefined;
}

function getRuntimeClassPath(libDir: string) {
    return msAccessRuntimeArtifacts.map((artifact) => join(libDir, getMsAccessRuntimeJarName(artifact))).join(process.platform === 'win32' ? ';' : ':');
}

function getBridgeRuntimeClassPath(classPath: string, runtimeDir: string) {
    return [classPath, runtimeDir].join(process.platform === 'win32' ? ';' : ':');
}

function getAdjacentJavaCompiler(javaCommand: string) {
    if (!javaCommand.includes('/') && !javaCommand.includes('\\')) {
        return undefined;
    }

    const javaBinaryName = process.platform === 'win32' ? 'java.exe' : 'java';
    const compilerBinaryName = process.platform === 'win32' ? 'javac.exe' : 'javac';

    if (!javaCommand.endsWith(javaBinaryName)) {
        return undefined;
    }

    return join(dirname(javaCommand), compilerBinaryName);
}

async function ensureRuntimeBridge(runtimeDir: string, classPath: string, javaCommand: string) {
    const startedAt = performance.now();
    await mkdir(runtimeDir, { recursive: true });
    const sourcePath = join(runtimeDir, MS_ACCESS_RUNTIME_BRIDGE_FILE_NAME);
    const compiledClassPath = join(runtimeDir, `${MS_ACCESS_BRIDGE_CLASS_NAME}.class`);
    const existingSource = existsSync(sourcePath) ? await readFile(sourcePath, 'utf8') : undefined;

    if (existingSource !== MS_ACCESS_BRIDGE_SOURCE) {
        await writeFile(sourcePath, MS_ACCESS_BRIDGE_SOURCE, 'utf8');
    }

    logMsAccessPerf('runtime.bridge.write', startedAt, {
        runtimeDir,
        updated: existingSource !== MS_ACCESS_BRIDGE_SOURCE,
    });

    const javacCommand = await findJavaCompiler([getAdjacentJavaCompiler(javaCommand)]);

    if (!javacCommand) {
        return {
            bridgeLaunchArgs: ['--class-path', classPath, sourcePath],
        };
    }

    if (existingSource !== MS_ACCESS_BRIDGE_SOURCE || !existsSync(compiledClassPath)) {
        const compileStartedAt = performance.now();
        const [stdout, stderr, exitCode] = await executeTextCommand({
            command: javacCommand,
            args: ['--class-path', classPath, sourcePath],
            cwd: runtimeDir,
        });

        if (exitCode !== 0) {
            throw new Error(stderr.trim() || stdout.trim() || 'MS Access bridge compilation failed.');
        }

        logMsAccessPerf('runtime.bridge.compile', compileStartedAt, {
            runtimeDir,
        });
    }

    return {
        bridgeLaunchArgs: ['--class-path', getBridgeRuntimeClassPath(classPath, runtimeDir), MS_ACCESS_BRIDGE_CLASS_NAME],
    };
}

async function ensureMsAccessRuntime(appDataDir: string): Promise<MsAccessRuntime> {
    const existing = runtimeInitPromises.get(appDataDir);
    if (existing) {
        return existing;
    }

    const initialization = (async () => {
        const startedAt = performance.now();
        const runtimeDir = getMsAccessRuntimeDir(appDataDir);
        const bundledRuntime = findBundledRuntime();

        if (bundledRuntime) {
            const javaCommand = await ensureJavaCommand([bundledRuntime.javaCommand]);
            const classPath = getRuntimeClassPath(bundledRuntime.libDir);
            const { bridgeLaunchArgs } = await ensureRuntimeBridge(runtimeDir, classPath, javaCommand);

            logMsAccessPerf('runtime.init', startedAt, {
                source: 'bundled',
                runtimeDir: bundledRuntime.rootDir,
                hasBundledJre: Boolean(bundledRuntime.javaCommand),
            });

            return {
                javaCommand,
                classPath,
                bridgeLaunchArgs,
                runtimeDir,
            } satisfies MsAccessRuntime;
        }

        if (/^(1|true|yes|on)$/i.test(process.env.DANEVAN_MSACCESS_DISABLE_RUNTIME_DOWNLOADS || '')) {
            throw new Error('MS Access runtime jars are not bundled. Run bun run bundle:msaccess-runtime or provide DANEVAN_MSACCESS_RUNTIME_DIR.');
        }

        const libDir = join(runtimeDir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
        await mkdir(libDir, { recursive: true });

        for (const artifact of msAccessRuntimeArtifacts) {
            const jarPath = join(libDir, getMsAccessRuntimeJarName(artifact));

            if (!existsSync(jarPath)) {
                await downloadFile(getMsAccessRuntimeJarUrl(artifact), jarPath);
            }
        }

        const javaCommand = await ensureJavaCommand();
        const classPath = getRuntimeClassPath(libDir);
        const { bridgeLaunchArgs } = await ensureRuntimeBridge(runtimeDir, classPath, javaCommand);

        logMsAccessPerf('runtime.init', startedAt, {
            source: 'downloaded',
            runtimeDir,
        });

        return {
            javaCommand,
            classPath,
            bridgeLaunchArgs,
            runtimeDir,
        } satisfies MsAccessRuntime;
    })();

    runtimeInitPromises.set(appDataDir, initialization);
    return initialization;
}

async function createMsAccessWorker(runtime: MsAccessRuntime, databasePath: string): Promise<MsAccessWorker> {
    const key = getMsAccessWorkerKey(databasePath);
    const startedAt = performance.now();
    const child = Bun.spawn({
        cmd: [runtime.javaCommand, ...runtime.bridgeLaunchArgs, 'serve', key],
        cwd: runtime.runtimeDir,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = child.stdout as ReadableStream<Uint8Array> | undefined;

    if (!stdout || typeof stdout.getReader !== 'function') {
        child.kill();
        throw new Error('MS Access worker could not open a readable stdout stream.');
    }

    const worker: MsAccessWorker = {
        key,
        child,
        stdoutReader: stdout.getReader(),
        stderrPromise: new Response(child.stderr as ReadableStream).text(),
        responseBuffer: '',
        requestChain: Promise.resolve(),
        closed: false,
        exitedPromise: Promise.resolve(),
    };

    const responseLoop = readWorkerResponses(worker).catch((error) => {
        rejectActiveWorkerRequest(worker, error);
    });

    worker.exitedPromise = (async () => {
        const [exitCode, stderr] = await Promise.all([child.exited, worker.stderrPromise.catch(() => '')]);
        await responseLoop;
        worker.closed = true;
        workerInitPromises.delete(key);

        if (exitCode !== 0) {
            rejectActiveWorkerRequest(worker, stderr.trim() || `MS Access worker exited with code ${exitCode}.`);
        }
    })();

    logMsAccessPerf('worker.start', startedAt, { databasePath: key });
    return worker;
}

async function getMsAccessWorker(deps: MsAccessDriverToolsDeps, databasePath: string) {
    const key = getMsAccessWorkerKey(databasePath);
    const existing = workerInitPromises.get(key);

    if (existing) {
        return existing;
    }

    const initialization = (async () => {
        const runtime = await ensureMsAccessRuntime(deps.getUserDataDir());
        return createMsAccessWorker(runtime, key);
    })();

    workerInitPromises.set(key, initialization);

    try {
        return await initialization;
    } catch (error) {
        workerInitPromises.delete(key);
        throw error;
    }
}

async function performWorkerRequest<T>(worker: MsAccessWorker, args: string[]): Promise<T> {
    if (worker.closed) {
        throw new Error('MS Access worker is not running.');
    }

    const stdin = worker.child.stdin;

    if (!stdin || typeof stdin === 'number') {
        throw new Error('MS Access worker stdin is not writable.');
    }

    return await new Promise<T>((resolve, reject) => {
        worker.activeRequest = {
            op: args[0] ?? 'request',
            resolve: (value) => resolve(value as T),
            reject,
        };

        try {
            stdin.write(`${encodeWorkerRequest(args)}\n`);
            stdin.flush?.();
        } catch (error) {
            rejectActiveWorkerRequest(worker, error);
        }
    });
}

function sendWorkerRequest<T>(worker: MsAccessWorker, args: string[]): Promise<T> {
    const nextRequest = worker.requestChain.then(() => performWorkerRequest<T>(worker, args));
    worker.requestChain = nextRequest.then(
        () => undefined,
        () => undefined
    );
    return nextRequest;
}

async function runWorkerBridge<T>(deps: MsAccessDriverToolsDeps, databasePath: string, args: string[]): Promise<T> {
    const startedAt = performance.now();
    const worker = await getMsAccessWorker(deps, databasePath);

    try {
        return await sendWorkerRequest<T>(worker, args);
    } finally {
        logMsAccessPerf(`bridge.${args[0]}`, startedAt, { mode: 'worker' });
    }
}

async function disconnectWorker(databasePath: string) {
    const key = getMsAccessWorkerKey(databasePath);
    const workerPromise = workerInitPromises.get(key);

    if (!workerPromise) {
        return;
    }

    let worker: MsAccessWorker | undefined;

    try {
        worker = await workerPromise;
        await sendWorkerRequest(worker, ['disconnect']);
    } catch {
        // best-effort shutdown
    }

    if (!worker) {
        workerInitPromises.delete(key);
        return;
    }

    try {
        const stdin = worker.child.stdin;

        if (!worker.closed && stdin && typeof stdin !== 'number') {
            stdin.end?.();
        }
    } catch {
        // ignore shutdown errors
    }

    try {
        await worker.exitedPromise;
    } finally {
        workerInitPromises.delete(key);

        if (!worker.closed) {
            worker.child.kill();
        }
    }
}

async function runBridgeOnce<T>(deps: MsAccessDriverToolsDeps, args: string[]): Promise<T> {
    const startedAt = performance.now();
    const runtime = await ensureMsAccessRuntime(deps.getUserDataDir());
    const [stdout, stderr, exitCode] = await executeTextCommand({
        command: runtime.javaCommand,
        args: [...runtime.bridgeLaunchArgs, ...args],
        cwd: runtime.runtimeDir,
    });

    if (exitCode !== 0) {
        throw new Error(stderr.trim() || 'MS Access bridge command failed.');
    }

    try {
        return JSON.parse(stdout) as T;
    } catch (error) {
        throw new Error(`MS Access bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        logMsAccessPerf(`bridge.${args[0]}`, startedAt);
    }
}

async function readBridgeFileResponse<T>(response: { transport?: unknown; filePath?: unknown }) {
    if (response.transport !== 'file' || typeof response.filePath !== 'string') {
        throw new Error('MS Access bridge returned an invalid file transport response.');
    }

    const raw = await readFile(response.filePath, 'utf8');

    try {
        return JSON.parse(raw) as T;
    } finally {
        await rm(response.filePath, { force: true });
    }
}

function createTableData(
    deps: MsAccessDriverToolsDeps,
    response: { columns?: unknown; rows?: unknown; rowCount?: unknown; perf?: unknown },
    limit: number,
    offset: number
): TableData {
    const columns = Array.isArray(response.columns) ? response.columns.filter((entry): entry is string => typeof entry === 'string') : [];
    const rows = decodeQueryRows(response.rows);

    if (response.perf && typeof response.perf === 'object') {
        console.log(`[perf][msaccess] tableData.fetch ${JSON.stringify(response.perf)}`);
    }

    return {
        columns,
        columnStats: deps.buildColumnStats(columns, rows),
        rows,
        rowCount: typeof response.rowCount === 'number' ? response.rowCount : 0,
        limit,
        offset,
    } satisfies TableData;
}

export function useMsAccessDriverTools(deps: MsAccessDriverToolsDeps): DriverTools {
    async function getTableData(connectionId: number, tableName: string, limit: number, offset: number): Promise<TableData> {
        const databasePath = getMsAccessDatabasePath(deps, connectionId);
        const bridgeResponse = await runWorkerBridge<{
            transport?: unknown;
            filePath?: unknown;
            columns?: unknown;
            rows?: unknown;
            rowCount?: unknown;
            perf?: unknown;
        }>(deps, databasePath, ['getTableData', tableName, String(limit), String(offset)]);
        const response =
            bridgeResponse.transport === 'file'
                ? await readBridgeFileResponse<{
                      columns?: unknown;
                      rows?: unknown;
                      rowCount?: unknown;
                      perf?: unknown;
                  }>(bridgeResponse)
                : bridgeResponse;

        return createTableData(deps, response, limit, offset);
    }

    async function applyChanges(params: NormalizedApplyTableChanges): Promise<ApplyTableChangesResult> {
        const databasePath = getMsAccessDatabasePath(deps, params.connectionId);
        const response = await runWorkerBridge<{
            tableData?: { columns?: unknown; rows?: unknown; rowCount?: unknown };
            foreignKeyViolations?: unknown;
        }>(deps, databasePath, [
            'applyChanges',
            deps.normalizeTableName(params.tableName),
            String(params.limit),
            String(params.offset),
            String(params.disableForeignKeyChecks),
            String(params.changes.length),
            ...params.changes.flatMap((change) => [
                deps.normalizeColumnName(change.targetColumn, 'Target column'),
                encodeSqlValue(change.value),
                deps.normalizeColumnName(change.matchColumn, 'Match column'),
                encodeSqlValue(change.matchValue),
            ]),
        ]);

        return {
            tableData: createTableData(deps, response.tableData ?? {}, params.limit, params.offset),
            foreignKeyViolations: Array.isArray(response.foreignKeyViolations) ? response.foreignKeyViolations.filter((entry): entry is string => typeof entry === 'string') : [],
        } satisfies ApplyTableChangesResult;
    }

    return {
        async testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
            const filePath = params.filePath?.trim();

            if (!filePath) {
                throw new Error('A file path is required to test an MS Access source.');
            }

            if (!existsSync(filePath)) {
                throw new Error(`The MS Access file does not exist: ${filePath}`);
            }

            const result = await runBridgeOnce<{ message?: unknown }>(deps, ['test', filePath]);

            return {
                ok: true,
                driver: 'msaccess',
                message: typeof result.message === 'string' ? result.message : `Connected to MS Access file ${filePath}.`,
            } satisfies TestConnectionResult;
        },
        async getTablesFresh(connectionId: number): Promise<TableSummary[]> {
            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            const response = await runWorkerBridge<Array<{ name?: unknown; type?: unknown; rowCount?: unknown }>>(deps, databasePath, ['listTables']);

            return response
                .filter(
                    (table): table is { name: string; type: 'table' | 'view'; rowCount?: unknown } =>
                        typeof table?.name === 'string' && (table.type === 'table' || table.type === 'view')
                )
                .map((table) => ({
                    name: table.name,
                    type: table.type,
                    rowCount: typeof table.rowCount === 'number' ? table.rowCount : 0,
                }));
        },
        async getTableInfoFresh(connectionId: number, tableName: string): Promise<TableInfo> {
            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            return await runWorkerBridge<TableInfo>(deps, databasePath, ['getTableInfo', tableName]);
        },
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            const tableInfo = await runWorkerBridge<TableInfo>(deps, databasePath, ['getTableInfo', tableName]);
            return buildMsAccessCreateStatementsFromTableInfo(tableName, tableInfo).join('\n');
        },
        async listServerSchemas(serverId: number, connectionId?: number): Promise<ServerSchemaRecord[]> {
            const server = deps.getServer(serverId);

            if (!server) {
                throw new Error('The selected server could not be found.');
            }

            const connection = typeof connectionId === 'number' ? deps.getConnection(connectionId) : deps.listConnections(serverId)[0];
            const fileName = server.file_path ? basename(server.file_path) : server.name;
            const schemaName = connection?.database_name || connection?.name || fileName;

            return [{ name: schemaName } satisfies ServerSchemaRecord];
        },
        async disconnectConnection(connectionId: number): Promise<void> {
            await disconnectWorker(getMsAccessDatabasePath(deps, connectionId));
        },
        getTableData,
        async runQuery(connectionId: number, sql: string, params?: SqlValue[]): Promise<QueryExecutionResult> {
            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            const bridgeResponse = await runWorkerBridge<{
                kind?: unknown;
                transport?: unknown;
                filePath?: unknown;
                columns?: unknown;
                rows?: unknown;
                lastInsertRowid?: unknown;
            }>(deps, databasePath, ['runQuery', encodeBase64Utf8(sql), ...(params ?? []).map((value) => encodeSqlValue(value))]);
            const response =
                bridgeResponse.kind === 'rows' && bridgeResponse.transport === 'file'
                    ? await readBridgeFileResponse<{
                          kind?: unknown;
                          columns?: unknown;
                          rows?: unknown;
                          lastInsertRowid?: unknown;
                      }>(bridgeResponse)
                    : bridgeResponse;

            if (response.kind === 'rows') {
                const columns = Array.isArray(response.columns) ? response.columns.filter((entry): entry is string => typeof entry === 'string') : [];
                const rows = decodeQueryRows(response.rows);

                return {
                    kind: 'rows',
                    columns,
                    columnStats: deps.buildColumnStats(columns, rows),
                    rows,
                } satisfies QueryExecutionResult;
            }

            return {
                kind: 'mutation',
                lastInsertRowid: typeof response.lastInsertRowid === 'number' ? response.lastInsertRowid : 0,
            } satisfies QueryExecutionResult;
        },
        async modifyTable(connectionId: number, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan): Promise<void> {
            const explicitPlanErrors = getMsAccessExplicitPlanErrors(currentInfo, nextPlan);

            if (nextPlan.allowTableRebuild && explicitPlanErrors.length > 0) {
                const databasePath = getMsAccessDatabasePath(deps, connectionId);
                const inboundForeignKeys = normalizeMsAccessReferencingForeignKeys(await runWorkerBridge(deps, databasePath, ['getReferencingForeignKeys', tableName]));
                const inboundForeignKeyError = getMsAccessInboundForeignKeyError(tableName, inboundForeignKeys);

                if (inboundForeignKeyError) {
                    throw new Error(inboundForeignKeyError);
                }
            }

            const statements = buildMsAccessModifyTableStatements(tableName, currentInfo, nextPlan);

            if (statements.length === 0) {
                return;
            }

            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            await runWorkerBridge(deps, databasePath, ['executeStatements', ...statements]);
        },
        async updateColumn(params: UpdateColumnParams): Promise<TableData> {
            const result = await applyChanges({
                connectionId: params.connectionId,
                tableName: params.tableName,
                changes: [
                    {
                        targetColumn: params.targetColumn,
                        value: params.value,
                        matchColumn: params.matchColumn,
                        matchValue: params.matchValue,
                    },
                ],
                disableForeignKeyChecks: false,
                limit: 100,
                offset: 0,
            });

            return result.tableData;
        },
        async applyTableChanges(params: NormalizedApplyTableChanges): Promise<ApplyTableChangesResult> {
            return applyChanges(params);
        },
    } satisfies DriverTools;
}
