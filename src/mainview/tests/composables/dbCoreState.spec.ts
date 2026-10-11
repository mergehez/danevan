import { beforeEach, describe, expect, it } from 'vitest';
import type { AppBootstrapApi } from '../../../shared/types';
import { _dbCoreState } from '../../composables/dbCoreState';

function bootstrap(version: number, name: string, selectedConnectionId: number | undefined): AppBootstrapApi {
    return {
        version: version,
        servers: [],
        connections: [
            {
                id: selectedConnectionId ?? 0,
                server_id: 1,
                name: name,
                host: undefined,
                port: undefined,
                database_name: undefined,
                readonly: 0,
                sequence: 0,
                created_at: '',
                updated_at: '',
                last_used_at: undefined,
            },
        ],
        scripts: [],
        selectedServerId: 1,
        selectedConnectionId: selectedConnectionId,
        selectedScriptId: undefined,
    };
}

describe('_dbCoreState.applyBootstrap', () => {
    beforeEach(() => {
        // The singleton keeps the highest version it applied; start each case above the previous one.
        _dbCoreState.bootstrapVersion += 100;
    });

    it('applies a newer snapshot', () => {
        _dbCoreState.applyBootstrap(bootstrap(_dbCoreState.bootstrapVersion + 1, 'newer', 7));

        expect(_dbCoreState.connections[0]?.name).toBe('newer');
        expect(_dbCoreState.selectedConnectionId).toBe(7);
    });

    it('ignores a slower answer that was built before the applied one', () => {
        const newestVersion = _dbCoreState.bootstrapVersion + 2;

        _dbCoreState.applyBootstrap(bootstrap(newestVersion, 'newest', 9));
        _dbCoreState.applyBootstrap(bootstrap(newestVersion - 1, 'older', 3));

        // The last action the user took stays; the older snapshot does not revert it.
        expect(_dbCoreState.connections[0]?.name).toBe('newest');
        expect(_dbCoreState.selectedConnectionId).toBe(9);
    });

    it('applies a snapshot without a version, the way a test or an older caller sends one', () => {
        const withoutVersion = bootstrap(_dbCoreState.bootstrapVersion, 'unversioned', 4);
        delete (withoutVersion as { version?: number }).version;

        _dbCoreState.applyBootstrap(withoutVersion);

        expect(_dbCoreState.connections[0]?.name).toBe('unversioned');
        expect(_dbCoreState.selectedConnectionId).toBe(4);
    });
});
