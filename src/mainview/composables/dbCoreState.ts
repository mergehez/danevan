import type { AppBootstrapApi, ConnectionRecord, ScriptRecord, ServerRecord } from '@utils/appClient';
import { reactive } from 'vue';

export const _dbCoreState = reactive({
    stateCounter: 0,
    servers: [] as ServerRecord[],
    connections: [] as ConnectionRecord[],
    scripts: [] as ScriptRecord[],
    selectedServerId: undefined as number | undefined,
    selectedConnectionId: undefined as number | undefined,
    selectedScriptId: undefined as number | undefined,

    applyBootstrap(nextBootstrap: AppBootstrapApi) {
        _dbCoreState.servers = nextBootstrap.servers;
        _dbCoreState.connections = nextBootstrap.connections;
        _dbCoreState.scripts = nextBootstrap.scripts;
        _dbCoreState.selectedServerId = nextBootstrap.selectedServerId;
        _dbCoreState.selectedConnectionId = nextBootstrap.selectedConnectionId;
        _dbCoreState.selectedScriptId = nextBootstrap.selectedScriptId;
        _dbCoreState.stateCounter++;
    },
});
