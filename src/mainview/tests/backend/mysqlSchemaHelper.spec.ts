// What the MySQL catalog hands back is not what a statement can be built from: the sort order of
// an index column arrives as `A`/`D` and a string default as the bare literal, so both are mapped
// to SQL here — the layer Modify Table re-emits verbatim.
import { describe, expect, it, vi } from 'vitest';
import { useMySqlSchemaHelper } from '../../../backend/useMySqlDriver';
import type { RemoteDriverClient } from '../../../backend/useRemoteDriverTools';

const schemaHelperDeps = {
    escapeSqlString: (value: string) => `'${value.replaceAll("'", "''")}'`,
    normalizeOptionalText: (value: string | null | undefined) => value?.trim() || null,
    quoteRemoteIdentifier: (_driver: 'mysql', identifier: string) => `\`${identifier}\``,
};

function rowsQuery(rows: unknown[]) {
    return vi.fn(async () => rows);
}

function createClient(queryRows: ReturnType<typeof rowsQuery>) {
    return { queryRows } as unknown as RemoteDriverClient;
}

function columnRow(overrides: Record<string, unknown>) {
    return {
        ordinalPosition: 1,
        name: 'col',
        columnType: 'varchar(50)',
        isNullable: 'YES',
        columnDefault: null,
        columnKey: '',
        extra: '',
        comment: '',
        collation: null,
        ...overrides,
    };
}

describe('useMySqlSchemaHelper.getColumns defaults', () => {
    it('quotes the literal a character, binary or temporal column declares', async () => {
        const queryRows = rowsQuery([
            columnRow({ name: 'label', columnType: 'varchar(50)', isNullable: 'NO', columnDefault: 'guest' }),
            columnRow({ name: 'note', columnType: 'varchar(50)', columnDefault: '' }),
            columnRow({ name: 'path', columnType: 'varchar(200)', columnDefault: 'C:\\temp' }),
            columnRow({ name: 'created_at', columnType: 'datetime', isNullable: 'NO', columnDefault: 'CURRENT_TIMESTAMP' }),
            columnRow({ name: 'height', columnType: 'int unsigned', isNullable: 'NO', columnDefault: '0' }),
            columnRow({ name: 'uid', columnType: 'binary(16)', columnDefault: "it's" }),
            columnRow({ name: 'plain', columnType: 'varchar(50)', columnDefault: null }),
        ]);

        const columns = await useMySqlSchemaHelper(schemaHelperDeps).getTableColumns(createClient(queryRows), 'caps');

        expect(columns.map((column) => [column.name, column.defaultValue])).toEqual([
            ['label', "'guest'"],
            ['note', "''"],
            ['path', "'C:\\\\temp'"],
            ['created_at', 'CURRENT_TIMESTAMP'],
            ['height', '0'],
            ['uid', "'it''s'"],
            ['plain', null],
        ]);
    });
});

describe('useMySqlSchemaHelper.getIndexes order', () => {
    it('reports the sort order MySQL accepts instead of the catalog letter', async () => {
        const queryRows = rowsQuery([
            { name: 'idx_caps', columnName: 'path', comment: '', type: 'BTREE', nonUnique: 1, seqInIndex: 1, columnOrder: 'A' },
            { name: 'idx_caps', columnName: 'created_at', comment: '', type: 'BTREE', nonUnique: 1, seqInIndex: 2, columnOrder: 'D' },
        ]);

        const indexes = await useMySqlSchemaHelper(schemaHelperDeps).getIndexes(createClient(queryRows), 'caps');

        expect(indexes).toEqual([
            {
                name: 'idx_caps',
                columns: ['path', 'created_at'],
                orders: ['ASC', 'DESC'],
                comment: null,
                isUnique: false,
                origin: 'BTREE',
                isPartial: false,
                type: 'BTREE',
            },
        ]);
    });

    it('reports no order for an index column the catalog does not order', async () => {
        const queryRows = rowsQuery([{ name: 'idx_caps', columnName: 'body', comment: '', type: 'FULLTEXT', nonUnique: 1, seqInIndex: 1, columnOrder: null }]);

        const indexes = await useMySqlSchemaHelper(schemaHelperDeps).getIndexes(createClient(queryRows), 'caps');

        expect(indexes[0]?.orders).toEqual(['NONE']);
    });
});
