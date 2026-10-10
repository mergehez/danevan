// MySQL's ALTER text is where a wrong column type, a lost DEFAULT or a missing quote silently
// changes a user's table. These drive the real builders with real plans and assert the statement.
import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableIndexInfo, TableInfo } from '../shared/types';
import {
    buildAlterStatements,
    buildColumnChangeStatements,
    buildDropForeignKeyStatement,
    buildTableOptionStatements,
    getCurrentStandaloneIndexes,
    getDesiredStandaloneIndexes,
    indexSignature,
    type MySqlTableDdlDeps,
} from './mysqlTableDdl.ts';
import type { ModifySchemaColumn, ModifySchemaPlan } from './useSqliteDriver.ts';

const deps: MySqlTableDdlDeps = {
    escapeSqlString: (value) => `'${value.replaceAll("'", "''")}'`,
    normalizeOptionalText: (value) => (value?.trim() ? value.trim() : null),
    quoteIdentifier: (identifier) => `\`${identifier}\``,
};

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
    return { name: 'ix_name', columns: [], isUnique: false, origin: '', isPartial: false, ...overrides };
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

/** An existing column the plan re-sends unchanged. */
function keptColumn(overrides: Partial<ModifySchemaColumn> = {}): ModifySchemaColumn {
    const kept = column(overrides);

    return { ...kept, originalName: overrides.originalName ?? kept.name };
}

describe('indexSignature', () => {
    const base = { name: 'ix_created', comment: 'fresh', isUnique: false, type: 'BTREE', columns: [{ columnName: 'Created', order: 'DESC' }] };

    it('folds the comment, the type and the sort order in', () => {
        expect(indexSignature(base)).toBe('created:DESC::0::btree::fresh');
        expect(indexSignature({ ...base, comment: 'stale' })).not.toBe(indexSignature(base));
        expect(indexSignature({ ...base, columns: [{ columnName: 'Created', order: 'ASC' }] })).not.toBe(indexSignature(base));
    });

    it('flags a unique index and falls back for a missing type and comment', () => {
        expect(indexSignature({ name: 'uq_email', comment: null, isUnique: true, type: null, columns: [{ columnName: 'email', order: null }] })).toBe('email:::1::::');
    });
});

describe('getDesiredStandaloneIndexes', () => {
    it('leaves out the indexes a key already covers, including the primary key name', () => {
        const indexes = getDesiredStandaloneIndexes(
            plan({
                keys: [
                    { name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
                    { name: 'uq_email', isPrimary: false, columns: [{ columnName: 'email' }] },
                ],
                indexes: [
                    { name: 'ix_created', comment: null, isUnique: false, type: null, columns: [{ columnName: 'created', order: null }] },
                    { name: 'PRIMARY', comment: null, isUnique: true, type: null, columns: [{ columnName: 'id', order: null }] },
                    { name: 'uq_email', comment: null, isUnique: true, type: null, columns: [{ columnName: 'email', order: null }] },
                ],
            })
        );

        expect(indexes.map((index) => index.name)).toEqual(['ix_created']);
    });
});

describe('getCurrentStandaloneIndexes', () => {
    it('keeps only the indexes that are neither unique nor the primary key', () => {
        const indexes = getCurrentStandaloneIndexes(
            tableInfo({
                columns: [columnInfo({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })],
                indexes: [
                    indexInfo({ name: 'PRIMARY', columns: ['id'], isUnique: true }),
                    indexInfo({ name: 'uq_id', columns: ['id'], isUnique: true }),
                    indexInfo({ name: 'ix_id', columns: ['id'] }),
                    indexInfo({ name: 'ix_created', columns: ['created'], orders: ['DESC'], type: 'BTREE', comment: 'fresh' }),
                    indexInfo({ name: 'ix_plain', columns: ['plain'] }),
                ],
            })
        );

        expect(indexes).toEqual([
            { name: 'ix_created', comment: 'fresh', isUnique: false, type: 'BTREE', columns: [{ columnName: 'created', order: 'DESC' }] },
            { name: 'ix_plain', comment: null, isUnique: false, type: null, columns: [{ columnName: 'plain', order: null }] },
        ]);
    });
});

describe('buildTableOptionStatements', () => {
    it('rewrites only the table options that changed', () => {
        const statements = buildTableOptionStatements(deps, 'orders', tableInfo({ comment: 'old', engine: 'InnoDB', collation: 'utf8mb4', options: 'ROW_FORMAT=DYNAMIC' }), {
            name: 'orders',
            comment: "owner's note",
            engine: 'MyISAM',
            collation: 'latin1',
            options: 'ROW_FORMAT=COMPACT',
        });

        expect(statements).toEqual([
            "ALTER TABLE `orders` COMMENT = 'owner''s note';",
            'ALTER TABLE `orders` ENGINE = MyISAM;',
            'ALTER TABLE `orders` COLLATE = latin1;',
            'ALTER TABLE `orders` ROW_FORMAT=COMPACT;',
        ]);
    });

    it('emits nothing when the options are already what the plan asks for', () => {
        const statements = buildTableOptionStatements(deps, 'orders', tableInfo({ comment: 'keep', engine: 'InnoDB', collation: 'utf8mb4', options: 'ROW_FORMAT=DYNAMIC' }), {
            name: 'orders',
            comment: 'keep',
            engine: 'InnoDB',
            collation: 'utf8mb4',
            options: 'ROW_FORMAT=DYNAMIC',
        });

        expect(statements).toEqual([]);
    });

    it('treats a missing comment on either side as no comment at all', () => {
        expect(buildTableOptionStatements(deps, 'orders', tableInfo(), { name: 'orders', comment: null, engine: null, collation: null, options: null })).toEqual([]);
    });

    it('clears a comment the plan removes', () => {
        const statements = buildTableOptionStatements(deps, 'orders', tableInfo({ comment: 'old' }), {
            name: 'orders',
            comment: null,
            engine: null,
            collation: null,
            options: null,
        });

        expect(statements).toEqual(["ALTER TABLE `orders` COMMENT = '';"]);
    });
});

describe('buildDropForeignKeyStatement', () => {
    it('quotes the table and the constraint', () => {
        expect(buildDropForeignKeyStatement(deps, 'orders', 'fk_owner')).toBe('ALTER TABLE `orders` DROP FOREIGN KEY `fk_owner`;');
    });
});

describe('buildColumnChangeStatements', () => {
    it('adds a new column with its definition and anchors it after the previous one', () => {
        const statements = buildColumnChangeStatements(
            deps,
            'orders',
            tableInfo({ columns: [columnInfo({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 })] }),
            [
                column({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1, originalName: 'id' }),
                column({ name: 'email', type: 'varchar(255)', notNull: true, defaultValue: "'a'", comment: 'contact' }),
            ]
        );

        expect(statements).toEqual(["ALTER TABLE `orders` ADD COLUMN `email` varchar(255) NOT NULL DEFAULT 'a' COMMENT 'contact' AFTER `id`;"]);
    });

    it('anchors the first column with FIRST and keeps AUTO_INCREMENT, ON UPDATE and COLLATE in order', () => {
        const statements = buildColumnChangeStatements(deps, 'orders', tableInfo(), [
            column({ name: 'id', type: 'int', notNull: true, isAutoIncrement: true, onUpdate: 'CURRENT_TIMESTAMP', collation: 'utf8mb4_bin' }),
        ]);

        expect(statements).toEqual(["ALTER TABLE `orders` ADD COLUMN `id` int NOT NULL AUTO_INCREMENT ON UPDATE CURRENT_TIMESTAMP COLLATE utf8mb4_bin COMMENT '' FIRST;"]);
    });

    it('writes a DEFAULT NULL for a nullable new column without a default', () => {
        const statements = buildColumnChangeStatements(deps, 'orders', tableInfo(), [column({ name: 'note', type: 'text' })]);

        expect(statements).toEqual(["ALTER TABLE `orders` ADD COLUMN `note` text NULL DEFAULT NULL COMMENT '' FIRST;"]);
    });

    it('changes a column whose type changed, naming the current column on the left', () => {
        const statements = buildColumnChangeStatements(
            deps,
            'orders',
            tableInfo({
                columns: [columnInfo({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }), columnInfo({ name: 'name', type: 'varchar(50)' })],
            }),
            [keptColumn({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }), keptColumn({ name: 'name', type: 'varchar(255)' })]
        );

        expect(statements).toEqual(["ALTER TABLE `orders` CHANGE COLUMN `name` `name` varchar(255) NULL DEFAULT NULL COMMENT '' AFTER `id`;"]);
    });

    it('renames the column it matches through originalName', () => {
        const statements = buildColumnChangeStatements(deps, 'orders', tableInfo({ columns: [columnInfo({ name: 'name' })] }), [
            column({ name: 'full_name', originalName: 'name' }),
        ]);

        expect(statements).toEqual(["ALTER TABLE `orders` CHANGE COLUMN `name` `full_name` varchar(255) NULL DEFAULT NULL COMMENT '' FIRST;"]);
    });

    it('emits nothing for a column the plan re-sends unchanged', () => {
        const statements = buildColumnChangeStatements(
            deps,
            'orders',
            tableInfo({ columns: [columnInfo({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 })] }),
            [keptColumn({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 })]
        );

        expect(statements).toEqual([]);
    });

    it('moves a column with a single CHANGE, not an add', () => {
        const statements = buildColumnChangeStatements(
            deps,
            'orders',
            tableInfo({ columns: [columnInfo({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }), columnInfo({ name: 'name' })] }),
            [keptColumn({ name: 'name' }), keptColumn({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 })]
        );

        expect(statements).toEqual(["ALTER TABLE `orders` CHANGE COLUMN `name` `name` varchar(255) NULL DEFAULT NULL COMMENT '' FIRST;"]);
    });
});

describe('buildAlterStatements', () => {
    const currentInfo = tableInfo({
        columns: [
            columnInfo({ name: 'id', type: 'int', notNull: true, isAutoIncrement: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }),
            columnInfo({ name: 'name', type: 'varchar(50)' }),
            columnInfo({ name: 'legacy_note', type: 'text' }),
        ],
        indexes: [
            indexInfo({ name: 'PRIMARY', columns: ['id'], isUnique: true }),
            indexInfo({ name: 'uq_name', columns: ['name'], isUnique: true }),
            indexInfo({ name: 'ix_created', columns: ['created'], orders: ['DESC'] }),
        ],
    });

    it('drops what changed, applies the columns and adds the keys and indexes back', () => {
        const statements = buildAlterStatements(
            deps,
            'orders',
            currentInfo,
            plan({
                columns: [
                    keptColumn({ name: 'id', type: 'int', notNull: true, isAutoIncrement: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                    keptColumn({ name: 'name', type: 'varchar(255)' }),
                    column({ name: 'created', type: 'datetime' }),
                ],
                keys: [
                    { name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
                    { name: 'uq_email', isPrimary: false, columns: [{ columnName: 'email' }] },
                ],
                indexes: [{ name: 'ix_created', comment: null, isUnique: false, type: null, columns: [{ columnName: 'created', order: 'ASC' }] }],
            })
        );

        expect(statements).toEqual([
            'ALTER TABLE `orders` DROP INDEX `uq_name`;',
            'ALTER TABLE `orders` DROP INDEX `ix_created`;',
            'ALTER TABLE `orders` DROP COLUMN `legacy_note`;',
            "ALTER TABLE `orders` CHANGE COLUMN `name` `name` varchar(255) NULL DEFAULT NULL COMMENT '' AFTER `id`;",
            "ALTER TABLE `orders` ADD COLUMN `created` datetime NULL DEFAULT NULL COMMENT '' AFTER `name`;",
            'ALTER TABLE `orders` ADD CONSTRAINT `uq_email` UNIQUE (`email`);',
            'ALTER TABLE `orders` ADD INDEX `ix_created` (`created` ASC);',
        ]);
    });

    it('keeps a unique index and a standalone index that did not change', () => {
        const statements = buildAlterStatements(
            deps,
            'orders',
            tableInfo({
                columns: [columnInfo({ name: 'id', type: 'int', notNull: true, isAutoIncrement: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }), columnInfo({ name: 'email' })],
                indexes: [indexInfo({ name: 'PRIMARY', columns: ['id'], isUnique: true }), indexInfo({ name: 'uq_email', columns: ['email'], isUnique: true })],
            }),
            plan({
                columns: [keptColumn({ name: 'id', type: 'int', notNull: true, isAutoIncrement: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }), keptColumn({ name: 'email' })],
                keys: [
                    { name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
                    { name: 'uq_email', isPrimary: false, columns: [{ columnName: 'email' }] },
                ],
            })
        );

        expect(statements).toEqual([]);
    });

    it('keeps a unique key and an index both sides agree on', () => {
        const statements = buildAlterStatements(
            deps,
            'orders',
            tableInfo({
                columns: [
                    columnInfo({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                    columnInfo({ name: 'email' }),
                    columnInfo({ name: 'created', type: 'datetime' }),
                ],
                indexes: [
                    indexInfo({ name: 'PRIMARY', columns: ['id'], isUnique: true }),
                    indexInfo({ name: 'uq_email', columns: ['email'], isUnique: true }),
                    indexInfo({ name: 'ix_created', columns: ['created'], orders: ['DESC'] }),
                ],
            }),
            plan({
                columns: [
                    keptColumn({ name: 'id', type: 'int', notNull: true, isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                    keptColumn({ name: 'email' }),
                    keptColumn({ name: 'created', type: 'datetime' }),
                ],
                keys: [
                    { name: 'PRIMARY', isPrimary: true, columns: [{ columnName: 'id' }] },
                    { name: 'uq_email', isPrimary: false, columns: [{ columnName: 'email' }] },
                ],
                indexes: [{ name: 'ix_created', comment: null, isUnique: false, type: null, columns: [{ columnName: 'created', order: 'DESC' }] }],
            })
        );

        expect(statements).toEqual([]);
    });

    it('writes a unique index with its type and comment', () => {
        const statements = buildAlterStatements(
            deps,
            'orders',
            tableInfo(),
            plan({ indexes: [{ name: 'ix_email', comment: 'lookup', isUnique: true, type: 'BTREE', columns: [{ columnName: 'email', order: null }] }] })
        );

        expect(statements).toEqual(["ALTER TABLE `orders` ADD UNIQUE INDEX `ix_email` (`email`) USING BTREE COMMENT 'lookup';"]);
    });
});
