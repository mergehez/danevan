import { onMounted } from 'vue';
import { _dbCoreState } from './dbCoreState';
import { useConnections } from './useConnections';
import { useDbSettings } from './useDbSettings';
import { tasks } from './useTasks';

let hasLoadedBootstrap = false;

export function initializeDbStates() {
    const settings = useDbSettings();
    const connections = useConnections();

    onMounted(() => {
        if (hasLoadedBootstrap) {
            return;
        }

        hasLoadedBootstrap = true;

        void (async () => {
            const nextBootstrap = await tasks.getBootstrap.run(undefined);
            _dbCoreState.applyBootstrap(nextBootstrap);
            await settings.load();

            // Warm the selected connection's table list for the sidebar. The active tab loads its
            // own state when it activates; writing into it here would target whichever tab exists.
            if (_dbCoreState.selectedConnectionId !== undefined) {
                await connections.ensureConnectionTables(_dbCoreState.selectedConnectionId);
            }
        })();
    });
}
