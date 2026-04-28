import { _dbCoreState } from '@composables/dbCoreState';
import { tasks } from '@composables/useTasks';
import { confirmAction } from '@lib/utils';
import type { CreateScriptParams, UpdateScriptParams } from '@utils/appClient';
import { reactive } from 'vue';

export function _useScriptsDb() {
    return reactive({
        get scripts() {
            return [..._dbCoreState.scripts].sort(
                (left, right) =>
                    (left.group_name || '').localeCompare(right.group_name || '') || Number(left.sequence) - Number(right.sequence) || left.name.localeCompare(right.name)
            );
        },
        get selectedScriptId() {
            return _dbCoreState.selectedScriptId;
        },
        get selectedScript() {
            return _dbCoreState.scripts.find((script) => script.id === _dbCoreState.selectedScriptId);
        },
        get selectedConnectionScripts() {
            return _dbCoreState.scripts
                .filter((script) => script.connection_id === _dbCoreState.selectedConnectionId)
                .sort(
                    (left, right) =>
                        (left.group_name || '').localeCompare(right.group_name || '') || Number(left.sequence) - Number(right.sequence) || left.name.localeCompare(right.name)
                );
        },
        async selectScript(scriptId: number | undefined) {
            const nextBootstrap = await tasks.selectScript.run({ scriptId });
            _dbCoreState.applyBootstrap(nextBootstrap);
        },
        async createScript(script: CreateScriptParams) {
            const nextBootstrap = await tasks.createScript.run(script);
            _dbCoreState.applyBootstrap(nextBootstrap);
        },
        async updateScript(scriptId: number, script: UpdateScriptParams) {
            const nextBootstrap = await tasks.updateScript.run({ scriptId, script });
            _dbCoreState.applyBootstrap(nextBootstrap);
        },
        async deleteScript(scriptId: number) {
            const script = _dbCoreState.scripts.find((entry) => entry.id === scriptId);

            if (
                !(await confirmAction({
                    title: 'Delete script?',
                    message: script?.name ? `This will permanently delete ${script.name}.` : 'This will permanently delete the selected script.',
                    detail: 'The stored SQL text and script metadata cannot be recovered afterwards.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            const nextBootstrap = await tasks.deleteScript.run({ scriptId });
            _dbCoreState.applyBootstrap(nextBootstrap);
        },
    });
}

let scriptsSingleton: ReturnType<typeof _useScriptsDb> | undefined;

export function useScriptsDb() {
    scriptsSingleton ??= _useScriptsDb();
    return scriptsSingleton;
}
