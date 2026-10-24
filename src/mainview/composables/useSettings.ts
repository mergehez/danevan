import { computed, reactive } from 'vue';
import { useCache } from '../../shared/utils/useCache';
import type { TabGrouping } from '../lib/tabOrdering';

export type Tab = {
    hash: string;
    type: 'table' | 'script' | 'scratch';
    connectionId: number;
    targetId: number;
    pinned: boolean;
    name?: string;
    draftSql?: string;
    tooltip?: string;
};

export function _useSettings() {
    const { state } = useCache({
        key: 'settings',
        initialValue: {
            diffFontSize: 12,
            tabs: [] as Tab[],
            activeTabHash: undefined as string | undefined,
            tabGrouping: 'none' as TabGrouping,
            tabSortByName: false,
            /** Display order per grouping+sort mode (`default`, `server_sorted`, …). */
            tabOrders: {} as Record<string, string[]>,
            /** The order tabs were opened in, so "by add time" ignores later drags. */
            tabAddedOrder: [] as string[],
        },
    });

    return reactive({
        tabs: computed(() => state.value.tabs),
        activeTabHash: computed(() => state.value.activeTabHash),
        diffFontSize: computed(() => state.value.diffFontSize),
        // Older settings blobs predate these fields: read a sane value for each.
        tabGrouping: computed<TabGrouping>(() =>
            state.value.tabGrouping === 'added' || state.value.tabGrouping === 'server' || state.value.tabGrouping === 'database' ? state.value.tabGrouping : 'none'
        ),
        tabSortByName: computed(() => state.value.tabSortByName === true),
        tabOrders: computed(() => state.value.tabOrders ?? {}),
        tabAddedOrder: computed(() => state.value.tabAddedOrder ?? []),
        setDiffFontSize(value: number) {
            state.value.diffFontSize = Math.max(10, Math.min(24, Math.round(value || 12)));
        },
        setTabs(tabs: Tab[]) {
            state.value.tabs = tabs;
        },
        setTabGrouping(grouping: TabGrouping) {
            state.value.tabGrouping = grouping;
        },
        setTabSortByName(sortByName: boolean) {
            state.value.tabSortByName = sortByName;
        },
        setTabOrder(modeKey: string, tabHashes: string[]) {
            state.value.tabOrders = { ...(state.value.tabOrders ?? {}), [modeKey]: tabHashes };
        },
        /** Appends the tabs it has not seen yet, keeping the opening order it already recorded. */
        syncTabAddedOrder(tabHashes: string[]) {
            const current = state.value.tabAddedOrder ?? [];
            const present = new Set(tabHashes);
            const known = new Set(current);
            const next = current.filter((hash) => present.has(hash));

            for (const hash of tabHashes) {
                if (!known.has(hash)) {
                    next.push(hash);
                }
            }

            if (next.length !== current.length || next.some((hash, index) => hash !== current[index])) {
                state.value.tabAddedOrder = next;
            }
        },
        setActiveTab(tab: Tab | undefined) {
            if (tab?.hash === state.value.activeTabHash && (!!tab || !state.value.activeTabHash)) {
                return;
            }

            state.value.activeTabHash = tab?.hash;
        },
    });
}

let settingsSingleton: ReturnType<typeof _useSettings> | undefined;

export function useSettings() {
    settingsSingleton ??= _useSettings();
    return settingsSingleton;
}
