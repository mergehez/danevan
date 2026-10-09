import { describe, expect, it } from 'vitest';
import type { TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '../../shared/types';
import {
    buildDatabaseComparisonSections,
    buildTableComparisonSections,
    collectDatabaseComparison,
    collectTableComparison,
    countComparisonDifferences,
    countDatabaseComparisonDifferences,
    deriveStandaloneIndexes,
    deriveTableForeignKeys,
    deriveTableKeys,
    filterComparisonSections,
    formatComparisonMarkdown,
    type ComparisonSection,
} from './compareSchemas';
import { createDefaultComparisonOptions, type ComparisonOptions } from './comparisonOptions';

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
    return {
        isUnique: false,
        origin: 'c',
        isPartial: false,
        ...overrides,
    };
}

function foreignKey(overrides: Partial<TableForeignKeyInfo> & { id: number; from: string; to: string }): TableForeignKeyInfo {
    return {
        sequence: 0,
        table: 'customers',
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
        match: 'NONE',
        ...overrides,
    };
}

function table(overrides: Partial<TableInfo> & { name: string }): TableInfo {
    return {
        columns: [],
        indexes: [],
        foreignKeys: [],
        rowCount: 0,
        ...overrides,
    };
}

function withOptions(overrides: (options: ComparisonOptions) => void): ComparisonOptions {
    const options = createDefaultComparisonOptions();
    overrides(options);
    return options;
}

function sectionRows(sections: ComparisonSection[], id: string) {
    return sections.find((section) => section.id === id)?.rows ?? [];
}

function changedAttributes(sections: ComparisonSection[], id: string) {
    return filterComparisonSections(sections, false)
        .find((section) => section.id === id)
        ?.rows.filter((row) => row.Status === 'changed')
        .map((row) => row.Attribute);
}

const customers = table({
    name: 'customers',
    columns: [column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'name', type: 'varchar(255)', notNull: true })],
});

describe('deriveTableKeys', () => {
    it('collects the primary key (in ordinal order) and unique keys', () => {
        const info = table({
            name: 'users',
            columns: [
                column({ name: 'tenant_id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 2 }),
                column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                column({ name: 'email', type: 'text' }),
            ],
            indexes: [
                index({ name: 'PRIMARY', columns: ['id', 'tenant_id'], isUnique: true, origin: 'pk' }),
                index({ name: 'users_email_unique', columns: ['email'], isUnique: true, origin: 'u' }),
            ],
        });

        expect(deriveTableKeys(info)).toEqual([
            { name: 'PRIMARY', isPrimary: true, columns: ['id', 'tenant_id'] },
            { name: 'users_email_unique', isPrimary: false, columns: ['email'] },
        ]);
    });

    it('lists only non-unique indexes that are not keys', () => {
        const info = table({
            name: 'users',
            columns: [
                column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1 }),
                column({ name: 'email', type: 'text' }),
                column({ name: 'created_at', type: 'datetime' }),
            ],
            indexes: [
                index({ name: 'PRIMARY', columns: ['id'], isUnique: true, origin: 'pk' }),
                index({ name: 'users_email_unique', columns: ['email'], isUnique: true, origin: 'u' }),
                index({ name: 'users_created_at_idx', columns: ['created_at'] }),
            ],
        });

        expect(deriveStandaloneIndexes(info).map((entry) => entry.name)).toEqual(['users_created_at_idx']);
    });
});

describe('deriveTableForeignKeys', () => {
    it('groups composite foreign keys by name and keeps column order', () => {
        const info = table({
            name: 'orders',
            foreignKeys: [
                foreignKey({ id: 1, name: 'fk_orders_customer', from: 'customer_tenant', to: 'tenant_id', sequence: 2 }),
                foreignKey({ id: 1, name: 'fk_orders_customer', from: 'customer_id', to: 'id', sequence: 1 }),
            ],
        });

        expect(deriveTableForeignKeys(info)).toEqual([
            {
                name: 'fk_orders_customer',
                targetTable: 'customers',
                columns: [
                    { from: 'customer_id', to: 'id' },
                    { from: 'customer_tenant', to: 'tenant_id' },
                ],
                onDelete: 'NO ACTION',
                onUpdate: 'NO ACTION',
                match: 'NONE',
            },
        ]);
    });
});

describe('buildTableComparisonSections', () => {
    it('reports one row per differing column attribute', () => {
        const target = table({
            ...customers,
            columns: [column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'name', type: 'text', notNull: true })],
        });

        const sections = buildTableComparisonSections(customers, target, createDefaultComparisonOptions());

        expect(changedAttributes(sections, 'columns')).toEqual(['type']);
        expect(sectionRows(sections, 'columns').find((row) => row.Status === 'changed')).toMatchObject({
            Column: 'name',
            Source: 'varchar(255)',
            Target: 'text',
        });
    });

    it('marks a source-only column added and a target-only column removed', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' }), column({ name: 'legacy' })] });
        const target = table({ name: 'users', columns: [column({ name: 'id' }), column({ name: 'email' })] });

        const sections = buildTableComparisonSections(source, target, createDefaultComparisonOptions());
        const rows = filterComparisonSections(sections, false).find((section) => section.id === 'columns')?.rows ?? [];

        expect(rows).toEqual([
            { Column: 'legacy', Attribute: '', Source: 'int', Target: '—', Status: 'added' },
            { Column: 'email', Attribute: '', Source: '—', Target: 'int', Status: 'removed' },
        ]);
    });

    it('reports pk, auto increment, nullability and on update changes', () => {
        const source = table({
            name: 'users',
            columns: [
                column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1, isAutoIncrement: true }),
                column({ name: 'updated_at', type: 'datetime', onUpdate: 'CURRENT_TIMESTAMP' }),
            ],
        });
        const target = table({
            name: 'users',
            columns: [column({ name: 'id', type: 'int', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'updated_at', type: 'datetime', notNull: true })],
        });

        const sections = buildTableComparisonSections(source, target, createDefaultComparisonOptions());
        const rows = filterComparisonSections(sections, false).find((section) => section.id === 'columns')?.rows ?? [];

        expect(rows.map((row) => [row.Column, row.Attribute, row.Status])).toEqual([
            ['id', 'auto increment', 'changed'],
            ['updated_at', 'nullable', 'changed'],
            ['updated_at', 'on update', 'changed'],
        ]);
    });

    it('skips attributes the options ignore', () => {
        const source = table({ name: 'users', columns: [column({ name: 'name', type: 'text', collation: 'utf8mb4_general_ci', defaultValue: 'guest' })] });
        const target = table({ name: 'users', columns: [column({ name: 'name', type: 'text', collation: 'utf8mb4_bin', defaultValue: null })] });

        const ignored = withOptions((options) => {
            options.columns.ignoreCollation = true;
            options.columns.ignoreDefaultValue = true;
        });

        expect(countComparisonDifferences(buildTableComparisonSections(source, target, ignored))).toBe(0);
        expect(countComparisonDifferences(buildTableComparisonSections(source, target, createDefaultComparisonOptions()))).toBe(2);
    });

    it('treats equivalent default expressions as equal', () => {
        const source = table({ name: 'users', columns: [column({ name: 'created_at', type: 'datetime', defaultValue: 'CURRENT_TIMESTAMP' })] });
        const target = table({ name: 'users', columns: [column({ name: 'created_at', type: 'datetime', defaultValue: 'current_timestamp()' })] });

        expect(countComparisonDifferences(buildTableComparisonSections(source, target, createDefaultComparisonOptions()))).toBe(0);
    });

    it('compares table engine and collation, and honours their ignore options', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' })], engine: 'InnoDB', collation: 'utf8mb4_general_ci' });
        const target = table({ name: 'users', columns: [column({ name: 'id' })], engine: 'MyISAM', collation: 'utf8mb4_bin' });

        expect(changedAttributes(buildTableComparisonSections(source, target, createDefaultComparisonOptions()), 'table')).toEqual(['engine', 'collation']);

        const ignored = withOptions((options) => {
            options.table.ignoreEngine = true;
            options.table.ignoreCollation = true;
        });

        expect(buildTableComparisonSections(source, target, ignored).find((section) => section.id === 'table')).toBeUndefined();
    });

    it('pairs a renamed key by its columns so only the name shows as changed', () => {
        const source = table({
            name: 'users',
            columns: [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'email' })],
            indexes: [index({ name: 'users_email_key', columns: ['email'], isUnique: true, origin: 'u' })],
        });
        const target = table({
            name: 'users',
            columns: [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'email' })],
            indexes: [index({ name: 'email_unique', columns: ['email'], isUnique: true, origin: 'u' })],
        });

        expect(changedAttributes(buildTableComparisonSections(source, target, createDefaultComparisonOptions()), 'keys')).toEqual(['name']);

        const ignored = withOptions((options) => {
            options.keys.ignoreName = true;
        });

        expect(countComparisonDifferences(buildTableComparisonSections(source, target, ignored))).toBe(0);
    });

    it('pairs foreign keys by columns and target table, and can ignore their actions', () => {
        const source = table({
            name: 'orders',
            columns: [column({ name: 'customer_id' })],
            foreignKeys: [foreignKey({ id: 1, name: 'fk_customer', from: 'customer_id', to: 'id', onDelete: 'CASCADE', onUpdate: 'CASCADE' })],
        });
        const target = table({
            name: 'orders',
            columns: [column({ name: 'customer_id' })],
            foreignKeys: [foreignKey({ id: 7, name: 'orders_customer_fk', from: 'customer_id', to: 'id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' })],
        });

        expect(changedAttributes(buildTableComparisonSections(source, target, createDefaultComparisonOptions()), 'foreignKeys')).toEqual(['name', 'on delete']);

        const ignored = withOptions((options) => {
            options.foreignKeys.ignoreName = true;
            options.foreignKeys.ignoreOnDelete = true;
        });

        expect(countComparisonDifferences(buildTableComparisonSections(source, target, ignored))).toBe(0);
    });

    it('pairs indexes by columns and reports type changes and removals', () => {
        const source = table({
            name: 'users',
            columns: [column({ name: 'a' }), column({ name: 'b' })],
            indexes: [index({ name: 'users_ab_idx', columns: ['a', 'b'], type: 'btree' })],
        });
        const target = table({
            name: 'users',
            columns: [column({ name: 'a' }), column({ name: 'b' })],
            indexes: [index({ name: 'users_ab_idx', columns: ['a', 'b'], type: 'hash' }), index({ name: 'users_b_idx', columns: ['b'] })],
        });

        const sections = buildTableComparisonSections(source, target, createDefaultComparisonOptions());

        expect(changedAttributes(sections, 'indexes')).toEqual(['type']);
        expect(sectionRows(sections, 'indexes').find((row) => row.Status === 'removed')).toMatchObject({ Index: 'users_b_idx', Source: '—' });
    });
});

describe('buildDatabaseComparisonSections', () => {
    const sourceUsers = table({ name: 'users', columns: [column({ name: 'id' })] });
    const targetUsers = table({ name: 'users', columns: [column({ name: 'id' })] });
    const sourceOrders = table({ name: 'orders', columns: [column({ name: 'total', type: 'int' })] });
    const targetOrders = table({ name: 'orders', columns: [column({ name: 'total', type: 'bigint' })] });

    it('overviews every table with a status and details only the differing ones', () => {
        const sections = buildDatabaseComparisonSections(
            [sourceUsers, sourceOrders, table({ name: 'legacy', columns: [column({ name: 'id' })] })],
            [targetUsers, targetOrders, table({ name: 'audit', columns: [column({ name: 'id' })] })],
            createDefaultComparisonOptions()
        );

        expect(sections[0].title).toBe('Tables');
        expect(sections[0].summary).toBe('2 missing · 1 changed');
        expect(sections[0].rows).toEqual([
            { Table: 'users', Status: 'identical', Differences: '—' },
            { Table: 'orders', Status: 'changed', Differences: '1 difference' },
            { Table: 'legacy', Status: 'added', Differences: 'missing in target' },
            { Table: 'audit', Status: 'removed', Differences: 'missing in source' },
        ]);

        const detail = sections.filter((section) => section.id !== 'tables');
        expect(detail.map((section) => section.title)).toEqual(['orders']);
        expect(detail[0].rows.find((row) => row.Status === 'changed')).toMatchObject({
            Object: 'columns · total',
            Attribute: 'type',
            Source: 'int',
            Target: 'bigint',
            Status: 'changed',
        });
    });

    it('counts a changed table once, not once per overview row and detail section', () => {
        const sections = buildDatabaseComparisonSections([sourceOrders], [targetOrders], createDefaultComparisonOptions());

        expect(countComparisonDifferences(sections)).toBe(2);
        expect(countDatabaseComparisonDifferences(sections)).toBe(1);
    });

    it('hides identical rows unless they are requested', () => {
        const sections = buildTableComparisonSections(customers, customers, createDefaultComparisonOptions());
        const all = filterComparisonSections(sections, true);
        const differences = filterComparisonSections(sections, false);

        expect(all.length).toBeGreaterThan(0);
        expect(all.flatMap((section) => section.rows).every((row) => row.Status === 'identical')).toBe(true);
        expect(differences).toEqual([]);
    });
});

describe('formatComparisonMarkdown', () => {
    it('renders one markdown table per section and escapes pipes', () => {
        const markdown = formatComparisonMarkdown({
            title: 'Table comparison',
            sourceLabel: 'main · users',
            targetLabel: 'backup · users',
            sections: [
                {
                    id: 'columns',
                    title: 'Columns',
                    columns: ['Column', 'Attribute', 'Source', 'Target', 'Status'],
                    rows: [{ Column: 'name', Attribute: 'type', Source: 'varchar|255', Target: 'text', Status: 'changed' }],
                    differenceCount: 1,
                },
            ],
            generatedAt: '2026-01-01T00:00:00.000Z',
        });

        expect(markdown).toContain('# Table comparison');
        expect(markdown).toContain('- **Source:** main · users');
        expect(markdown).toContain('| Column | Attribute | Source | Target | Status |');
        expect(markdown).toContain('| name | type | varchar\\|255 | text | changed |');
    });

    it('says so when there is nothing to show', () => {
        const markdown = formatComparisonMarkdown({ title: 'Table comparison', sourceLabel: 'a', targetLabel: 'b', sections: [] });

        expect(markdown).toContain('No differences found.');
    });

    it('lists breaking changes before the difference tables', () => {
        const markdown = formatComparisonMarkdown({
            title: 'Table comparison',
            sourceLabel: 'main · users',
            targetLabel: 'backup · users',
            sections: [
                {
                    id: 'columns',
                    title: 'Columns',
                    columns: ['Column', 'Attribute', 'Source', 'Target', 'Status'],
                    rows: [{ Column: 'age', Attribute: 'type', Source: 'int', Target: 'bigint', Status: 'changed' }],
                    differenceCount: 1,
                },
            ],
            breakingChanges: [{ id: 'breaking:users:columns:age:type', text: 'Column "users.age" type would change from int to bigint' }],
        });

        expect(markdown).toContain('## Breaking changes (1)');
        expect(markdown).toContain('- Column "users.age" type would change from int to bigint');
        expect(markdown.indexOf('## Breaking changes (1)')).toBeLessThan(markdown.indexOf('## Columns'));
    });

    it('notes the foreign key differences that were not counted as breaking', () => {
        const markdown = formatComparisonMarkdown({
            title: 'Table comparison',
            sourceLabel: 'main · orders',
            targetLabel: 'backup · orders',
            sections: [],
            breakingChanges: [],
            ignoredBreakingCount: 3,
        });

        expect(markdown).toContain('## Breaking changes (0)');
        expect(markdown).toContain('3 foreign key differences are not counted as breaking');
    });
});

describe('collectTableComparison breaking changes', () => {
    function breakingTexts(source: TableInfo, target: TableInfo, options: ComparisonOptions = createDefaultComparisonOptions()) {
        return collectTableComparison(source, target, options).breakingChanges.map((change) => change.text);
    }

    it('flags type changes, NOT NULL tightening, dropped columns and added non-null columns', () => {
        const source = table({
            name: 'users',
            columns: [
                column({ name: 'id' }),
                column({ name: 'age', type: 'int', notNull: true }),
                column({ name: 'created_at', type: 'text', notNull: true }),
                column({ name: 'email', type: 'text' }),
            ],
        });
        const target = table({
            name: 'users',
            columns: [column({ name: 'id' }), column({ name: 'age', type: 'bigint' }), column({ name: 'legacy', type: 'text' })],
        });

        const texts = breakingTexts(source, target);

        expect(texts).toContain('Column "users.age" type would change from int to bigint');
        expect(texts).toContain('Column "users.age" would become NOT NULL');
        expect(texts).toContain('Column "users.created_at" would be added as NOT NULL without a default');
        expect(texts).toContain('Column "users.legacy" exists only in the target and would be dropped, losing its data');
        // A nullable column added on the source side is safe.
        expect(texts.some((text) => text.includes('users.email'))).toBe(false);
    });

    it('does not treat default values, renames or new non-unique indexes as breaking', () => {
        const source = table({
            name: 'users',
            columns: [column({ name: 'name', type: 'text', defaultValue: 'guest' })],
            indexes: [index({ name: 'users_name_idx', columns: ['name'] }), index({ name: 'users_email_key', columns: ['name'], isUnique: true, origin: 'u' })],
        });
        const target = table({
            name: 'users',
            columns: [column({ name: 'name', type: 'text' })],
            indexes: [index({ name: 'name_index', columns: ['name'] }), index({ name: 'email_unique', columns: ['name'], isUnique: true, origin: 'u' })],
        });

        // Default-value change, index rename and key rename only.
        expect(breakingTexts(source, target)).toEqual([]);
    });

    it('flags unique key additions and drops', () => {
        const withKey = table({
            name: 'users',
            columns: [column({ name: 'email' })],
            indexes: [index({ name: 'users_email_key', columns: ['email'], isUnique: true, origin: 'u' })],
        });
        const withoutKey = table({ name: 'users', columns: [column({ name: 'email' })] });

        expect(breakingTexts(withKey, withoutKey)).toEqual(['Unique key "users.users_email_key" on (email) would be added; existing rows may violate it']);
        expect(breakingTexts(withoutKey, withKey)).toEqual(['Unique key "users.users_email_key" exists only in the target and would be dropped']);
    });

    it('ignores foreign key changes by default and counts them when the option is turned off', () => {
        const source = table({
            name: 'orders',
            columns: [column({ name: 'customer_id' })],
            foreignKeys: [foreignKey({ id: 1, name: 'fk_customer', from: 'customer_id', to: 'id' })],
        });
        const target = table({ name: 'orders', columns: [column({ name: 'customer_id' })] });

        const defaultResult = collectTableComparison(source, target, createDefaultComparisonOptions());
        expect(defaultResult.breakingChanges).toEqual([]);
        expect(defaultResult.ignoredBreakingCount).toBe(1);

        const counted = withOptions((options) => {
            options.foreignKeys.ignoreBreaking = false;
        });
        const countedResult = collectTableComparison(source, target, counted);

        expect(countedResult.breakingChanges.map((change) => change.text)).toEqual(['Foreign key "orders.fk_customer" would be added']);
        expect(countedResult.ignoredBreakingCount).toBe(0);
    });
});

describe('collectDatabaseComparison breaking changes', () => {
    it('flags engine and collation changes plus dropped tables, but not created tables', () => {
        const sourceUsers = table({ name: 'users', columns: [column({ name: 'id' })], engine: 'InnoDB', collation: 'utf8mb4_general_ci' });
        const targetUsers = table({ name: 'users', columns: [column({ name: 'id' })], engine: 'MyISAM', collation: 'utf8mb4_bin' });
        const sourceNew = table({ name: 'brand_new', columns: [column({ name: 'id' })] });
        const targetAudit = table({ name: 'audit', columns: [column({ name: 'id' })] });

        const result = collectDatabaseComparison([sourceUsers, sourceNew], [targetUsers, targetAudit], createDefaultComparisonOptions());

        expect(result.breakingChanges.map((change) => change.text)).toEqual([
            'Table "users" engine would change from InnoDB to MyISAM',
            'Table "users" collation would change from utf8mb4_general_ci to utf8mb4_bin',
            'Table "audit" exists only in the target and would be dropped, losing its data',
        ]);
    });
});

describe('additive fix actions', () => {
    function actionAt(sections: ComparisonSection[], id: string, objectName: string) {
        const section = sections.find((entry) => entry.id === id);
        const index = section ? section.rows.findIndex((row) => row[section.columns[0]] === objectName) : -1;

        return index >= 0 ? section?.actions?.[index] : undefined;
    }

    it('offers to add a source-only column to the target', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' }), column({ name: 'email', type: 'text', notNull: true })] });
        const target = table({ name: 'users', columns: [column({ name: 'id' })] });

        const sections = collectTableComparison(source, target, createDefaultComparisonOptions()).sections;
        const action = actionAt(sections, 'columns', 'email');

        expect(action).toMatchObject({ kind: 'add-column', destination: 'target', tableName: 'users', label: 'column "email" (text, not null)' });
        expect(action?.column).toEqual(source.columns[1]);
    });

    it('offers to add a target-only column back to the source', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' })] });
        const target = table({ name: 'users', columns: [column({ name: 'id' }), column({ name: 'legacy' })] });

        const sections = collectTableComparison(source, target, createDefaultComparisonOptions()).sections;

        expect(actionAt(sections, 'columns', 'legacy')).toMatchObject({ kind: 'add-column', destination: 'source', tableName: 'users' });
    });

    it('names the destination table when the compared tables differ', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' })] });
        const target = table({ name: 'users_backup', columns: [column({ name: 'id' }), column({ name: 'extra' })] });

        const sections = collectTableComparison(source, target, createDefaultComparisonOptions()).sections;

        // Only the target has `extra`, so the source table receives it.
        expect(actionAt(sections, 'columns', 'extra')).toMatchObject({ kind: 'add-column', destination: 'source', tableName: 'users' });
    });

    it('carries the raw definition for keys, foreign keys and indexes', () => {
        const columns = [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 }), column({ name: 'customer_id' }), column({ name: 'code' })];
        const source = table({
            name: 'orders',
            columns,
            indexes: [index({ name: 'orders_code_key', columns: ['code'], isUnique: true, origin: 'u' }), index({ name: 'orders_customer_idx', columns: ['customer_id'] })],
            foreignKeys: [foreignKey({ id: 3, name: 'fk_orders_customer', from: 'customer_id', to: 'id' })],
        });
        const target = table({ name: 'orders', columns });

        const sections = collectTableComparison(source, target, createDefaultComparisonOptions()).sections;

        expect(actionAt(sections, 'keys', 'orders_code_key')).toMatchObject({
            kind: 'add-key',
            destination: 'target',
            key: { name: 'orders_code_key', isPrimary: false, columns: ['code'] },
        });
        expect(actionAt(sections, 'foreignKeys', 'fk_orders_customer')).toMatchObject({
            kind: 'add-foreign-key',
            destination: 'target',
            foreignKeys: [{ id: 3, name: 'fk_orders_customer', from: 'customer_id', to: 'id' }],
        });
        expect(actionAt(sections, 'indexes', 'orders_customer_idx')).toMatchObject({
            kind: 'add-index',
            destination: 'target',
            index: { name: 'orders_customer_idx', columns: ['customer_id'] },
        });
    });

    it('offers to create a table that only exists on one side', () => {
        const source = table({ name: 'users', columns: [column({ name: 'id' })] });
        const target = table({ name: 'audit', columns: [column({ name: 'id' })] });

        const overview = collectDatabaseComparison([source], [target], createDefaultComparisonOptions()).sections[0];
        const auditIndex = overview.rows.findIndex((row) => row.Table === 'audit');

        expect(overview.actions?.[auditIndex]).toMatchObject({ kind: 'create-table', destination: 'source', tableName: 'audit', label: 'table "audit"' });
    });

    it('gives changed rows no action', () => {
        const source = table({ name: 'users', columns: [column({ name: 'name', type: 'varchar(255)' })] });
        const target = table({ name: 'users', columns: [column({ name: 'name', type: 'text' })] });

        const sections = collectTableComparison(source, target, createDefaultComparisonOptions()).sections;

        expect(sections.find((section) => section.id === 'columns')?.actions).toBeUndefined();
    });
});
