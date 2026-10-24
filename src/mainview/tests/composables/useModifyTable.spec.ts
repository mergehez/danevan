import { describe, expect, it } from 'vitest';
import { buildPreviewStatements, hasExtendedSchemaChanges, resolveForeignKeyDraftName, type ModifyTablePreviewState } from '../../composables/useModifyTable';
import { createIndexColumnDraft, createNewForeignKey, createNewIndex, resolveForeignKeyTargetTable, syncAutoEntityNames } from '../../composables/modifyTable/drafts';

describe('resolveForeignKeyDraftName', () => {
    it('prefers the matching foreign index name when mysql foreign key rows are unnamed', () => {
        const name = resolveForeignKeyDraftName(
            'key_values',
            {
                indexes: [
                    {
                        name: 'key_values_created_by_foreign',
                        columns: ['created_by'],
                        comment: null,
                        isUnique: false,
                        origin: 'BTREE',
                        isPartial: false,
                        type: 'BTREE',
                        orders: ['A'],
                    },
                    {
                        name: 'key_values_updated_by_foreign',
                        columns: ['updated_by'],
                        comment: null,
                        isUnique: false,
                        origin: 'BTREE',
                        isPartial: false,
                        type: 'BTREE',
                        orders: ['A'],
                    },
                ],
            },
            [
                {
                    id: 0,
                    sequence: 0,
                    table: 'users',
                    from: 'created_by',
                    to: 'id',
                    onUpdate: 'NO ACTION',
                    onDelete: 'NO ACTION',
                    match: 'NONE',
                },
            ],
            '0'
        );

        expect(name).toBe('key_values_created_by_foreign');
    });

    it('keeps the explicit foreign key name when the driver provides it', () => {
        const name = resolveForeignKeyDraftName(
            'key_values',
            { indexes: [] },
            [
                {
                    id: 0,
                    name: 'key_values_created_by_foreign',
                    sequence: 0,
                    table: 'users',
                    from: 'created_by',
                    to: 'id',
                    onUpdate: 'NO ACTION',
                    onDelete: 'NO ACTION',
                    match: 'NONE',
                },
            ],
            '0'
        );

        expect(name).toBe('key_values_created_by_foreign');
    });
});

/**
 * The dialog's MySQL shape: `information_schema.statistics` reports every index *except* `PRIMARY`
 * (the dialog synthesizes that draft), with the catalog's own column orders.
 */
function mysqlState(): ModifyTablePreviewState {
    const currentTableInfo = {
        name: 'caps',
        comment: null,
        engine: 'InnoDB',
        collation: null,
        options: null,
        columns: [
            { name: 'id', type: 'bigint', isPrimaryKey: true, primaryKeyOrdinal: 1 },
            { name: 'path', type: 'varchar(200)', isPrimaryKey: false, primaryKeyOrdinal: null },
            { name: 'created_by', type: 'bigint', isPrimaryKey: false, primaryKeyOrdinal: null },
        ],
        indexes: [
            { name: 'caps_created_by_foreign', columns: ['created_by'], orders: ['ASC'], isUnique: false, type: 'BTREE', comment: null, origin: 'BTREE', isPartial: false },
            { name: 'caps_path_unique', columns: ['path'], orders: ['ASC'], isUnique: true, type: 'BTREE', comment: null, origin: 'BTREE', isPartial: false },
        ],
        foreignKeys: [],
    } as unknown as ModifyTablePreviewState['currentTableInfo'];

    const column = (name: string, type: string) => ({ name, type, notNull: false, defaultValue: null, isPrimaryKey: false, primaryKeyOrdinal: null, isAutoIncrement: false });

    const columns = [column('id', 'bigint'), column('path', 'varchar(200)'), column('created_by', 'bigint')].map((entry) => ({
        ...entry,
        id: `existing:${entry.name}`,
        originalName: entry.name,
        status: 'existing' as const,
        hidden: false,
        columnKind: 'NORMAL',
        comment: null,
        collation: null,
        onUpdate: null,
    }));

    return {
        mode: 'edit',
        tableName: 'caps',
        driver: 'mysql',
        currentTableInfo,
        existingTableNames: ['caps'],
        allowTableRebuild: false,
        table: { name: 'caps', comment: '', engine: 'InnoDB', collation: '', options: '' },
        originalColumns: columns.map((entry) => ({ ...entry })),
        columns,
        keys: [
            {
                id: 'primary',
                originalName: 'PRIMARY',
                name: 'PRIMARY',
                isPrimary: true,
                status: 'existing',
                columns: [{ id: 'key-column:1', columnName: 'id' }],
            },
            {
                id: 'existing:caps_path_unique',
                originalName: 'caps_path_unique',
                name: 'caps_path_unique',
                isPrimary: false,
                status: 'existing',
                columns: [{ id: 'key-column:2', columnName: 'path' }],
            },
        ],
        foreignKeys: [],
        indexes: [
            {
                id: 'existing:caps_created_by_foreign',
                originalName: 'caps_created_by_foreign',
                name: 'caps_created_by_foreign',
                comment: '',
                isUnique: false,
                type: 'BTREE',
                status: 'existing',
                columns: [{ id: 'index-column:2', columnName: 'created_by', order: 'ASC' }],
            },
        ],
    };
}

/** A real index on the primary-key column, next to the primary key itself. */
function indexOverPrimaryKey() {
    return {
        id: 'existing:caps_id_idx',
        originalName: 'caps_id_idx',
        name: 'caps_id_idx',
        comment: '',
        isUnique: false,
        type: 'BTREE',
        status: 'existing' as const,
        columns: [{ id: 'index-column:5', columnName: 'id', order: 'ASC' }],
    };
}

function withIndexOverPrimaryKey() {
    const state = mysqlState();
    state.currentTableInfo!.indexes.push({
        name: 'caps_id_idx',
        columns: ['id'],
        orders: ['ASC'],
        isUnique: false,
        type: 'BTREE',
        comment: null,
        origin: 'BTREE',
        isPartial: false,
    });
    state.indexes.push(indexOverPrimaryKey());
    return state;
}

function addedIndex() {
    return {
        id: 'new:1',
        name: 'new_index',
        comment: '',
        isUnique: false,
        type: 'btree',
        status: 'new' as const,
        // "Add index" starts on the first column, which is also the primary key on most tables.
        columns: [{ id: 'index-column:4', columnName: 'id', order: 'NONE' }],
    };
}

describe('hasExtendedSchemaChanges', () => {
    it('reports no change for the untouched draft', () => {
        expect(hasExtendedSchemaChanges(mysqlState())).toBe(false);
    });

    it('reports an added index', () => {
        const state = mysqlState();
        state.indexes.push(addedIndex());

        expect(hasExtendedSchemaChanges(state)).toBe(true);
    });

    it('reports a deleted index over the primary-key column', () => {
        const state = withIndexOverPrimaryKey();
        state.indexes = state.indexes.filter((index) => index.name !== 'caps_id_idx');

        expect(hasExtendedSchemaChanges(state)).toBe(true);
    });
});

/**
 * A SQLite table as `getTableInfo` reports it: TypeORM lists the `UNIQUE` constraint under `uniques`
 * (origin `unique`, with a generated name) and the user's indexes under `indices` (origin `index`).
 */
function sqliteState(): ModifyTablePreviewState {
    const state = mysqlState();
    state.driver = 'sqlite';
    state.table = { name: 'caps', comment: '', engine: '', collation: '', options: '' };
    state.currentTableInfo = {
        name: 'caps',
        columns: [
            { name: 'id', type: 'integer', isPrimaryKey: true, primaryKeyOrdinal: 1 },
            { name: 'path', type: 'text', isPrimaryKey: false, primaryKeyOrdinal: null },
            { name: 'created_by', type: 'integer', isPrimaryKey: false, primaryKeyOrdinal: null },
        ],
        indexes: [
            { name: 'UQ_2371ce3ffc7b688946d7500e689', columns: ['created_by'], isUnique: true, type: null, comment: null, origin: 'unique', isPartial: false },
            { name: 'caps_path_idx', columns: ['path'], isUnique: false, type: null, comment: null, origin: 'index', isPartial: false },
            { name: 'caps_path_unique', columns: ['path'], isUnique: true, type: null, comment: null, origin: 'index', isPartial: false },
        ],
        foreignKeys: [],
    } as unknown as ModifyTablePreviewState['currentTableInfo'];
    // The unique constraint (an autoindex) is a key; the named unique index is a plain index.
    state.keys = [
        { id: 'primary', originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, status: 'existing', columns: [{ id: 'key-column:1', columnName: 'id' }] },
        {
            id: 'existing:UQ_2371ce3ffc7b688946d7500e689',
            originalName: 'UQ_2371ce3ffc7b688946d7500e689',
            name: 'UQ_2371ce3ffc7b688946d7500e689',
            isPrimary: false,
            status: 'existing',
            columns: [{ id: 'key-column:2', columnName: 'created_by' }],
        },
    ];
    state.indexes = [
        {
            id: 'existing:caps_path_idx',
            originalName: 'caps_path_idx',
            name: 'caps_path_idx',
            comment: '',
            isUnique: false,
            type: 'btree',
            status: 'existing',
            columns: [{ id: 'index-column:5', columnName: 'path', order: 'NONE' }],
        },
        {
            id: 'existing:caps_path_unique',
            originalName: 'caps_path_unique',
            name: 'caps_path_unique',
            comment: '',
            isUnique: true,
            type: 'btree',
            status: 'existing',
            columns: [{ id: 'index-column:6', columnName: 'path', order: 'NONE' }],
        },
    ];
    return state;
}

describe('buildPreviewStatements', () => {
    it('plans nothing for the untouched draft', () => {
        expect(buildPreviewStatements(mysqlState())).toEqual([]);
    });

    it('plans an added index that covers the primary-key column', () => {
        const state = mysqlState();
        state.indexes.push(addedIndex());

        // The index is not the primary key just because it indexes the same column.
        expect(buildPreviewStatements(state)).toEqual(['ALTER TABLE `caps` ADD INDEX `new_index` (`id`) USING btree;']);
    });

    it('plans nothing for an existing index over the primary-key column', () => {
        expect(buildPreviewStatements(withIndexOverPrimaryKey())).toEqual([]);
    });

    it('plans the deletion of an index over the primary-key column', () => {
        const state = withIndexOverPrimaryKey();
        state.indexes = state.indexes.filter((index) => index.name !== 'caps_id_idx');

        expect(buildPreviewStatements(state)).toEqual(['ALTER TABLE `caps` DROP INDEX `caps_id_idx`;']);
    });

    it('shows a deleted SQLite index gone from the rebuilt table', () => {
        const state = sqliteState();
        state.indexes = state.indexes.filter((index) => index.name !== 'caps_path_idx');

        const sql = buildPreviewStatements(state).join('\n');
        expect(sql).not.toContain('caps_path_idx');
        // A named unique index is not a constraint: the rebuild keeps its name.
        expect(sql).toContain('CREATE UNIQUE INDEX "caps_path_unique"');
        // The unique constraint is rebuilt inline, under no user name.
        expect(sql).toContain('UNIQUE ("created_by")');
    });

    it('plans a new SQLite index in the rebuilt table', () => {
        const state = sqliteState();
        state.indexes.push({
            id: 'new:1',
            name: 'caps_size_idx',
            comment: '',
            isUnique: false,
            type: 'btree',
            status: 'new',
            columns: [{ id: 'index-column:7', columnName: 'path', order: 'NONE' }],
        });

        expect(buildPreviewStatements(state).join('\n')).toContain('CREATE INDEX "caps_size_idx"');
    });

    it('treats a PostgreSQL unique constraint as a key and a unique index as an index', () => {
        const state = mysqlState();
        state.driver = 'postgresql';
        state.currentTableInfo!.indexes = [
            // TypeORM's `uniques`, which the mapper marks `unique`.
            { name: 'caps_path_key', columns: ['path'], orders: [], isUnique: true, type: null, comment: null, origin: 'unique', isPartial: false },
            // A plain unique index (`indices`), which is not a constraint.
            { name: 'ix_created', columns: ['created_by'], orders: [], isUnique: true, type: 'BTREE', comment: null, origin: 'index', isPartial: false },
        ];
        state.keys = [
            { id: 'primary', originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, status: 'existing', columns: [{ id: 'key-column:1', columnName: 'id' }] },
            {
                id: 'existing:caps_path_key',
                originalName: 'caps_path_key',
                name: 'caps_path_key',
                isPrimary: false,
                status: 'existing',
                columns: [{ id: 'key-column:2', columnName: 'path' }],
            },
        ];
        state.indexes = [
            {
                id: 'existing:ix_created',
                originalName: 'ix_created',
                name: 'ix_created',
                comment: '',
                isUnique: true,
                type: 'BTREE',
                status: 'existing',
                columns: [{ id: 'index-column:1', columnName: 'created_by', order: 'NONE' }],
            },
        ];

        // Neither one is a pending change, and the unique index is an index: deleting it drops it.
        expect(buildPreviewStatements(state)).toEqual([]);
        state.indexes = [];
        expect(buildPreviewStatements(state)).toEqual(['DROP INDEX "ix_created";']);
    });

    it('plans an index over the primary-key column of a table being created', () => {
        const state = mysqlState();
        state.mode = 'create';
        state.tableName = undefined;
        state.table.name = 'caps';
        state.currentTableInfo = undefined;
        state.existingTableNames = [];
        state.keys = [];
        state.indexes = [addedIndex()];

        expect(buildPreviewStatements(state)).toContain('ALTER TABLE `caps` ADD INDEX `new_index` (`id`) USING btree;');
    });
});

describe('auto-generated index and foreign-key names', () => {
    function namingHost() {
        return {
            table: { name: 'orders' },
            tableName: 'orders',
            indexes: [createNewIndex([], ['id'], 'orders')],
            foreignKeys: [createNewForeignKey([], ['customer_id'], 'orders')],
        };
    }

    it('names a new index and a new foreign key from the table and the columns', () => {
        const state = namingHost();

        expect(state.indexes[0]!.name).toBe('IX_orders_id');
        expect(state.foreignKeys[0]!.name).toBe('FK_orders_customer_id');
    });

    it('follows the table name, the index columns and the foreign-key target', () => {
        const state = namingHost();

        state.table.name = 'invoices';
        syncAutoEntityNames(state);
        expect(state.indexes[0]!.name).toBe('IX_invoices_id');

        state.indexes[0]!.columns[0]!.columnName = 'total';
        state.indexes[0]!.columns.push(createIndexColumnDraft('currency'));
        syncAutoEntityNames(state);
        expect(state.indexes[0]!.name).toBe('IX_invoices_total_currency');

        state.foreignKeys[0]!.targetTable = 'customers';
        syncAutoEntityNames(state);
        expect(state.foreignKeys[0]!.name).toBe('FK_invoices_customer_id_customers');
    });

    it('keeps a name the user typed', () => {
        const state = namingHost();

        state.indexes[0]!.name = 'my_index';
        syncAutoEntityNames(state);

        state.indexes[0]!.columns[0]!.columnName = 'size';
        syncAutoEntityNames(state);

        expect(state.indexes[0]!.name).toBe('my_index');
    });

    it('suffixes a generated name another draft already holds', () => {
        const state = namingHost();

        state.indexes.push(createNewIndex(state.indexes, ['id'], 'orders'));
        syncAutoEntityNames(state);

        expect(state.indexes.map((index) => index.name)).toEqual(['IX_orders_id', 'IX_orders_id_2']);

        state.foreignKeys.push(createNewForeignKey(state.foreignKeys, ['customer_id'], 'orders'));
        state.foreignKeys[1]!.targetTable = '';
        syncAutoEntityNames(state);
        expect(state.foreignKeys[1]!.name).toBe('FK_orders_customer_id_2');
    });
});

describe('resolveForeignKeyTargetTable', () => {
    it('finds the table a <name>_id column points at', () => {
        expect(resolveForeignKeyTargetTable('user_id', ['users', 'posts'])).toBe('users');
        expect(resolveForeignKeyTargetTable('customer_id', ['customers'])).toBe('customers');
        expect(resolveForeignKeyTargetTable('address_id', ['addresses'])).toBe('addresses');
        expect(resolveForeignKeyTargetTable('category_id', ['categories'])).toBe('categories');
        // Sometimes the table is the bare name.
        expect(resolveForeignKeyTargetTable('tenant_id', ['tenant'])).toBe('tenant');
        // Matched case-insensitively, returning the catalog's own spelling.
        expect(resolveForeignKeyTargetTable('user_id', ['Users'])).toBe('Users');
    });

    it('leaves the target alone when no table matches or the name is not a reference', () => {
        expect(resolveForeignKeyTargetTable('foo_user_id', ['users'])).toBeUndefined();
        expect(resolveForeignKeyTargetTable('created_by', ['users'])).toBeUndefined();
        expect(resolveForeignKeyTargetTable('id', ['users'])).toBeUndefined();
        expect(resolveForeignKeyTargetTable('user_id', [])).toBeUndefined();
    });
});
