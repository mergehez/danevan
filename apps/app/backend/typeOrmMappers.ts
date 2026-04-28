import type { TableColumnInfo, TableForeignKeyInfo, TableIndexInfo } from '@utils/appClient';
import type { Table, TableForeignKey, TableIndex, TableUnique, TableColumn as TypeOrmTableColumn, View } from 'typeorm';

type NormalizeOptionalText = (value: string | null | undefined) => string | null;

type MySqlIndexMetadataRow = {
    name: string;
    comment?: string | null;
    type?: string | null;
    columnOrder?: string | null;
};

function quoteMySqlLiteral(value: string) {
    return `'${value.replaceAll("'", "''")}'`;
}

export function normalizeTypeOrmDefault(value: unknown) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
        return String(value);
    }

    return JSON.stringify(value);
}

export function getTypeOrmIndexType(index: { isSpatial?: boolean; isFulltext?: boolean }) {
    if ('isSpatial' in index && index.isSpatial) {
        return 'SPATIAL';
    }

    if ('isFulltext' in index && index.isFulltext) {
        return 'FULLTEXT';
    }

    return null;
}

export function formatTypeOrmColumnType(column: TypeOrmTableColumn) {
    const baseType = column.type === 'simple-enum' ? 'enum' : column.type;
    let renderedType = baseType;

    if ((baseType === 'enum' || baseType === 'set') && Array.isArray(column.enum) && column.enum.length > 0) {
        renderedType = `${baseType}(${column.enum.map((value) => quoteMySqlLiteral(String(value))).join(',')})`;
    } else if (typeof column.width === 'number' && Number.isFinite(column.width)) {
        renderedType = `${baseType}(${column.width})`;
    } else if (column.length) {
        renderedType = `${baseType}(${column.length})`;
    } else if (typeof column.precision === 'number' && typeof column.scale === 'number') {
        renderedType = `${baseType}(${column.precision},${column.scale})`;
    } else if (typeof column.precision === 'number') {
        renderedType = `${baseType}(${column.precision})`;
    }

    if (column.unsigned) {
        renderedType = `${renderedType} unsigned`;
    }

    if (column.zerofill) {
        renderedType = `${renderedType} zerofill`;
    }

    return renderedType;
}

export function getPrimaryKeyOrdinals(table: Table) {
    return new Map(table.columns.filter((column) => column.isPrimary).map((column, index) => [column.name, index + 1]));
}

export function mapTypeOrmColumns(table: Table, normalizeOptionalText: NormalizeOptionalText): TableColumnInfo[] {
    const primaryKeyOrdinals = getPrimaryKeyOrdinals(table);

    return table.columns.map((column, index) => ({
        cid: index,
        name: column.name,
        type: formatTypeOrmColumnType(column),
        notNull: !column.isNullable,
        defaultValue: normalizeTypeOrmDefault(column.default),
        isPrimaryKey: column.isPrimary,
        primaryKeyOrdinal: primaryKeyOrdinals.get(column.name) ?? null,
        isAutoIncrement: column.isGenerated && ['increment', 'identity'].includes(column.generationStrategy ?? ''),
        comment: normalizeOptionalText(column.comment),
        collation: normalizeOptionalText(column.collation),
        onUpdate: normalizeOptionalText(column.onUpdate),
    }));
}

export function mapTypeOrmIndexes(indexes: TableIndex[], metadataRows: MySqlIndexMetadataRow[], normalizeOptionalText: NormalizeOptionalText): TableIndexInfo[] {
    const metadataByName = new Map<string, MySqlIndexMetadataRow[]>();

    metadataRows.forEach((row) => {
        const group = metadataByName.get(row.name) ?? [];
        group.push(row);
        metadataByName.set(row.name, group);
    });

    return indexes.map((index) => {
        const indexName = index.name ?? index.columnNames.join('_');
        const metadata = metadataByName.get(index.name ?? '') ?? [];

        return {
            name: indexName,
            columns: [...index.columnNames],
            orders: metadata.map((row) => normalizeOptionalText(row.columnOrder)?.toUpperCase() ?? 'NONE'),
            comment: normalizeOptionalText(metadata[0]?.comment),
            isUnique: index.isUnique,
            origin: getTypeOrmIndexType(index) ?? 'BTREE',
            isPartial: false,
            type: normalizeOptionalText(metadata[0]?.type) ?? getTypeOrmIndexType(index),
        };
    });
}

export function mapTypeOrmIndexesWithoutMetadata(indexes: TableIndex[], uniques: TableUnique[], normalizeOptionalText: NormalizeOptionalText): TableIndexInfo[] {
    const mappedIndexes = indexes.map(
        (index) =>
            ({
                name: index.name ?? index.columnNames.join('_'),
                columns: [...index.columnNames],
                comment: null,
                isUnique: index.isUnique,
                origin: 'index',
                isPartial: normalizeOptionalText(index.where)?.length ? true : false,
                type: getTypeOrmIndexType(index),
            }) satisfies TableIndexInfo
    );

    const mappedUniques = uniques.map(
        (unique) =>
            ({
                name: unique.name ?? unique.columnNames.join('_'),
                columns: [...unique.columnNames],
                comment: null,
                isUnique: true,
                origin: 'index',
                isPartial: false,
                type: null,
            }) satisfies TableIndexInfo
    );

    return [...mappedIndexes, ...mappedUniques];
}

export function mapTypeOrmForeignKeys(foreignKeys: TableForeignKey[]): TableForeignKeyInfo[] {
    return foreignKeys.flatMap((foreignKey, foreignKeyIndex) =>
        foreignKey.columnNames.map((columnName, columnIndex) => ({
            id: foreignKeyIndex,
            name: foreignKey.name,
            sequence: columnIndex,
            table: foreignKey.referencedTableName ?? '',
            from: columnName,
            to: foreignKey.referencedColumnNames[columnIndex] ?? '',
            onUpdate: foreignKey.onUpdate ?? 'NO ACTION',
            onDelete: foreignKey.onDelete ?? 'NO ACTION',
            match: 'NONE',
        }))
    );
}

export function mapTypeOrmTableMetadata(table: Table | undefined, normalizeOptionalText: NormalizeOptionalText) {
    return {
        comment: normalizeOptionalText(table?.comment),
        engine: normalizeOptionalText(table?.engine),
    };
}

export function getTypeOrmObjectBaseName(entry: Pick<Table | View, 'name'>) {
    return entry.name.split('.').pop() ?? entry.name;
}

export type { MySqlIndexMetadataRow };
