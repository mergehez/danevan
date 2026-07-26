import { onMounted } from 'vue';
import { _dbCoreState } from './dbCoreState';
import { useDbSettings } from './useDbSettings';
import { useQuery } from './useQuery';
import { tasks } from './useTasks';

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
