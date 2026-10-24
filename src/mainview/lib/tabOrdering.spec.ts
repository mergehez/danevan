import { describe, expect, it } from 'vitest';
import { orderTabGroups, orderTabs, tabOrderModeKey, type TabOrderOptions } from './tabOrdering';

type TestTab = {
    hash: string;
    name: string;
    group: string;
};

function tab(hash: string, name: string, group = 'server-a'): TestTab {
    return { hash, name, group };
}

function order(tabs: TestTab[], options: Partial<TabOrderOptions<TestTab>> = {}) {
    return orderTabs(tabs, {
        grouping: 'none',
        sortByName: false,
        addedOrder: tabs.map((entry) => entry.hash),
        groupLabel: (entry) => entry.group,
        name: (entry) => entry.name,
        ...options,
    }).map((entry) => entry.hash);
}

describe('tabOrderModeKey', () => {
    it('names every grouping and sort combination', () => {
        expect(tabOrderModeKey('none', false)).toBe('default');
        expect(tabOrderModeKey('none', true)).toBe('default_sorted');
        expect(tabOrderModeKey('added', false)).toBe('added');
        expect(tabOrderModeKey('server', false)).toBe('server');
        expect(tabOrderModeKey('server', true)).toBe('server_sorted');
        expect(tabOrderModeKey('database', true)).toBe('database_sorted');
    });
});

describe('orderTabs', () => {
    const tabs = [tab('zulu', 'zulu'), tab('beta', 'beta', 'server-b'), tab('alpha', 'alpha')];

    it('keeps the stored order when nothing is grouped or sorted', () => {
        expect(order(tabs)).toEqual(['zulu', 'beta', 'alpha']);
    });

    it('by add time ignores a later drag', () => {
        expect(order(tabs, { grouping: 'added', addedOrder: ['beta', 'zulu', 'alpha'] })).toEqual(['beta', 'zulu', 'alpha']);
    });

    it('by server puts one server’s tabs together, keeping the add order inside', () => {
        expect(order(tabs, { grouping: 'server' })).toEqual(['zulu', 'alpha', 'beta']);
    });

    it('by database groups by the database label', () => {
        const mixed = [tab('one', 'one', 'db-b'), tab('two', 'two', 'db-a'), tab('three', 'three', 'db-b')];

        expect(order(mixed, { grouping: 'database' })).toEqual(['two', 'one', 'three']);
    });

    it('sorts by name globally, and inside the groups when grouped', () => {
        expect(order(tabs, { sortByName: true })).toEqual(['alpha', 'beta', 'zulu']);
        expect(order(tabs, { grouping: 'server', sortByName: true })).toEqual(['alpha', 'zulu', 'beta']);
    });

    it('restores the order a mode was left in, with new tabs last', () => {
        expect(order(tabs, { grouping: 'server', savedOrder: ['beta', 'alpha'] })).toEqual(['beta', 'alpha', 'zulu']);
    });

    it('does not let a string order drop a tab it has never seen', () => {
        expect(order(tabs, { savedOrder: ['alpha'] })).toEqual(['alpha', 'zulu', 'beta']);
    });
});

describe('orderTabGroups', () => {
    const tabs = [tab('zulu', 'zulu', 'Server B'), tab('beta', 'beta', 'Server A'), tab('alpha', 'alpha', 'Server A')];

    it('is one unlabelled group when nothing is grouped', () => {
        expect(orderTabGroups(tabs, { grouping: 'none', sortByName: false, addedOrder: [], groupLabel: (entry) => entry.group, name: (entry) => entry.name })).toEqual([
            { key: 'all', label: '', tabs },
        ]);
    });

    it('makes one row per label, sorted by label and keeping the add order inside', () => {
        const groups = orderTabGroups(tabs, { grouping: 'server', sortByName: false, addedOrder: [], groupLabel: (entry) => entry.group, name: (entry) => entry.name });

        expect(groups.map((group) => [group.label, group.tabs.map((entry) => entry.hash)])).toEqual([
            ['Server A', ['beta', 'alpha']],
            ['Server B', ['zulu']],
        ]);
    });

    it('uses the group key for identity, not the label', () => {
        const shared = [tab('one', 'one', 'same'), tab('two', 'two', 'same')];
        const groups = orderTabGroups(shared, {
            grouping: 'server',
            sortByName: false,
            addedOrder: [],
            groupLabel: (entry) => entry.group,
            groupKey: (entry) => `server:${entry.hash === 'one' ? 1 : 2}`,
            name: (entry) => entry.name,
        });

        expect(groups.map((group) => group.key)).toEqual(['server:1', 'server:2']);
    });

    it('applies the saved order inside a group only', () => {
        const groups = orderTabGroups(tabs, {
            grouping: 'server',
            sortByName: false,
            addedOrder: [],
            savedOrder: ['alpha', 'zulu', 'beta'],
            groupLabel: (entry) => entry.group,
            name: (entry) => entry.name,
        });

        expect(groups.map((group) => group.tabs.map((entry) => entry.hash))).toEqual([['alpha', 'beta'], ['zulu']]);
    });
});
