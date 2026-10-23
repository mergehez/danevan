import { describe, expect, it } from 'vitest';
import { buildPreviewStatements, hasExtendedSchemaChanges, resolveForeignKeyDraftName, type ModifyTablePreviewState } from '../../composables/useModifyTable';

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
                isPrimaryKey: false,
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
        isPrimaryKey: false,
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
        isPrimaryKey: false,
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

/** A SQLite table with a standalone index, as `getTableInfo` reports it. */
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
            { name: 'caps_created_by_idx', columns: ['created_by'], isUnique: false, type: null, comment: null, origin: 'c', isPartial: false },
            { name: 'caps_path_unique', columns: ['path'], isUnique: true, type: null, comment: null, origin: 'u', isPartial: false },
        ],
        foreignKeys: [],
    } as unknown as ModifyTablePreviewState['currentTableInfo'];
    state.keys = [
        { id: 'primary', originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, status: 'existing', columns: [{ id: 'key-column:1', columnName: 'id' }] },
        {
            id: 'existing:caps_path_unique',
            originalName: 'caps_path_unique',
            name: 'caps_path_unique',
            isPrimary: false,
            status: 'existing',
            columns: [{ id: 'key-column:2', columnName: 'path' }],
        },
    ];
    state.indexes = [
        {
            id: 'existing:caps_created_by_idx',
            originalName: 'caps_created_by_idx',
            name: 'caps_created_by_idx',
            comment: '',
            isUnique: false,
            type: 'btree',
            status: 'existing',
            isPrimaryKey: false,
            columns: [{ id: 'index-column:5', columnName: 'created_by', order: 'NONE' }],
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
        state.indexes = [];

        expect(buildPreviewStatements(state).join('\n')).not.toContain('caps_created_by_idx');
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
            isPrimaryKey: false,
            columns: [{ id: 'index-column:6', columnName: 'path', order: 'NONE' }],
        });

        expect(buildPreviewStatements(state).join('\n')).toContain('CREATE INDEX "caps_size_idx"');
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
