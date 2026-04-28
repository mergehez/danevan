import { useCache } from '@utils/useCache';
import { computed, reactive } from 'vue';

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
        },
    });

    return reactive({
        tabs: computed(() => state.value.tabs),
        activeTabHash: computed(() => state.value.activeTabHash),
        diffFontSize: computed(() => state.value.diffFontSize),
        setDiffFontSize(value: number) {
            state.value.diffFontSize = Math.max(10, Math.min(24, Math.round(value || 12)));
        },
        setTabs(tabs: Tab[]) {
            state.value.tabs = tabs;
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
