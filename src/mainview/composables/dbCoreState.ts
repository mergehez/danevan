import { reactive } from 'vue';
import type { AppBootstrapApi, ConnectionRecord, ScriptRecord, ServerRecord } from '../../shared/types';

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

/** Incremented per selection change; only the newest may apply its bootstrap. */
let selectionSequence = 0;

/**
 * Applies the bootstrap of a selection change (connection, server, script) only if it is still the
 * newest one. Selection is a snapshot of the whole app context, so a slow earlier answer used to
 * revert the sidebar, the grid's target and the run target to the selection the user had left.
 */
export async function applySelectionBootstrap(run: () => Promise<AppBootstrapApi>): Promise<AppBootstrapApi> {
    const sequence = ++selectionSequence;
    const nextBootstrap = await run();

    if (sequence === selectionSequence) {
        _dbCoreState.applyBootstrap(nextBootstrap);
    }

    return nextBootstrap;
}
