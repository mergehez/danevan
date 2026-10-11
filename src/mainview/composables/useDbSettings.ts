import { computed, reactive, ref } from 'vue';
import type { CollectionFilterState, EditorSettings, SettingsPanel } from '../../shared/types';
import { tasks } from './useTasks';

// function normalizeLabel(path: string, label?: string) {
//     const fallbackLabel = path.split(/[/\\]/).pop() || path;
//     return (label?.trim() || fallbackLabel).replace(/\.app$|\.exe$/i, '');
// }

function getDefaultCollectionFilter(): CollectionFilterState {
    return {
        connections: {
            tables: true,
            views: true,
        },
        tables: {
            columns: true,
            keys: true,
            indexes: true,
        },
    };
}

export function _useDbSettings() {
    const state = ref({
        queryRowLimit: 100,
        activeView: 'servers',
        collectionFilter: getDefaultCollectionFilter(),
    } as EditorSettings);

    /**
     * Serialises settings writes. Two quick toggles used to build their payload from the same
     * pre-click state, so the later response silently reverted the earlier change.
     */
    let pendingUpdate: Promise<unknown> = Promise.resolve();

    function queueUpdate(build: (current: EditorSettings) => EditorSettings) {
        const next = pendingUpdate.then(async () => {
            state.value = await tasks.updateEditorSettings.run({ settings: build(state.value) });
        });

        pendingUpdate = next.catch(() => undefined);
        return next;
    }

    return reactive({
        state: state,
        isSettingsModalOpen: false,
        selectedSettingsPanel: 'section1' as SettingsPanel,
        async load() {
            state.value = await tasks.getEditorSettings.run(undefined);
        },
        async update(nextSettings: EditorSettings) {
            state.value = await tasks.updateEditorSettings.run({ settings: nextSettings });
        },
        async toggleCollectionState<T extends keyof CollectionFilterState>(key: T, subKey: keyof CollectionFilterState[T]) {
            await queueUpdate((current) => ({
                ...current,
                collectionFilter: {
                    ...current.collectionFilter,
                    [key]: {
                        ...current.collectionFilter[key],
                        [subKey]: current.collectionFilter[key][subKey] == false,
                    },
                },
            }));
        },
        async setActiveView(nextView: EditorSettings['activeView']) {
            if (state.value.activeView === nextView) {
                return;
            }

            await queueUpdate((current) => ({
                ...current,
                activeView: nextView,
            }));
        },
        async setQueryRowLimit(limit: number) {
            await queueUpdate((current) => ({
                ...current,
                queryRowLimit: Math.round(limit),
            }));
        },
        openSettingsWindow(panel?: SettingsPanel) {
            this.selectedSettingsPanel = panel ?? 'section1';
            this.isSettingsModalOpen = true;
        },
        closeSettingsWindow() {
            this.isSettingsModalOpen = false;
        },
        isConnectionFilterFlat: computed(() => {
            const vals = Object.values(state.value.collectionFilter.connections);
            return vals.reduce((last, curr) => last === !!curr, !!vals[0]);
        }),
        isTableFilterFlat: computed(() => {
            const vals = Object.values(state.value.collectionFilter.tables);
            return vals.reduce((last, curr) => last === !!curr, !!vals[0]);
        }),
    });
}

let settingsSingleton: ReturnType<typeof _useDbSettings> | undefined;

export function useDbSettings() {
    settingsSingleton ??= _useDbSettings();
    return settingsSingleton;
}
