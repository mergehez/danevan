export type TabGrouping = 'none' | 'added' | 'server' | 'database';

export type TabOrderMode = {
    grouping: TabGrouping;
    sortByName: boolean;
};

/**
 * The key a display order is remembered under: `default` for the plain order (no grouping, no sort),
 * `server`, `database`, `added`, and a `_sorted` suffix when names are sorted. Switching back to a
 * combination therefore restores the order that combination had.
 */
export function tabOrderModeKey(grouping: TabGrouping, sortByName: boolean) {
    const group = grouping === 'none' ? 'default' : grouping;
    return sortByName ? `${group}_sorted` : group;
}

export type TabOrderOptions<T extends { hash: string }> = {
    grouping: TabGrouping;
    sortByName: boolean;
    /** The order the tabs were opened in, independent of later drags. */
    addedOrder: string[];
    /** The order this mode was left in, when the user has dragged its tabs. */
    savedOrder?: string[];
    /** The group a tab belongs to (a server or database label). */
    groupLabel: (tab: T) => string;
    /** The label sorted by "sort by name". */
    name: (tab: T) => string;
};

function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

/**
 * The order the table tabs are shown in. Grouping only orders a copy: the stored tab list keeps the
 * plain order, so a grouping never rewrites it, and each mode keeps the order it was left in.
 */
export function orderTabs<T extends { hash: string }>(tabs: T[], options: TabOrderOptions<T>): T[] {
    const baseIndex = new Map(tabs.map((tab, index) => [tab.hash, index] as const));
    const addedIndex = new Map(options.addedOrder.map((hash, index) => [hash, index] as const));
    const grouped = options.grouping === 'server' || options.grouping === 'database';
    const basePosition = (tab: T) => {
        const position = options.grouping === 'added' ? addedIndex.get(tab.hash) : baseIndex.get(tab.hash);
        // A tab the mode has never seen (opened after the order was recorded) sorts last.
        return position ?? Number.MAX_SAFE_INTEGER;
    };

    let ordered = [...tabs];

    if (grouped) {
        ordered.sort((left, right) => compareText(options.groupLabel(left), options.groupLabel(right)) || basePosition(left) - basePosition(right));
    } else if (options.grouping === 'added') {
        ordered.sort((left, right) => basePosition(left) - basePosition(right) || (baseIndex.get(left.hash) ?? 0) - (baseIndex.get(right.hash) ?? 0));
    }

    if (options.sortByName) {
        ordered.sort((left, right) => {
            if (grouped) {
                const groupDifference = compareText(options.groupLabel(left), options.groupLabel(right));

                if (groupDifference) {
                    return groupDifference;
                }
            }

            return compareText(options.name(left), options.name(right)) || (baseIndex.get(left.hash) ?? 0) - (baseIndex.get(right.hash) ?? 0);
        });
    }

    if (options.savedOrder?.length) {
        const savedIndex = new Map(options.savedOrder.map((hash, index) => [hash, index] as const));
        ordered = [...ordered].sort((left, right) => (savedIndex.get(left.hash) ?? Number.MAX_SAFE_INTEGER) - (savedIndex.get(right.hash) ?? Number.MAX_SAFE_INTEGER));
    }

    return ordered;
}

export type TabGroup<T> = {
    /** Stable identity of the group (a server or connection); `all` when nothing is grouped. */
    key: string;
    label: string;
    tabs: T[];
};

/**
 * The groups a grouped tab row renders: one row per server or database, each in its own order. The
 * saved order applies inside a group, so dragging a row cannot move tabs between the rows.
 */
export function orderTabGroups<T extends { hash: string }>(tabs: T[], options: TabOrderOptions<T> & { groupKey?: (tab: T) => string }): TabGroup<T>[] {
    const grouped = options.grouping === 'server' || options.grouping === 'database';
    const ordered = orderTabs(tabs, { ...options, savedOrder: undefined });
    const savedIndex = new Map((options.savedOrder ?? []).map((hash, index) => [hash, index] as const));
    const applySaved = (list: T[]) =>
        savedIndex.size > 0
            ? [...list].sort((left, right) => (savedIndex.get(left.hash) ?? Number.MAX_SAFE_INTEGER) - (savedIndex.get(right.hash) ?? Number.MAX_SAFE_INTEGER))
            : list;

    if (!grouped) {
        return [{ key: 'all', label: '', tabs: applySaved(ordered) }];
    }

    const groups = new Map<string, TabGroup<T>>();

    for (const tab of ordered) {
        const label = options.groupLabel(tab);
        const key = options.groupKey?.(tab) ?? label;
        const group = groups.get(key) ?? { key, label, tabs: [] };
        group.tabs.push(tab);
        groups.set(key, group);
    }

    return [...groups.values()]
        .sort((left, right) => compareText(left.label, right.label) || compareText(left.key, right.key))
        .map((group) => ({ ...group, tabs: applySaved(group.tabs) }));
}
