/**
 * The SQL the remote drivers send: identifier quoting, referential actions, foreign-key objects and
 * statement preparation. Pure functions, so what reaches MySQL or PostgreSQL can be asserted without
 * a server — the place where a wrong string silently changes data.
 */
import { TableForeignKey } from 'typeorm';
import type { ModifySchemaForeignKey } from './useSqliteDriver.ts';
import { getTypeOrmObjectBaseName } from './typeOrmMappers.ts';
import { prepareTypeOrmParameterizedStatement } from './typeOrmStatementParameters.ts';
import type { RemoteStatement } from './useRemoteDriverTools.ts';
import type { Table, View } from 'typeorm';

export function normalizeCountValue(value: number | bigint | string | null | undefined) {
    if (typeof value === 'bigint') {
        return Number(value);
    }

    if (typeof value === 'string') {
        return Number(value);
    }

    return value ?? 0;
}

export function quoteMySqlIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => `\`${part.replaceAll('`', '``')}\``)
        .join('.');
}

export function quotePostgresIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => `"${part.replaceAll('"', '""')}"`)
        .join('.');
}

export function normalizeMySqlReferentialAction(value: string | null | undefined): string | undefined {
    if (!value?.trim()) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase().replaceAll(' ', '_');

    switch (normalized) {
        case 'no_action':
            return 'NO ACTION';
        case 'restrict':
            return 'RESTRICT';
        case 'cascade':
            return 'CASCADE';
        case 'set_null':
            return 'SET NULL';
        case 'set_default':
            return 'SET DEFAULT';
        default:
            return value;
    }
}

export function createTypeOrmForeignKey(foreignKey: ModifySchemaForeignKey) {
    return new TableForeignKey({
        name: foreignKey.name,
        columnNames: foreignKey.columns.map((column) => column.columnName),
        referencedTableName: foreignKey.targetTable,
        referencedColumnNames: foreignKey.columns.map((column) => column.targetName),
        onDelete: normalizeMySqlReferentialAction(foreignKey.onDelete),
        onUpdate: normalizeMySqlReferentialAction(foreignKey.onUpdate),
    });
}

export function normalizePostgresTableName(table: Pick<Table | View, 'name'>) {
    return getTypeOrmObjectBaseName(table);
}

export function preparePostgresStatement(statement: RemoteStatement) {
    const params = statement.params ?? [];
    const prepared = prepareTypeOrmParameterizedStatement(statement.sql, (index) => `$${index + 1}`);

    if (prepared.paramCount !== params.length) {
        throw new Error(`PostgreSQL expected ${prepared.paramCount} parameter(s) but received ${params.length}.`);
    }

    return {
        sql: prepared.sql,
        params,
    };
}
