import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '../../shared/types';
import type { ComparisonFixAction } from './compareSchemas';
import { buildFixTableInfo, getFixActionTitle, toModifyTableParams } from './schemaFix';

function column(overrides: Partial<TableColumnInfo> & { name: string }): TableColumnInfo {
    return {
        cid: 0,
        type: 'int',
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
        ...overrides,
    };
}

function index(overrides: Partial<TableIndexInfo> & { name: string; columns: string[] }): TableIndexInfo {
    return { isUnique: false, origin: 'c', isPartial: false, ...overrides };
}

function foreignKey(overrides: Partial<TableForeignKeyInfo> & { id: number; from: string; to: string }): TableForeignKeyInfo {
    return { sequence: 0, table: 'customers', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE', ...overrides };
}

function table(overrides: Partial<TableInfo> & { name: string }): TableInfo {
    return { columns: [], indexes: [], foreignKeys: [], rowCount: 0, ...overrides };
}

describe('buildFixTableInfo', () => {
    it('appends an added column without touching the rest of the table', () => {
        const destination = table({ name: 'users', columns: [column({ name: 'id' })], engine: 'InnoDB' });
        const email = column({ name: 'email', type: 'text' });
        const action: ComparisonFixAction = { kind: 'add-column', destination: 'target', tableName: 'users', label: 'column "email"', column: email };

        const next = buildFixTableInfo(destination, action);

        expect(next?.columns.map((entry) => entry.name)).toEqual(['id', 'email']);
        expect(next?.engine).toBe('InnoDB');
        // The original object is not mutated.
        expect(destination.columns).toHaveLength(1);
    });

    it('appends a unique key through its raw index', () => {
        const destination = table({ name: 'users', columns: [column({ name: 'email' })] });
        const emailIndex = index({ name: 'users_email_key', columns: ['email'], isUnique: true, origin: 'u' });
        const action: ComparisonFixAction = {
            kind: 'add-key',
            destination: 'source',
            tableName: 'users',
            label: 'unique key "users_email_key"',
            key: { name: 'users_email_key', isPrimary: false, columns: ['email'], index: emailIndex },
        };

        expect(buildFixTableInfo(destination, action)?.indexes).toEqual([emailIndex]);
    });

    it('marks the donor primary-key columns when adding a primary key', () => {
        const destination = table({ name: 'users', columns: [column({ name: 'id' }), column({ name: 'email' })] });
        const action: ComparisonFixAction = {
            kind: 'add-key',
            destination: 'target',
            tableName: 'users',
            label: 'primary key (id)',
            key: { name: 'PRIMARY', isPrimary: true, columns: ['id'], primaryColumns: [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })] },
        };

        const next = buildFixTableInfo(destination, action);

        expect(next?.columns[0]).toMatchObject({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 });
        expect(next?.columns[1]).toMatchObject({ name: 'email', isPrimaryKey: false });
    });

    it('appends foreign keys and indexes', () => {
        const destination = table({ name: 'orders', columns: [column({ name: 'customer_id' }), column({ name: 'code' })] });
        const fk = foreignKey({ id: 3, name: 'fk_orders_customer', from: 'customer_id', to: 'id' });
        const codeIndex = index({ name: 'orders_code_idx', columns: ['code'] });

        const withForeignKey = buildFixTableInfo(destination, { kind: 'add-foreign-key', destination: 'target', tableName: 'orders', label: 'fk', foreignKeys: [fk] });
        const withIndex = buildFixTableInfo(destination, { kind: 'add-index', destination: 'target', tableName: 'orders', label: 'idx', index: codeIndex });

        expect(withForeignKey?.foreignKeys).toEqual([fk]);
        expect(withIndex?.indexes).toEqual([codeIndex]);
    });

    it('has nothing to build for a create-table fix', () => {
        expect(buildFixTableInfo(table({ name: 'menus' }), { kind: 'create-table', destination: 'target', tableName: 'menus', label: 'table "menus"' })).toBeUndefined();
    });
});

describe('toModifyTableParams', () => {
    it('maps a whole table definition onto the plan the backend executes', () => {
        const info = table({
            name: 'users',
            comment: 'people',
            engine: 'InnoDB',
            collation: 'utf8mb4_general_ci',
            columns: [
                column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1, isAutoIncrement: true }),
                column({ name: 'email', type: 'text', notNull: true, defaultValue: 'none' }),
                column({ name: 'team_id' }),
                column({ name: 'created_at', type: 'datetime' }),
            ],
            indexes: [
                index({ name: 'users_email_key', columns: ['email'], isUnique: true, origin: 'u' }),
                index({ name: 'users_created_idx', columns: ['created_at'], type: 'btree', orders: ['DESC'] }),
            ],
            foreignKeys: [foreignKey({ id: 1, name: 'fk_users_team', table: 'teams', from: 'team_id', to: 'id', onUpdate: 'CASCADE' })],
        });

        const params = toModifyTableParams(7, info);

        expect(params.connectionId).toBe(7);
        expect(params.tableName).toBe('users');
        expect(params.table).toEqual({ name: 'users', comment: 'people', engine: 'InnoDB', collation: 'utf8mb4_general_ci', options: null });
        expect(params.columns?.map((entry) => entry.name)).toEqual(['id', 'email', 'team_id', 'created_at']);
        expect(params.columns?.[0]).toMatchObject({ originalName: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1, isAutoIncrement: true });
        expect(params.columns?.[1]).toMatchObject({ originalName: 'email', notNull: true, defaultValue: 'none' });
        // Unique keys become keys; only non-unique standalone indexes stay indexes.
        expect(params.keys).toEqual([
            { originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
            { originalName: 'users_email_key', name: 'users_email_key', isPrimary: false, columns: [{ columnName: 'email' }] },
        ]);
        expect(params.indexes).toEqual([
            { originalName: 'users_created_idx', name: 'users_created_idx', comment: null, isUnique: false, type: 'btree', columns: [{ columnName: 'created_at', order: 'DESC' }] },
        ]);
        expect(params.foreignKeys).toEqual([
            {
                originalName: 'fk_users_team',
                name: 'fk_users_team',
                targetTable: 'teams',
                columns: [{ columnName: 'team_id', targetName: 'id' }],
                onUpdate: 'CASCADE',
                onDelete: 'NO ACTION',
                match: 'NONE',
            },
        ]);
    });
});

describe('getFixActionTitle', () => {
    it('names the object the confirmation adds', () => {
        expect(getFixActionTitle({ kind: 'add-column', destination: 'target', tableName: 'users', label: '' })).toBe('Add column?');
        expect(getFixActionTitle({ kind: 'add-index', destination: 'target', tableName: 'users', label: '' })).toBe('Add index?');
        expect(getFixActionTitle({ kind: 'add-foreign-key', destination: 'target', tableName: 'users', label: '' })).toBe('Add foreign key?');
        expect(getFixActionTitle({ kind: 'create-table', destination: 'target', tableName: 'users', label: '' })).toBe('Create table?');
        expect(getFixActionTitle({ kind: 'add-key', destination: 'target', tableName: 'users', label: '', key: { name: 'PRIMARY', isPrimary: true, columns: ['id'] } })).toBe(
            'Add primary key?'
        );
        expect(getFixActionTitle({ kind: 'add-key', destination: 'target', tableName: 'users', label: '', key: { name: 'k', isPrimary: false, columns: ['id'] } })).toBe(
            'Add unique key?'
        );
    });
});
