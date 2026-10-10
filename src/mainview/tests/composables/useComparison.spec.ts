// Orchestration for table/database comparison: which databases are offered as
// targets, when a comparison actually runs, how ignore options change it and how
// they persist, and how swapping flips added/removed.
import type { TableColumnInfo, TableInfo } from '../../../shared/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const holders = vi.hoisted(() => ({
    connections: [] as Array<Record<string, unknown>>,
    servers: [] as Array<Record<string, unknown>>,
    tableNames: {} as Record<number, string[]>,
    tableInfos: {} as Record<string, Record<string, unknown> | undefined>,
    calls: [] as Array<{ kind: 'tables' | 'info'; connectionId: number; tableName?: string; force: boolean }>,
    modifyTableCalls: [] as Array<Record<string, unknown>>,
    ddlCalls: [] as Array<Record<string, unknown>>,
    queryCalls: [] as Array<Record<string, unknown>>,
    confirmCount: 0,
    confirmResult: true,
    reset: undefined as undefined | (() => void),
}));

vi.mock('../../composables/useConnections', async () => {
    const { reactive } = await import('vue');
    const tablesState = reactive<Record<number, { loaded: boolean; loading: boolean; tables: Array<{ name: string; type: 'table'; rowCount: number }> }>>({});
    const detailsState = reactive<Record<string, { loaded: boolean; loading: boolean; info?: Record<string, unknown> }>>({});

    holders.reset = () => {
        for (const key of Object.keys(tablesState)) {
            delete tablesState[Number(key)];
        }

        for (const key of Object.keys(detailsState)) {
            delete detailsState[key];
        }
    };

    return {
        useConnections: () => ({
            get connections() {
                return holders.connections;
            },
            getConnectionTablesState(connectionId: number) {
                tablesState[connectionId] ??= { loaded: false, loading: false, tables: [] };
                return tablesState[connectionId];
            },
            getTableDetailsState(connectionId: number, tableName: string) {
                const key = `${connectionId}:${tableName}`;
                detailsState[key] ??= { loaded: false, loading: false };
                return detailsState[key];
            },
            async ensureConnectionTables(connectionId: number, force = false) {
                holders.calls.push({ kind: 'tables', connectionId, force });
                const state = (tablesState[connectionId] ??= { loaded: false, loading: false, tables: [] });
                state.tables = (holders.tableNames[connectionId] ?? []).map((name) => ({ name, type: 'table' as const, rowCount: 0 }));
                state.loaded = true;
            },
            async ensureTableDetails(connectionId: number, tableName: string, force = false) {
                holders.calls.push({ kind: 'info', connectionId, tableName, force });
                const info = holders.tableInfos[`${connectionId}:${tableName}`];

                if (info) {
                    detailsState[`${connectionId}:${tableName}`] = { loaded: true, loading: false, info };
                }
            },
            async ensureTableDetailsBatch(connectionId: number, tableNames: string[], force = false) {
                for (const tableName of tableNames) {
                    holders.calls.push({ kind: 'info', connectionId, tableName, force });
                    const info = holders.tableInfos[`${connectionId}:${tableName}`];

                    if (info) {
                        detailsState[`${connectionId}:${tableName}`] = { loaded: true, loading: false, info };
                    }
                }
            },
        }),
    };
});

vi.mock('../../composables/useServers', () => ({
    useServers: () => ({
        get servers() {
            return holders.servers;
        },
    }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        getTableDdl: {
            run: async (params: Record<string, unknown>) => {
                holders.ddlCalls.push(params);
                return 'CREATE TABLE `menus` (`id` int NOT NULL)';
            },
        },
        runQuery: {
            run: async (params: Record<string, unknown>) => {
                holders.queryCalls.push(params);
                return { kind: 'mutation', lastInsertRowid: 0 };
            },
        },
        modifyTable: {
            run: async (params: Record<string, unknown>) => {
                holders.modifyTableCalls.push(params);
                return {};
            },
        },
    },
}));

vi.mock('../../lib/utils', () => ({
    confirmAction: async () => {
        holders.confirmCount += 1;
        return holders.confirmResult;
    },
}));

import { _useComparison } from '../../composables/useComparison';
import { comparisonOptionsStorageKey } from '../../lib/comparisonOptions';

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

function tableInfo(name: string, columns: TableColumnInfo[]): TableInfo {
    return { name, columns, indexes: [], foreignKeys: [], rowCount: 0 };
}

function connection(id: number, serverId: number, name: string) {
    return { id, server_id: serverId, name, database_name: name };
}

function server(id: number, name: string, driver: string) {
    return { id, name, driver, kind: 'server' };
}

function ids(options: Array<{ value: number }>) {
    return options.map((option) => option.value);
}

describe('useComparison', () => {
    beforeEach(() => {
        localStorage.clear();
        holders.connections = [connection(10, 1, 'main'), connection(11, 2, 'stage'), connection(12, 3, 'analytics')];
        holders.servers = [server(1, 'prod', 'mysql'), server(2, 'staging', 'mysql'), server(3, 'reports', 'postgresql')];
        holders.tableNames = {};
        holders.tableInfos = {};
        holders.calls = [];
        holders.modifyTableCalls = [];
        holders.ddlCalls = [];
        holders.queryCalls = [];
        holders.confirmCount = 0;
        holders.confirmResult = true;
        holders.reset?.();
    });

    it('reads each side live once instead of trusting the metadata cache', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');

        // Each side is force-read exactly once: later picks reuse that live read.
        const forcedReads = holders.calls.filter((call) => call.kind === 'info' && call.force);
        expect(forcedReads.map((call) => call.connectionId)).toEqual([10, 11]);
    });

    it('offers only same-driver databases as targets, and the source itself for table comparisons', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        expect(ids(comparison.targetConnectionOptions)).toEqual([10, 11]);
        expect(comparison.canCompare).toBe(false);
    });

    it('compares only after a target table is picked', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'name', type: 'varchar(255)' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'name', type: 'text' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        expect(comparison.canCompare).toBe(false);

        await comparison.selectTargetTable('users');
        expect(comparison.canCompare).toBe(true);
        expect(comparison.differenceCount).toBe(1);
        expect(comparison.visibleSections.find((section) => section.id === 'columns')?.rows).toEqual([
            { Column: 'name', Attribute: 'type', Source: 'varchar(255)', Target: 'text', Status: 'changed' },
        ]);
    });

    it('applies ignore options and persists them across instances', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [
            column({ name: 'name', type: 'text', defaultValue: 'guest', collation: 'utf8mb4_general_ci', onUpdate: 'CURRENT_TIMESTAMP' }),
        ]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'name', type: 'text', collation: 'utf8mb4_bin' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');
        expect(comparison.differenceCount).toBe(3);

        comparison.toggleOption('columns.ignoreDefaultValue');
        comparison.toggleOption('columns.ignoreCollation');
        comparison.toggleOption('columns.ignoreOnUpdate');
        expect(comparison.differenceCount).toBe(0);
        expect(comparison.getOption('columns.ignoreDefaultValue')).toBe(true);

        await nextTick();
        expect(localStorage.getItem(comparisonOptionsStorageKey)).toContain('"ignoreDefaultValue":true');

        // A fresh instance (what a reopened modal gets) reads the persisted rules.
        const reopened = _useComparison();
        await reopened.openTableComparison({ connectionId: 10, tableName: 'users' });
        await reopened.selectTargetConnection(11);
        await reopened.selectTargetTable('users');
        expect(reopened.differenceCount).toBe(0);
    });

    it('swaps source and target so added and removed flip', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' }), column({ name: 'legacy' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' }), column({ name: 'email' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');

        const statuses = () => (comparison.visibleSections.find((section) => section.id === 'columns')?.rows ?? []).map((row) => [row.Column, row.Status]);
        expect(statuses()).toEqual([
            ['legacy', 'added'],
            ['email', 'removed'],
        ]);

        await comparison.swapSides();
        expect(comparison.sourceConnectionLabel).toContain('stage');
        expect(statuses()).toEqual([
            ['email', 'added'],
            ['legacy', 'removed'],
        ]);
    });

    it('overviews a database comparison and details only the differing tables', async () => {
        holders.tableNames = { 10: ['users', 'orders'], 11: ['users', 'orders', 'audit'] };
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['10:orders'] = tableInfo('orders', [column({ name: 'total', type: 'int' })]);
        holders.tableInfos['11:orders'] = tableInfo('orders', [column({ name: 'total', type: 'bigint' })]);
        holders.tableInfos['11:audit'] = tableInfo('audit', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openDatabaseComparison({ connectionId: 10 });
        expect(ids(comparison.targetConnectionOptions)).toEqual([11]);

        await comparison.selectTargetConnection(11);
        expect(comparison.canCompare).toBe(true);
        expect(comparison.differenceCount).toBe(2);
        expect(comparison.sections[0].rows).toEqual([
            { Table: 'users', Status: 'identical', Differences: '—' },
            { Table: 'orders', Status: 'changed', Differences: '1 difference' },
            { Table: 'audit', Status: 'removed', Differences: 'missing in source' },
        ]);
        expect(comparison.visibleSections[0].rows).toEqual([
            { Table: 'orders', Status: 'changed', Differences: '1 difference' },
            { Table: 'audit', Status: 'removed', Differences: 'missing in source' },
        ]);
    });

    it('resets the comparison when the modal closes', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        comparison.closeModal();

        expect(comparison.open).toBe(false);
        expect(comparison.sourceConnectionId).toBeUndefined();
        expect(comparison.visibleSections).toEqual([]);
    });

    it('tracks breaking changes and lets foreign key changes opt in', async () => {
        holders.tableInfos['10:orders'] = tableInfo('orders', [column({ name: 'total', type: 'int' }), column({ name: 'customer_id' })]);
        holders.tableInfos['11:orders'] = tableInfo('orders', [column({ name: 'total', type: 'bigint' }), column({ name: 'customer_id' })]);
        holders.tableInfos['10:orders']!.foreignKeys = [
            { id: 1, name: 'fk_customer', sequence: 0, table: 'customers', from: 'customer_id', to: 'id', onUpdate: 'NO ACTION', onDelete: 'NO ACTION', match: 'NONE' },
        ];
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'orders' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('orders');

        // The type change is breaking; the added foreign key is not, by default.
        expect(comparison.breakingCount).toBe(1);
        expect(comparison.breakingChanges.map((change) => change.text)).toEqual(['Column "orders.total" type would change from int to bigint']);
        // ... but the results must own up to what the option is hiding.
        expect(comparison.ignoredBreakingCount).toBe(1);

        comparison.setOption('foreignKeys.ignoreBreaking', false);
        expect(comparison.breakingCount).toBe(2);
        expect(comparison.ignoredBreakingCount).toBe(0);
        expect(comparison.breakingChanges.map((change) => change.text)).toContain('Foreign key "orders.fk_customer" would be added');
    });

    it('counts a dropped table as breaking in a database comparison', async () => {
        holders.tableNames = { 10: ['users'], 11: ['users', 'audit'] };
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['11:audit'] = tableInfo('audit', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openDatabaseComparison({ connectionId: 10 });
        await comparison.selectTargetConnection(11);

        expect(comparison.breakingCount).toBe(1);
        expect(comparison.breakingChanges[0].text).toBe('Table "audit" exists only in the target and would be dropped, losing its data');
    });

    it('adds a missing column to the target after confirmation', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' }), column({ name: 'email', type: 'text', notNull: true })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');

        const action = comparison.visibleSections.find((section) => section.id === 'columns')?.actions?.[0];
        expect(action).toMatchObject({ kind: 'add-column', destination: 'target', label: 'column "email" (text, not null)' });
        expect(comparison.getFixTooltip(action!)).toBe('Add column "email" (text, not null) to stage — staging');

        await comparison.applyFix(action!);

        expect(holders.confirmCount).toBe(1);
        expect(holders.modifyTableCalls).toHaveLength(1);
        expect(holders.modifyTableCalls[0].connectionId).toBe(11);
        expect(holders.modifyTableCalls[0].tableName).toBe('users');
        expect((holders.modifyTableCalls[0].columns as Array<{ name: string }>).map((entry) => entry.name)).toEqual(['id', 'email']);
        expect(comparison.applyingFixKey).toBeUndefined();
        // The changed side is re-read live so the row disappears.
        expect(holders.calls.filter((call) => call.kind === 'info' && call.connectionId === 11 && call.force)).toHaveLength(2);
    });

    it('does nothing when the confirmation is declined', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' }), column({ name: 'email' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.confirmResult = false;
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');

        const action = comparison.visibleSections.find((section) => section.id === 'columns')?.actions?.[0];
        await comparison.applyFix(action!);

        expect(holders.confirmCount).toBe(1);
        expect(holders.modifyTableCalls).toHaveLength(0);
    });

    it('creates a missing table from the donor DDL', async () => {
        holders.tableNames = { 10: ['users', 'menus'], 11: ['users'] };
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'id' })]);
        holders.tableInfos['10:menus'] = tableInfo('menus', [column({ name: 'id' })]);
        const comparison = _useComparison();

        await comparison.openDatabaseComparison({ connectionId: 10 });
        await comparison.selectTargetConnection(11);

        const overview = comparison.visibleSections[0];
        const menusIndex = overview.rows.findIndex((row) => row.Table === 'menus');
        const action = overview.actions?.[menusIndex];
        expect(action).toMatchObject({ kind: 'create-table', destination: 'target', tableName: 'menus' });

        await comparison.applyFix(action!);

        expect(holders.ddlCalls[0]).toEqual({ connectionId: 10, tableName: 'menus' });
        expect(holders.queryCalls[0]).toMatchObject({ connectionId: 11, sql: 'CREATE TABLE `menus` (`id` int NOT NULL)' });
        expect(holders.modifyTableCalls).toHaveLength(0);
    });

    it('refuses to add a primary key when the destination already has one', async () => {
        holders.tableInfos['10:users'] = tableInfo('users', [column({ name: 'id', isPrimaryKey: true, primaryKeyOrdinal: 1 })]);
        holders.tableInfos['11:users'] = tableInfo('users', [column({ name: 'tenant_id', isPrimaryKey: true, primaryKeyOrdinal: 1 })]);
        const comparison = _useComparison();

        await comparison.openTableComparison({ connectionId: 10, tableName: 'users' });
        await comparison.selectTargetConnection(11);
        await comparison.selectTargetTable('users');

        const action = comparison.visibleSections.find((section) => section.id === 'keys')?.actions?.[0];
        expect(action).toMatchObject({ kind: 'add-key', key: { isPrimary: true } });
        expect(comparison.canApplyFix(action!)).toBe(false);
        expect(comparison.getFixTooltip(action!)).toContain('already has a primary key');

        await comparison.applyFix(action!);
        expect(holders.modifyTableCalls).toHaveLength(0);
    });
});
