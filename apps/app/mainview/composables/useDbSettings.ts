import { tasks } from '@composables/useTasks';
import type { CollectionFilterState, EditorApp, EditorSettings, SettingsPanel } from '@utils/appClient';
import { computed, reactive, ref } from 'vue';

function normalizeLabel(path: string, label?: string) {
    const fallbackLabel = path.split(/[/\\]/).pop() || path;
    return (label?.trim() || fallbackLabel).replace(/\.app$|\.exe$/i, '');
}

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
        editors: [],
        defaultEditorPath: undefined,
        queryRowLimit: 100,
        activeView: 'servers',
        collectionFilter: getDefaultCollectionFilter(),
    } as EditorSettings);

    return reactive({
        state: state,
        isSettingsModalOpen: false,
        selectedSettingsPanel: 'editors' as SettingsPanel,
        async load() {
            state.value = await tasks.getEditorSettings.run(undefined);
        },
        async update(nextSettings: EditorSettings) {
            state.value = await tasks.updateEditorSettings.run({ settings: nextSettings });
        },
        async toggleCollectionState<T extends keyof CollectionFilterState>(key: T, subKey: keyof CollectionFilterState[T]) {
            state.value = await tasks.updateEditorSettings.run({
                settings: {
                    ...state.value,
                    collectionFilter: {
                        ...state.value.collectionFilter,
                        [key]: {
                            ...state.value.collectionFilter[key],
                            [subKey]: state.value.collectionFilter[key][subKey] == false,
                        },
                    },
                },
            });
        },
        async setActiveView(nextView: EditorSettings['activeView']) {
            if (state.value.activeView === nextView) {
                return;
            }

            await this.update({
                ...state.value,
                activeView: nextView,
            });
        },
        async pickEditorApplication() {
            const editor = await tasks.pickEditorApplication.run(undefined);

            if (!editor) {
                return undefined;
            }

            return {
                path: editor.path,
                label: normalizeLabel(editor.path, editor.label),
            } satisfies EditorApp;
        },
        async addEditor(editor: EditorApp) {
            const nextEditors = [
                ...state.value.editors.filter((entry) => entry.path !== editor.path),
                {
                    path: editor.path,
                    label: normalizeLabel(editor.path, editor.label),
                },
            ].sort((left, right) => left.label.localeCompare(right.label));

            await this.update({
                ...state.value,
                editors: nextEditors,
                defaultEditorPath: state.value.defaultEditorPath ?? editor.path,
            });
        },
        async setDefaultEditor(path: string | undefined) {
            await this.update({
                ...state.value,
                defaultEditorPath: path,
            });
        },
        async setQueryRowLimit(limit: number) {
            await this.update({
                ...state.value,
                queryRowLimit: Math.round(limit),
            });
        },
        openSettingsWindow(panel?: SettingsPanel) {
            this.selectedSettingsPanel = panel ?? 'editors';
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
