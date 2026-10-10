// What Access can and cannot change. UCanAccess has no DROP/ALTER/RENAME COLUMN, so the plan is
// either translated into appends or refused with a message the user can act on — and the refusal
// path is the one users hit. These drive the real builder with real plans.
import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableInfo } from '../shared/types';
import type { ModifySchemaColumn, ModifySchemaPlan } from './useSqliteDriver.ts';
import { buildMsAccessModifyTableStatements, getMsAccessExplicitPlanErrors, normalizeMsAccessColumnType } from './useMsAccessDriver.ts';

function column(overrides: Partial<ModifySchemaColumn> = {}): ModifySchemaColumn {
    return {
        name: 'name',
        type: 'TEXT',
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

function plan(overrides: Partial<ModifySchemaPlan> = {}): ModifySchemaPlan {
    return {
        table: { name: 'orders', comment: null, engine: null, collation: null, options: null },
        // Mirrors `currentInfo` exactly, so an untouched plan really is untouched.
        columns: currentInfo.columns.map((currentColumn) =>
            column({
                // Real plans mark the columns that already exist; only new ones lack this.
                originalName: currentColumn.name,
                name: currentColumn.name,
                type: currentColumn.type,
                notNull: currentColumn.notNull,
                defaultValue: currentColumn.defaultValue,
                isPrimaryKey: currentColumn.isPrimaryKey,
                primaryKeyOrdinal: currentColumn.primaryKeyOrdinal,
                isAutoIncrement: currentColumn.isAutoIncrement,
                collation: currentColumn.collation,
            })
        ),
        keys: [{ name: 'PRIMARY', originalName: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] }],
        foreignKeys: [],
        indexes: [],
        ...overrides,
    };
}

function currentColumn(overrides: Partial<TableColumnInfo> = {}): TableColumnInfo {
    return {
        cid: 0,
        name: 'id',
        type: 'COUNTER',
        notNull: false,
        defaultValue: null,
        isPrimaryKey: true,
        primaryKeyOrdinal: 0,
        isAutoIncrement: true,
        comment: null,
        collation: null,
        onUpdate: null,
        ...overrides,
    };
}

const currentInfo: TableInfo = {
    name: 'orders',
    columns: [currentColumn(), currentColumn({ cid: 1, name: 'note', type: 'TEXT', isPrimaryKey: false, primaryKeyOrdinal: null, isAutoIncrement: false })],
    indexes: [],
    foreignKeys: [],
    rowCount: 0,
};

describe('getMsAccessExplicitPlanErrors', () => {
    it('accepts a plan that only appends a nullable column', () => {
        const next = plan({ columns: [...plan().columns, column({ name: 'extra' })] });

        expect(getMsAccessExplicitPlanErrors(currentInfo, next)).toEqual([]);
    });

    it('refuses to drop a column and names it', () => {
        const next = plan({ columns: plan().columns.filter((entry) => entry.name === 'id') });

        expect(getMsAccessExplicitPlanErrors(currentInfo, next)).toEqual([
            'MS Access cannot drop existing column note: not possible because ALTER TABLE ... DROP COLUMN is not supported by UCanAccess.',
            'MS Access can only append new columns with explicit commands: ALTER TABLE ... ADD COLUMN works in UCanAccess, but reordering columns or inserting a column between existing columns is not supported.',
        ]);
    });

    it('refuses to rename a column', () => {
        const next = plan({ columns: [plan().columns[0]!, column({ name: 'comment', originalName: 'note', type: 'TEXT' })] });

        expect(getMsAccessExplicitPlanErrors(currentInfo, next)[0]).toContain('MS Access cannot rename existing column note');
    });

    it('refuses to retype, re-flag or re-default a column', () => {
        const next = plan({ columns: [plan().columns[0]!, column({ name: 'note', type: 'MEMO', notNull: true })] });

        expect(getMsAccessExplicitPlanErrors(currentInfo, next)[0]).toBe(
            'MS Access cannot alter existing column note: not possible because ALTER TABLE ... ALTER COLUMN is not supported by UCanAccess.'
        );
    });

    it('refuses to insert a column between existing ones', () => {
        const next = plan({ columns: [plan().columns[0]!, column({ name: 'inserted' }), plan().columns[1]!] });

        expect(getMsAccessExplicitPlanErrors(currentInfo, next)).toContain(
            'MS Access can only append new columns with explicit commands: ALTER TABLE ... ADD COLUMN works in UCanAccess, but reordering columns or inserting a column between existing columns is not supported.'
        );
    });

    it('refuses a primary key change in either direction', () => {
        const withoutPrimaryKey = plan({
            keys: [],
            columns: plan().columns.map((entry) => (entry.name === 'id' ? { ...entry, isPrimaryKey: false, primaryKeyOrdinal: null } : entry)),
        });
        const withExtraPrimaryKey = plan({
            keys: [{ name: 'PRIMARY', originalName: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }, { columnName: 'note' }] }],
        });

        expect(getMsAccessExplicitPlanErrors(currentInfo, withoutPrimaryKey).join('\n')).toContain('MS Access cannot change the primary key here');
        expect(getMsAccessExplicitPlanErrors(currentInfo, withExtraPrimaryKey).join('\n')).toContain('MS Access cannot change the primary key here');
    });
});

describe('buildMsAccessModifyTableStatements', () => {
    it('returns nothing when the plan changes nothing', () => {
        expect(buildMsAccessModifyTableStatements('orders', currentInfo, plan())).toEqual([]);
    });

    it('appends the new column', () => {
        const next = plan({ columns: [...plan().columns, column({ name: 'extra', type: 'MEMO' })] });

        expect(buildMsAccessModifyTableStatements('orders', currentInfo, next)).toEqual(['ALTER TABLE [orders] ADD COLUMN [extra] MEMO;']);
    });

    it('renames the table and addresses it by the new name afterwards', () => {
        const next = plan({ table: { ...plan().table, name: 'purchases' } });
        const statements = buildMsAccessModifyTableStatements('orders', currentInfo, next);

        expect(statements[0]).toBe('ALTER TABLE [orders] RENAME TO [purchases];');
        expect(statements).toHaveLength(1);
    });

    it('adds only the keys and indexes that are new', () => {
        const next = plan({
            keys: [
                { name: 'PRIMARY', originalName: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
                { name: 'orders_code_key', isPrimary: false, columns: [{ columnName: 'note' }] },
            ],
            indexes: [
                { name: 'idx_note', comment: null, isUnique: false, type: null, columns: [{ columnName: 'note', order: 'DESC' }] },
                { name: 'idx_unique_note', comment: null, isUnique: true, type: null, columns: [{ columnName: 'note', order: null }] },
            ],
        });
        const statements = buildMsAccessModifyTableStatements('orders', currentInfo, next);

        expect(statements).toEqual([
            'CREATE UNIQUE INDEX [orders_code_key] ON [orders] ([note]);',
            'CREATE INDEX [idx_note] ON [orders] ([note] DESC);',
            'CREATE UNIQUE INDEX [idx_unique_note] ON [orders] ([note]);',
        ]);
    });

    it('adds a foreign key with the actions Access supports', () => {
        const next = plan({
            foreignKeys: [
                {
                    name: 'fk_owner',
                    targetTable: 'users',
                    columns: [{ columnName: 'note', targetName: 'id' }],
                    onUpdate: 'NO ACTION',
                    onDelete: 'cascade',
                    match: 'NONE',
                },
            ],
        });

        expect(buildMsAccessModifyTableStatements('orders', currentInfo, next)).toEqual([
            'ALTER TABLE [orders] ADD CONSTRAINT [fk_owner] FOREIGN KEY ([note]) REFERENCES [users] ([id]) ON DELETE CASCADE;',
        ]);
    });

    it('points a self-referencing foreign key at the renamed table', () => {
        const next = plan({
            table: { ...plan().table, name: 'purchases' },
            foreignKeys: [{ name: 'fk_self', targetTable: 'orders', columns: [{ columnName: 'note', targetName: 'id' }], onUpdate: null, onDelete: null, match: null }],
        });
        const statements = buildMsAccessModifyTableStatements('orders', currentInfo, next);

        expect(statements.at(-1)).toContain('REFERENCES [purchases] ([id])');
    });

    it('refuses a foreign key action Access does not have', () => {
        const next = plan({
            foreignKeys: [{ name: 'fk_owner', targetTable: 'users', columns: [{ columnName: 'note', targetName: 'id' }], onUpdate: null, onDelete: 'weird action', match: null }],
        });

        expect(() => buildMsAccessModifyTableStatements('orders', currentInfo, next)).toThrow('MS Access does not support foreign key action WEIRD ACTION.');
    });

    it('throws every unsupported feature in one message', () => {
        const next = plan({
            table: { name: 'orders', comment: 'a comment', engine: null, collation: null, options: null },
            columns: [
                ...plan().columns,
                column({ name: 'extra', collation: 'NOCASE' }),
                column({ name: 'calculated', columnKind: 'CALCULATED' }),
                column({ name: 'secret', hidden: true }),
            ],
        });

        expect(() => buildMsAccessModifyTableStatements('orders', currentInfo, next)).toThrow(
            /does not support table comments[\s\S]*Column extra cannot set collation on MS Access\.[\s\S]*Column calculated cannot use column kind CALCULATED on MS Access\.[\s\S]*Column secret cannot be hidden on MS Access\./
        );
    });

    it('refuses a destructive plan unless a rebuild is allowed', () => {
        const next = plan({ columns: plan().columns.filter((entry) => entry.name === 'id') });

        expect(() => buildMsAccessModifyTableStatements('orders', currentInfo, next)).toThrow(/cannot drop existing column note/);
    });

    it('rebuilds the table through a temporary one when the plan allows it', () => {
        const next = plan({
            allowTableRebuild: true,
            columns: [plan().columns[0]!, column({ name: 'label', originalName: 'note', type: 'TEXT' })],
            keys: [{ name: 'PRIMARY', originalName: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] }],
        });
        const statements = buildMsAccessModifyTableStatements('orders', currentInfo, next);

        expect(statements[0]).toMatch(/^CREATE TABLE \[__danevan_modify_\d+_[a-z0-9]+\] \(\[id\] AUTOINCREMENT, \[label\] TEXT\);$/);
        expect(statements[1]).toMatch(/^INSERT INTO \[__danevan_modify_\d+_[a-z0-9]+\] \(\[id\], \[label\]\) SELECT \[id\], \[note\] FROM \[orders\];$/);
        expect(statements[2]).toBe('DROP TABLE [orders];');
        expect(statements[3]).toMatch(/^ALTER TABLE \[__danevan_modify_\d+_[a-z0-9]+\] ADD CONSTRAINT \[PKEY\] PRIMARY KEY \(\[id\]\);$/);
        expect(statements[4]).toMatch(/^ALTER TABLE \[__danevan_modify_\d+_[a-z0-9]+\] RENAME TO \[orders\];$/);
    });

    it('keeps the columns a rebuild cannot map out of the transfer', () => {
        const next = plan({
            allowTableRebuild: true,
            // Renaming a column forces the rebuild; `added` still has nothing to copy from.
            columns: [plan().columns[0]!, column({ name: 'label', originalName: 'note', type: 'TEXT' }), column({ name: 'added' })],
        });
        const statements = buildMsAccessModifyTableStatements('orders', currentInfo, next);

        expect(statements[1]).toContain('([id], [label]) SELECT [id], [note] FROM [orders];');
        expect(statements[1]).not.toContain('added');
    });
});

describe('normalizeMsAccessColumnType', () => {
    // Verified against the bridge: UCanAccess refuses these names in a CREATE TABLE and accepts
    // the replacement (see msAccessBridge.spec.ts).
    it.each([
        ['LONGCHAR', 'MEMO'],
        ['NTEXT', 'MEMO'],
        ['MONEY', 'CURRENCY'],
        ['SMALLDATETIME', 'DATETIME'],
        ['LONGBINARY', 'VARBINARY'],
        ['IMAGE', 'VARBINARY'],
        ['OLEOBJECT', 'VARBINARY'],
        ['UNIQUEIDENTIFIER', 'GUID'],
    ])('maps %s to %s', (type, expected) => {
        expect(normalizeMsAccessColumnType(type)).toBe(expected);
    });

    it('maps case-insensitively and keeps a declared size', () => {
        expect(normalizeMsAccessColumnType('  money  ')).toBe('CURRENCY');
        expect(normalizeMsAccessColumnType('LongChar(255)')).toBe('MEMO(255)');
    });

    it('leaves the types the bridge accepts as written', () => {
        expect(normalizeMsAccessColumnType('TEXT(255)')).toBe('TEXT(255)');
        expect(normalizeMsAccessColumnType(' counter ')).toBe('counter');
    });

    it('emits the mapped type in the statements it builds', () => {
        const next = plan({ columns: [...plan().columns, column({ name: 'amount', type: 'MONEY' })] });

        expect(buildMsAccessModifyTableStatements('orders', currentInfo, next)).toEqual(['ALTER TABLE [orders] ADD COLUMN [amount] CURRENCY;']);
    });
});
