import { Table, TableColumn, TableForeignKey, TableIndex, TableUnique } from 'typeorm';
import type { View } from 'typeorm';
import { describe, expect, it } from 'vitest';
import type { MySqlIndexMetadataRow } from './typeOrmMappers';
import {
    formatTypeOrmColumnType,
    getPrimaryKeyOrdinals,
    getTypeOrmIndexType,
    getTypeOrmObjectBaseName,
    mapTypeOrmColumns,
    mapTypeOrmForeignKeys,
    mapTypeOrmIndexes,
    mapTypeOrmIndexesWithoutMetadata,
    mapTypeOrmTableMetadata,
    normalizeTypeOrmDefault,
} from './typeOrmMappers';

// Same implementation the sqlite driver passes to the mappers.
function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

describe('normalizeTypeOrmDefault', () => {
    it('maps nullish values to null', () => {
        expect(normalizeTypeOrmDefault(undefined)).toBeNull();
        expect(normalizeTypeOrmDefault(null)).toBeNull();
    });

    it('keeps string defaults verbatim', () => {
        expect(normalizeTypeOrmDefault('')).toBe('');
        expect(normalizeTypeOrmDefault('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
        expect(normalizeTypeOrmDefault('  spaced  ')).toBe('  spaced  ');
    });

    it('stringifies numbers and booleans', () => {
        expect(normalizeTypeOrmDefault(0)).toBe('0');
        expect(normalizeTypeOrmDefault(42)).toBe('42');
        expect(normalizeTypeOrmDefault(-1.5)).toBe('-1.5');
        expect(normalizeTypeOrmDefault(Number.NaN)).toBe('NaN');
        expect(normalizeTypeOrmDefault(true)).toBe('true');
        expect(normalizeTypeOrmDefault(false)).toBe('false');
    });

    it('stringifies bigints and symbols', () => {
        expect(normalizeTypeOrmDefault(9007199254740993n)).toBe('9007199254740993');
        expect(normalizeTypeOrmDefault(Symbol('sym'))).toBe('Symbol(sym)');
    });

    it('serializes structured defaults as JSON', () => {
        expect(normalizeTypeOrmDefault({ a: 1, b: null })).toBe('{"a":1,"b":null}');
        expect(normalizeTypeOrmDefault(['a', 'b'])).toBe('["a","b"]');
    });
});

describe('getTypeOrmIndexType', () => {
    it('reports spatial and fulltext indexes', () => {
        expect(getTypeOrmIndexType({ isSpatial: true })).toBe('SPATIAL');
        expect(getTypeOrmIndexType({ isFulltext: true })).toBe('FULLTEXT');
        expect(getTypeOrmIndexType(new TableIndex({ columnNames: ['shape'], isSpatial: true }))).toBe('SPATIAL');
        expect(getTypeOrmIndexType(new TableIndex({ columnNames: ['body'], isFulltext: true }))).toBe('FULLTEXT');
    });

    it('prefers spatial when both flags are set', () => {
        expect(getTypeOrmIndexType({ isSpatial: true, isFulltext: true })).toBe('SPATIAL');
    });

    it('returns null for plain and false-flag indexes', () => {
        expect(getTypeOrmIndexType({})).toBeNull();
        expect(getTypeOrmIndexType({ isSpatial: false, isFulltext: false })).toBeNull();
        expect(getTypeOrmIndexType({ isSpatial: undefined, isFulltext: undefined })).toBeNull();
        expect(getTypeOrmIndexType(new TableIndex({ columnNames: ['a'] }))).toBeNull();
    });
});

describe('formatTypeOrmColumnType', () => {
    it('renders base types without modifiers', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'int' }))).toBe('int');
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'text' }))).toBe('text');
    });

    it('appends length and unsigned', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'varchar', length: '255' }))).toBe('varchar(255)');
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'varchar', length: '255', unsigned: true }))).toBe('varchar(255) unsigned');
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'int', unsigned: true }))).toBe('int unsigned');
    });

    it('renders enum and set values with MySQL quoting', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'simple-enum', enum: ['a', 'b'] }))).toBe("enum('a','b')");
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'enum', enum: ["it's"] }))).toBe("enum('it''s')");
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'set', enum: ['x', 'y'] }))).toBe("set('x','y')");
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'enum', enum: ['a'], unsigned: true }))).toBe("enum('a') unsigned");
    });

    it('ignores an empty enum list', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'enum', enum: [] }))).toBe('enum');
    });

    it('renders precision and scale', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'decimal', precision: 10, scale: 2 }))).toBe('decimal(10,2)');
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'decimal', precision: 10 }))).toBe('decimal(10)');
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'decimal', precision: null, scale: 2 }))).toBe('decimal');
    });

    it('prefers enum values over length and length over precision', () => {
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'enum', enum: ['a'], length: '10' }))).toBe("enum('a')");
        expect(formatTypeOrmColumnType(new TableColumn({ name: 'a', type: 'decimal', length: '10', precision: 8, scale: 2 }))).toBe('decimal(10)');
    });
});

describe('getPrimaryKeyOrdinals', () => {
    it('numbers primary columns in table order', () => {
        const table = new Table({
            name: 'users',
            columns: [
                new TableColumn({ name: 'id', type: 'integer', isPrimary: true }),
                new TableColumn({ name: 'email', type: 'varchar', length: '255' }),
                new TableColumn({ name: 'tenant_id', type: 'integer', isPrimary: true }),
            ],
        });

        expect([...getPrimaryKeyOrdinals(table)]).toEqual([
            ['id', 1],
            ['tenant_id', 2],
        ]);
    });

    it('returns an empty map when no column is primary', () => {
        const table = new Table({ name: 'plain', columns: [new TableColumn({ name: 'a', type: 'int' })] });

        expect([...getPrimaryKeyOrdinals(table)]).toEqual([]);
    });
});

describe('mapTypeOrmColumns', () => {
    it('maps names, types, defaults, keys and optional text', () => {
        const table = new Table({
            name: 'users',
            columns: [
                new TableColumn({ name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' }),
                new TableColumn({ name: 'email', type: 'varchar', length: '255', default: 'none', comment: '  login  ', collation: ' utf8mb4_bin ' }),
                new TableColumn({ name: 'tenant_id', type: 'integer', isPrimary: true, isNullable: true, default: 0 }),
                new TableColumn({ name: 'token', type: 'uuid', isGenerated: true, generationStrategy: 'uuid', comment: '   ', onUpdate: ' now() ' }),
            ],
        });

        expect(mapTypeOrmColumns(table, normalizeOptionalText)).toEqual([
            {
                cid: 0,
                name: 'id',
                type: 'integer',
                notNull: true,
                defaultValue: null,
                isPrimaryKey: true,
                primaryKeyOrdinal: 1,
                isAutoIncrement: true,
                comment: null,
                collation: null,
                onUpdate: null,
            },
            {
                cid: 1,
                name: 'email',
                type: 'varchar(255)',
                notNull: true,
                defaultValue: 'none',
                isPrimaryKey: false,
                primaryKeyOrdinal: null,
                isAutoIncrement: false,
                comment: 'login',
                collation: 'utf8mb4_bin',
                onUpdate: null,
            },
            {
                cid: 2,
                name: 'tenant_id',
                type: 'integer',
                notNull: false,
                defaultValue: '0',
                isPrimaryKey: true,
                primaryKeyOrdinal: 2,
                isAutoIncrement: false,
                comment: null,
                collation: null,
                onUpdate: null,
            },
            {
                cid: 3,
                name: 'token',
                type: 'uuid',
                notNull: true,
                defaultValue: null,
                isPrimaryKey: false,
                primaryKeyOrdinal: null,
                isAutoIncrement: false,
                comment: null,
                collation: null,
                onUpdate: 'now()',
            },
        ]);
    });

    it('marks only increment and identity generation as auto-increment', () => {
        const table = new Table({
            name: 'generated',
            columns: [
                new TableColumn({ name: 'a', type: 'integer', isGenerated: true, generationStrategy: 'identity' }),
                new TableColumn({ name: 'b', type: 'integer', isGenerated: true }),
                new TableColumn({ name: 'c', type: 'integer', generationStrategy: 'increment' }),
            ],
        });

        expect(mapTypeOrmColumns(table, normalizeOptionalText).map((column) => column.isAutoIncrement)).toEqual([true, false, false]);
    });
});

describe('mapTypeOrmIndexes', () => {
    const metadataRows = [
        { name: 'idx_email', comment: ' lookup ', type: 'FULLTEXT', columnOrder: 'desc' },
        { name: 'idx_email', columnOrder: 'ASC' },
        { name: 'idx_other' },
        { name: 'idx_shape', type: 'btree' },
    ] satisfies MySqlIndexMetadataRow[];

    it('attaches catalog metadata by index name', () => {
        const indexes = [
            new TableIndex({ name: 'idx_email', columnNames: ['email', 'tenant_id'], isUnique: true }),
            new TableIndex({ name: 'idx_other', columnNames: ['other'] }),
            new TableIndex({ columnNames: ['anon_a', 'anon_b'] }),
            new TableIndex({ name: 'idx_shape', columnNames: ['shape'], isSpatial: true }),
        ];

        expect(mapTypeOrmIndexes(indexes, metadataRows, normalizeOptionalText)).toEqual([
            {
                name: 'idx_email',
                columns: ['email', 'tenant_id'],
                orders: ['DESC', 'ASC'],
                comment: 'lookup',
                isUnique: true,
                origin: 'BTREE',
                isPartial: false,
                type: 'FULLTEXT',
            },
            {
                name: 'idx_other',
                columns: ['other'],
                orders: ['NONE'],
                comment: null,
                isUnique: false,
                origin: 'BTREE',
                isPartial: false,
                type: null,
            },
            {
                name: 'anon_a_anon_b',
                columns: ['anon_a', 'anon_b'],
                orders: [],
                comment: null,
                isUnique: false,
                origin: 'BTREE',
                isPartial: false,
                type: null,
            },
            {
                name: 'idx_shape',
                columns: ['shape'],
                orders: ['NONE'],
                comment: null,
                isUnique: false,
                origin: 'SPATIAL',
                isPartial: false,
                type: 'btree',
            },
        ]);
    });

    it('returns empty metadata lists when no catalog rows match', () => {
        const mapped = mapTypeOrmIndexes([new TableIndex({ name: 'idx_missing', columnNames: ['a'] })], [], normalizeOptionalText);

        expect(mapped).toEqual([{ name: 'idx_missing', columns: ['a'], orders: [], comment: null, isUnique: false, origin: 'BTREE', isPartial: false, type: null }]);
    });
});

describe('mapTypeOrmIndexesWithoutMetadata', () => {
    it('maps indexes then uniques with their own flags', () => {
        const indexes = [
            new TableIndex({ name: 'idx_a', columnNames: ['a'] }),
            new TableIndex({ columnNames: ['b', 'c'], where: 'b IS NOT NULL' }),
            new TableIndex({ name: 'idx_blank_where', columnNames: ['d'], where: '' }),
            new TableIndex({ name: 'ft_body', columnNames: ['body'], isFulltext: true }),
        ];
        const uniques = [new TableUnique({ name: 'uq_a', columnNames: ['a'] }), new TableUnique({ columnNames: ['b'] })];

        expect(mapTypeOrmIndexesWithoutMetadata(indexes, uniques, normalizeOptionalText)).toEqual([
            { name: 'idx_a', columns: ['a'], comment: null, isUnique: false, origin: 'index', isPartial: false, type: null },
            { name: 'b_c', columns: ['b', 'c'], comment: null, isUnique: false, origin: 'index', isPartial: true, type: null },
            { name: 'idx_blank_where', columns: ['d'], comment: null, isUnique: false, origin: 'index', isPartial: false, type: null },
            { name: 'ft_body', columns: ['body'], comment: null, isUnique: false, origin: 'index', isPartial: false, type: 'FULLTEXT' },
            { name: 'uq_a', columns: ['a'], comment: null, isUnique: true, origin: 'index', isPartial: false, type: null },
            { name: 'b', columns: ['b'], comment: null, isUnique: true, origin: 'index', isPartial: false, type: null },
        ]);
    });

    it('copies the column list instead of aliasing the typeorm objects', () => {
        const index = new TableIndex({ name: 'idx_a', columnNames: ['a'] });
        const unique = new TableUnique({ name: 'uq_a', columnNames: ['a'] });

        const [mappedIndex, mappedUnique] = mapTypeOrmIndexesWithoutMetadata([index], [unique], normalizeOptionalText);

        expect(mappedIndex?.columns).toEqual(['a']);
        expect(mappedIndex?.columns).not.toBe(index.columnNames);
        expect(mappedUnique?.columns).not.toBe(unique.columnNames);
    });
});

describe('mapTypeOrmForeignKeys', () => {
    it('flattens composite keys with per-column sequences', () => {
        const foreignKeys = [
            new TableForeignKey({ name: 'fk_orders_user', columnNames: ['user_id'], referencedTableName: 'users', referencedColumnNames: ['id'], onUpdate: 'CASCADE', onDelete: 'SET NULL' }),
            new TableForeignKey({ columnNames: ['a', 'b'], referencedTableName: 'composite', referencedColumnNames: ['x'] }),
        ];

        expect(mapTypeOrmForeignKeys(foreignKeys)).toEqual([
            { id: 0, name: 'fk_orders_user', sequence: 0, table: 'users', from: 'user_id', to: 'id', onUpdate: 'CASCADE', onDelete: 'SET NULL', match: 'NONE' },
            { id: 1, name: undefined, sequence: 0, table: 'composite', from: 'a', to: 'x', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
            { id: 1, name: undefined, sequence: 1, table: 'composite', from: 'b', to: '', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
        ]);
    });

    it('returns no rows for no foreign keys', () => {
        expect(mapTypeOrmForeignKeys([])).toEqual([]);
    });
});

describe('mapTypeOrmTableMetadata', () => {
    it('normalizes comment and engine', () => {
        expect(mapTypeOrmTableMetadata(new Table({ name: 'users', comment: '  users table  ', engine: ' InnoDB ' }), normalizeOptionalText)).toEqual({
            comment: 'users table',
            engine: 'InnoDB',
        });
    });

    it('returns nulls for a missing or empty table', () => {
        expect(mapTypeOrmTableMetadata(new Table({ name: 'users' }), normalizeOptionalText)).toEqual({ comment: null, engine: null });
        expect(mapTypeOrmTableMetadata(undefined, normalizeOptionalText)).toEqual({ comment: null, engine: null });
    });
});

describe('getTypeOrmObjectBaseName', () => {
    it('keeps the last dotted segment', () => {
        expect(getTypeOrmObjectBaseName({ name: 'users' })).toBe('users');
        expect(getTypeOrmObjectBaseName({ name: 'public.users' })).toBe('users');
        expect(getTypeOrmObjectBaseName({ name: 'mydb.public.users' })).toBe('users');
        expect(getTypeOrmObjectBaseName(new Table({ name: 'main.orders' }))).toBe('orders');
        expect(getTypeOrmObjectBaseName({ name: 'reporting.v_summary' } satisfies Pick<View, 'name'>)).toBe('v_summary');
    });

    it('keeps an empty trailing segment as an empty name', () => {
        expect(getTypeOrmObjectBaseName({ name: 'public.' })).toBe('');
        expect(getTypeOrmObjectBaseName({ name: '' })).toBe('');
    });
});
