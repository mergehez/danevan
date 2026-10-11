import { reactive } from 'vue';
import type { AppBootstrapApi, ConnectionRecord, ScriptRecord, ServerRecord } from '../../shared/types';

export const _dbCoreState = reactive({
    stateCounter: 0,
    /** Version of the newest bootstrap applied; an older snapshot is ignored. */
    bootstrapVersion: 0,
    servers: [] as ServerRecord[],
    connections: [] as ConnectionRecord[],
    scripts: [] as ScriptRecord[],
    selectedServerId: undefined as number | undefined,
    selectedConnectionId: undefined as number | undefined,
    selectedScriptId: undefined as number | undefined,

    applyBootstrap(nextBootstrap: AppBootstrapApi) {
        // Bootstraps are full snapshots of the app database. The backend stamps each one, so a slow
        // answer that was built before a later action (a selection, a hide, a delete) is dropped
        // instead of reverting the state that action produced. A snapshot without a version comes
        // from a test or an older caller and is applied as before.
        if (nextBootstrap.version !== undefined && nextBootstrap.version <= _dbCoreState.bootstrapVersion) {
            return;
        }

        _dbCoreState.bootstrapVersion = nextBootstrap.version ?? _dbCoreState.bootstrapVersion + 1;
        _dbCoreState.servers = nextBootstrap.servers;
        _dbCoreState.connections = nextBootstrap.connections;
        _dbCoreState.scripts = nextBootstrap.scripts;
        _dbCoreState.selectedServerId = nextBootstrap.selectedServerId;
        _dbCoreState.selectedConnectionId = nextBootstrap.selectedConnectionId;
        _dbCoreState.selectedScriptId = nextBootstrap.selectedScriptId;
        _dbCoreState.stateCounter++;
    },
});
