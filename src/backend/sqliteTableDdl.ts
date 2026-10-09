/**
 * SQLite table DDL: reading column metadata out of an existing `CREATE TABLE` statement, and
 * generating the statement that rewrites a table for the modify-table plan. Pure functions, so the
 * parsing and the generated SQL can be asserted directly instead of through a live database.
 */
import type { TableColumnInfo, TableInfo } from '../shared/types';
import type { ModifySchemaColumn, ModifySchemaPlan } from './useSqliteDriver.ts';

export function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

export function splitSqliteList(input: string) {
    const items: string[] = [];
    let buffer = '';
    let depth = 0;
    let quote: 'single' | 'double' | 'backtick' | 'bracket' | undefined;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];

        if (quote === 'single') {
            buffer += char;
            if (char === "'" && input[index + 1] === "'") {
                buffer += input[index + 1];
                index += 1;
            } else if (char === "'") {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'double') {
            buffer += char;
            if (char === '"' && input[index + 1] === '"') {
                buffer += input[index + 1];
                index += 1;
            } else if (char === '"') {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'backtick') {
            buffer += char;
            if (char === '`' && input[index + 1] === '`') {
                buffer += input[index + 1];
                index += 1;
            } else if (char === '`') {
                quote = undefined;
            }
            continue;
        }

        if (quote === 'bracket') {
            buffer += char;
            if (char === ']') {
                quote = undefined;
            }
            continue;
        }

        if (char === "'") {
            quote = 'single';
            buffer += char;
            continue;
        }

        if (char === '"') {
            quote = 'double';
            buffer += char;
            continue;
        }

        if (char === '`') {
            quote = 'backtick';
            buffer += char;
            continue;
        }

        if (char === '[') {
            quote = 'bracket';
            buffer += char;
            continue;
        }

        if (char === '(') {
            depth += 1;
            buffer += char;
            continue;
        }

        if (char === ')') {
            depth = Math.max(0, depth - 1);
            buffer += char;
            continue;
        }

        if (char === ',' && depth === 0) {
            const item = buffer.trim();

            if (item) {
                items.push(item);
            }

            buffer = '';
            continue;
        }

        buffer += char;
    }

    const tail = buffer.trim();

    if (tail) {
        items.push(tail);
    }

    return items;
}

function extractLeadingIdentifier(input: string) {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
        return undefined;
    }

    const firstCharacter = trimmedInput[0];

    if (firstCharacter === '"') {
        const endIndex = trimmedInput.indexOf('"', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex).replaceAll('""', '"') : undefined;
    }

    if (firstCharacter === '`') {
        const endIndex = trimmedInput.indexOf('`', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex).replaceAll('``', '`') : undefined;
    }

    if (firstCharacter === '[') {
        const endIndex = trimmedInput.indexOf(']', 1);
        return endIndex >= 1 ? trimmedInput.slice(1, endIndex) : undefined;
    }

    const match = trimmedInput.match(/^([^\s(]+)/);
    return match?.[1];
}

export function extractSqliteColumnDefinition(createTableSql: string | null | undefined, columnName: string) {
    if (!createTableSql) {
        return undefined;
    }

    const startIndex = createTableSql.indexOf('(');
    const endIndex = createTableSql.lastIndexOf(')');

    if (startIndex < 0 || endIndex <= startIndex) {
        return undefined;
    }

    const entries = splitSqliteList(createTableSql.slice(startIndex + 1, endIndex));
    return entries.find((entry) => extractLeadingIdentifier(entry)?.toLowerCase() === columnName.toLowerCase());
}

export function parseSqliteColumnMetadata(createTableSql: string | null | undefined, columnName: string) {
    const definition = extractSqliteColumnDefinition(createTableSql, columnName);

    if (!definition) {
        return {
            isAutoIncrement: false,
            collation: null,
        };
    }

    const collationMatch = definition.match(/\bCOLLATE\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s,]+))/i);

    return {
        isAutoIncrement: /\bAUTOINCREMENT\b/i.test(definition),
        collation: normalizeOptionalText(collationMatch?.[1] ?? collationMatch?.[2] ?? collationMatch?.[3] ?? collationMatch?.[4]),
    };
}

export function enrichSqliteColumns(columns: TableColumnInfo[], createTableSql: string | null | undefined) {
    return columns.map((column) => {
        const metadata = parseSqliteColumnMetadata(createTableSql, column.name);

        return {
            ...column,
            isAutoIncrement: column.isAutoIncrement || metadata.isAutoIncrement,
            collation: column.collation ?? metadata.collation,
        } satisfies TableColumnInfo;
    });
}

export function buildSqliteColumnDefinition(quoteIdentifier: (identifier: string) => string, column: ModifySchemaColumn, inlinePrimaryKey: boolean) {
    const parts = [quoteIdentifier(column.name), inlinePrimaryKey && column.isAutoIncrement ? 'INTEGER' : column.type];

    if (inlinePrimaryKey) {
        parts.push('PRIMARY KEY');

        if (column.isAutoIncrement) {
            parts.push('AUTOINCREMENT');
        }
    }

    if (column.collation) {
        parts.push(`COLLATE ${quoteIdentifier(column.collation)}`);
    }

    if (column.notNull) {
        parts.push('NOT NULL');
    }

    if (column.defaultValue) {
        parts.push(`DEFAULT ${column.defaultValue}`);
    }

    return parts.join(' ');
}

export function buildSqliteCreateTableSql(quoteIdentifier: (identifier: string) => string, tableName: string, _currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
    const nextColumns = nextPlan.columns;
    const renamedColumnNames = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column.name]));
    const nextColumnNames = new Set(nextColumns.map((column) => column.name));
    const explicitPrimaryKey = nextPlan.keys.find((key) => key.isPrimary);
    const primaryKeyColumns = explicitPrimaryKey
        ? explicitPrimaryKey.columns.map((column, index) => ({ name: column.columnName, primaryKeyOrdinal: index + 1 }))
        : nextColumns
              .filter((column) => column.isPrimaryKey)
              .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER));
    const inlinePrimaryKeyColumnName = primaryKeyColumns.length === 1 ? primaryKeyColumns[0]?.name : undefined;
    const parts = nextColumns.map((column) => buildSqliteColumnDefinition(quoteIdentifier, column, column.name === inlinePrimaryKeyColumnName));

    if (primaryKeyColumns.length > 1) {
        parts.push(`PRIMARY KEY (${primaryKeyColumns.map((column) => quoteIdentifier(column.name)).join(', ')})`);
    }

    const uniqueConstraints = nextPlan.keys
        .filter((key) => !key.isPrimary)
        .map((key) => key.columns.map((column) => column.columnName))
        .filter((columnNames) => columnNames.every((columnName) => nextColumnNames.has(columnName)));

    uniqueConstraints.forEach((columnNames) => {
        parts.push(`UNIQUE (${columnNames.map((columnName) => quoteIdentifier(columnName)).join(', ')})`);
    });

    for (const foreignKey of nextPlan.foreignKeys) {
        const mappedFromColumns = foreignKey.columns.map((column) => renamedColumnNames.get(column.columnName) ?? column.columnName);

        if (!mappedFromColumns.every((columnName) => nextColumnNames.has(columnName))) {
            continue;
        }

        const clauses = [
            `FOREIGN KEY (${mappedFromColumns.map((columnName) => quoteIdentifier(columnName)).join(', ')})`,
            `REFERENCES ${quoteIdentifier(foreignKey.targetTable)} (${foreignKey.columns.map((column) => quoteIdentifier(column.targetName)).join(', ')})`,
        ];

        if (foreignKey.onUpdate && foreignKey.onUpdate.toUpperCase() !== 'NO ACTION') {
            clauses.push(`ON UPDATE ${foreignKey.onUpdate.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (foreignKey.onDelete && foreignKey.onDelete.toUpperCase() !== 'NO ACTION') {
            clauses.push(`ON DELETE ${foreignKey.onDelete.replaceAll('_', ' ').toUpperCase()}`);
        }

        if (foreignKey.match && foreignKey.match.toUpperCase() !== 'NONE') {
            clauses.push(`MATCH ${foreignKey.match.toUpperCase()}`);
        }

        parts.push(clauses.join(' '));
    }

    return `CREATE TABLE ${quoteIdentifier(tableName)} (\n    ${parts.join(',\n    ')}\n);`;
}
