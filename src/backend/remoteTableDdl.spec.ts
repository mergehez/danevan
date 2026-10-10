// The shared modify-plan plumbing decides which key/index the drivers compare and which columns
// they drop. A mistake here means a table is altered when nothing changed, or a rename is read as
// a drop, so these drive the real helpers with real plan fixtures.
import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '../shared/types';
import {
    buildDropColumnStatements,
    buildIndexColumns,
    buildPrimaryKeyFromColumns,
    foreignKeySignature,
    getCurrentPrimaryKey,
    getCurrentUniqueKeys,
    getDesiredPrimaryKey,
    getDroppedColumns,
    groupCurrentForeignKeys,
    keySignature,
    serializeColumns,
    serializeIndexColumns,
} from './remoteTableDdl.ts';
import type { ModifySchemaColumn, ModifySchemaPlan } from './useSqliteDriver.ts';

function column(overrides: Partial<ModifySchemaColumn> = {}): ModifySchemaColumn {
    return {
        name: 'name',
        type: 'varchar(255)',
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

function columnInfo(overrides: Partial<TableColumnInfo> = {}): TableColumnInfo {
    return {
        cid: 0,
        name: 'name',
        type: 'varchar(255)',
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

function indexInfo(overrides: Partial<TableIndexInfo> = {}): TableIndexInfo {
    return { name: 'idx_name', columns: [], isUnique: false, origin: '', isPartial: false, ...overrides };
}

function foreignKeyInfo(overrides: Partial<TableForeignKeyInfo> = {}): TableForeignKeyInfo {
    return { id: 1, name: 'fk_owner', sequence: 0, table: 'users', from: 'owner_id', to: 'id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE', ...overrides };
}

function tableInfo(overrides: Partial<TableInfo> = {}): TableInfo {
    return { name: 'orders', columns: [], indexes: [], foreignKeys: [], rowCount: 0, ...overrides };
}

function plan(overrides: Partial<ModifySchemaPlan> = {}): ModifySchemaPlan {
    return {
        table: { name: 'orders', comment: null, engine: null, collation: null, options: null },
        columns: [],
        keys: [],
        foreignKeys: [],
        indexes: [],
        ...overrides,
    };
}

const quote = (identifier: string) => `"${identifier}"`;

describe('serializeColumns', () => {
    it('joins lower-cased names so casing never looks like a change', () => {
        expect(serializeColumns(['ID', 'Owner_ID'])).toBe('id|owner_id');
        expect(serializeColumns([])).toBe('');
    });
});

describe('serializeIndexColumns', () => {
    it('keeps the sort order and treats a missing one as the empty string', () => {
        expect(
            serializeIndexColumns([
                { columnName: 'Created', order: 'desc' },
                { columnName: 'id', order: null },
            ])
        ).toBe('created:DESC|id:');
    });
});

describe('buildPrimaryKeyFromColumns', () => {
    it('orders the key columns by ordinal, not by column order', () => {
        const key = buildPrimaryKeyFromColumns([
            column({ name: 'tenant', isPrimaryKey: true, primaryKeyOrdinal: 2 }),
            column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
        ]);

        expect(key).toEqual({ name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }, { columnName: 'tenant' }] });
    });

    it('sorts a column without an ordinal last', () => {
        const key = buildPrimaryKeyFromColumns([
            column({ name: 'late', isPrimaryKey: true, primaryKeyOrdinal: null }),
            column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
        ]);

        expect(key?.columns).toEqual([{ columnName: 'id' }, { columnName: 'late' }]);
    });

    it('keeps the column order for key columns that share no ordinal', () => {
        const key = buildPrimaryKeyFromColumns([
            column({ name: 'tenant', isPrimaryKey: true, primaryKeyOrdinal: null }),
            column({ name: 'region', isPrimaryKey: true, primaryKeyOrdinal: null }),
            column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
        ]);

        expect(key?.columns).toEqual([{ columnName: 'id' }, { columnName: 'tenant' }, { columnName: 'region' }]);
    });

    it('returns undefined when no column is flagged', () => {
        expect(buildPrimaryKeyFromColumns([column({ name: 'id' })])).toBeUndefined();
    });
});

describe('getDesiredPrimaryKey', () => {
    it('prefers an explicit key over the flagged columns', () => {
        const key = getDesiredPrimaryKey(
            plan({
                columns: [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })],
                keys: [{ name: 'orders_pk', isPrimary: true, columns: [{ columnName: 'code' }] }],
            })
        );

        expect(key).toEqual({ name: 'orders_pk', isPrimary: true, columns: [{ columnName: 'code' }] });
    });

    it('falls back to the columns flagged as primary', () => {
        const key = getDesiredPrimaryKey(plan({ columns: [column({ name: 'code', isPrimaryKey: true, primaryKeyOrdinal: 1 })] }));

        expect(key).toEqual({ name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'code' }] });
    });
});

describe('getCurrentPrimaryKey', () => {
    it('reads the primary key out of the current columns', () => {
        const key = getCurrentPrimaryKey(tableInfo({ columns: [columnInfo({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })] }));

        expect(key).toEqual({ name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] });
    });
});

describe('getCurrentUniqueKeys', () => {
    it('keeps unique indexes and excludes the one that is the primary key', () => {
        const keys = getCurrentUniqueKeys(
            tableInfo({
                columns: [columnInfo({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })],
                indexes: [indexInfo({ name: 'PRIMARY', columns: ['id'], isUnique: true }), indexInfo({ name: 'uq_email', columns: ['email'], isUnique: true })],
            })
        );

        expect(keys).toEqual([{ name: 'uq_email', isPrimary: false, columns: [{ columnName: 'email' }] }]);
    });

    it('ignores a non-unique index', () => {
        expect(getCurrentUniqueKeys(tableInfo({ indexes: [indexInfo({ name: 'ix_email', columns: ['email'], isUnique: false })] }))).toEqual([]);
    });
});

describe('groupCurrentForeignKeys', () => {
    it('groups the column pairs of one constraint in sequence order', () => {
        const groups = groupCurrentForeignKeys(
            tableInfo({
                foreignKeys: [
                    foreignKeyInfo({ name: 'fk_owner', sequence: 1, from: 'owner_tenant', to: 'tenant' }),
                    foreignKeyInfo({ name: 'fk_owner', sequence: 0, from: 'owner_id', to: 'id' }),
                ],
            })
        );

        expect(groups).toEqual([
            {
                name: 'fk_owner',
                targetTable: 'users',
                columns: [
                    { columnName: 'owner_id', targetName: 'id' },
                    { columnName: 'owner_tenant', targetName: 'tenant' },
                ],
                onUpdate: 'NO ACTION',
                onDelete: 'NO ACTION',
                match: 'NONE',
            },
        ]);
    });

    it('falls back to the foreign-key id when a constraint is unnamed', () => {
        const groups = groupCurrentForeignKeys(tableInfo({ foreignKeys: [foreignKeyInfo({ id: 7, name: undefined })] }));

        expect(groups.map((group) => group.name)).toEqual(['7']);
    });
});

describe('keySignature', () => {
    it('compares column names case-insensitively', () => {
        expect(keySignature({ columns: [{ columnName: 'ID' }, { columnName: 'tenant' }] })).toBe('id|tenant');
        expect(keySignature(undefined)).toBe('');
    });
});

describe('foreignKeySignature', () => {
    it('compares the target, the column pairs and the referential actions', () => {
        const base = { name: 'fk', targetTable: 'Users', columns: [{ columnName: 'Owner_ID', targetName: 'ID' }], onDelete: 'CASCADE', onUpdate: null, match: null };

        expect(foreignKeySignature(base)).toBe('users::owner_id=>id::cascade::::');
        expect(foreignKeySignature({ ...base, onDelete: 'SET_NULL' })).not.toBe(foreignKeySignature(base));
        expect(foreignKeySignature({ ...base, onDelete: null })).toBe(foreignKeySignature({ ...base, onDelete: '' }));
    });
});

describe('getDroppedColumns', () => {
    it('follows a rename through originalName instead of dropping the column', () => {
        const dropped = getDroppedColumns(tableInfo({ columns: [columnInfo({ name: 'owner_id' }), columnInfo({ name: 'legacy_note' })] }), [
            column({ name: 'owner_ref', originalName: 'owner_id' }),
        ]);

        expect(dropped.map((column) => column.name)).toEqual(['legacy_note']);
    });

    it('keeps a column the plan re-sends under the same name', () => {
        expect(getDroppedColumns(tableInfo({ columns: [columnInfo({ name: 'id' })] }), [column({ name: 'id' })])).toEqual([]);
    });
});

describe('buildDropColumnStatements', () => {
    it('quotes the table and the dropped column with the driver quote', () => {
        const statements = buildDropColumnStatements(quote, 'orders', tableInfo({ columns: [columnInfo({ name: 'id' }), columnInfo({ name: 'legacy' })] }), [
            column({ name: 'id' }),
        ]);

        expect(statements).toEqual(['ALTER TABLE "orders" DROP COLUMN "legacy";']);
    });
});

describe('buildIndexColumns', () => {
    it('quotes each column and appends the sort order unless it is NONE', () => {
        expect(
            buildIndexColumns(quote, [
                { columnName: 'created', order: 'DESC' },
                { columnName: 'id', order: 'NONE' },
                { columnName: 'name', order: null },
            ])
        ).toBe('"created" DESC, "id", "name"');
    });
});
