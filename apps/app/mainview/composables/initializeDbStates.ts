import { _dbCoreState } from '@composables/dbCoreState';
import { useDbSettings } from '@composables/useDbSettings';
import { useQuery } from '@composables/useQuery';
import { tasks } from '@composables/useTasks';
import { onMounted } from 'vue';

let hasLoadedBootstrap = false;

export function initializeDbStates() {
    const settings = useDbSettings();
    const query = useQuery();

    onMounted(() => {
        if (hasLoadedBootstrap) {
            return;
        }

        hasLoadedBootstrap = true;

        void (async () => {
            const nextBootstrap = await tasks.getBootstrap.run(undefined);
            _dbCoreState.applyBootstrap(nextBootstrap);
            await settings.load();
            await query.loadTables();
        })();
    });
}
