import { _dbCoreState } from '@composables/dbCoreState';
import type { ConnectionSchemaCache, ServerSchemaRecord, TableInfo, TableSummary } from '@utils/appClient';
import { resetCacheState, useCache } from '@utils/useCache';
import { reactive, ref, watch } from 'vue';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METADATA_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const SCHEMA_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CachedServerSchemas = {
    cachedAt: string;
    schemas: ServerSchemaRecord[];
};

export type PersistedTreeState = {
    collapsed?: boolean;
    groups?: Record<string, boolean>;
};

// ---------------------------------------------------------------------------
// Cache freshness helpers
// ---------------------------------------------------------------------------

function isCacheFresh(cachedAt: string | undefined, maxAgeMs: number) {
    if (!cachedAt) {
        return false;
    }

    const cachedAtMs = Date.parse(cachedAt);

    if (Number.isNaN(cachedAtMs)) {
        return false;
    }

    return Date.now() - cachedAtMs <= maxAgeMs;
}

export function isMetadataCacheFresh(cachedAt: string | undefined) {
    return isCacheFresh(cachedAt, METADATA_CACHE_MAX_AGE_MS);
}

export function isSchemaCacheFresh(cachedAt: string | undefined) {
    return isCacheFresh(cachedAt, SCHEMA_CACHE_MAX_AGE_MS);
}

export function hasConnectionSchemaChildren(cache: ConnectionSchemaCache | undefined) {
    if (!cache) {
        return false;
    }

    return cache.tables.length > 0 || Object.keys(cache.tableInfoByName).length > 0;
}

export function hasServerSchemaChildren(cache: CachedServerSchemas | undefined) {
    return Boolean(cache?.schemas.length);
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function _useDbCaches() {
    // --- Schema cache (from useServers) ---

    const { state: cachedSchemasState } = useCache<Record<number, CachedServerSchemas>>({
        key: 'serverSchemasCache',
        initialValue: {},
    });

    // --- Connection metadata cache (from useConnections) ---

    const { state: connectionSchemaCacheState } = useCache<Record<number, ConnectionSchemaCache>>({
        key: 'connectionMetadataCache',
        initialValue: {},
    });

    // --- Tree collapse/expansion state (from useServerTree) ---

    const collapseStateVersion = ref(0);
    const collectionFilterVersion = ref(0);

    const getServerTreeStorageKey = (serverId: number) => `db-sidebar-tree:${serverId}`;

    function getPersistedTreeState(serverId: number): PersistedTreeState {
        const storageKey = getServerTreeStorageKey(serverId);
        const rawValue = (collapseStateVersion.value, localStorage.getItem(storageKey));

        if (!rawValue) {
            return {};
        }

        try {
            return JSON.parse(rawValue) as PersistedTreeState;
        } catch {
            return {};
        }
    }

    function setPersistedTreeState(serverId: number, nextState: PersistedTreeState) {
        localStorage.setItem(getServerTreeStorageKey(serverId), JSON.stringify(nextState));
        collapseStateVersion.value += 1;
    }

    // --- Collection filter (from useServerTree) ---

    // --- Schema cache methods ---

    function getCachedServerSchemas(serverId: number) {
        const cache = cachedSchemasState.value[serverId];
        return isSchemaCacheFresh(cache?.cachedAt) && hasServerSchemaChildren(cache) ? cache.schemas : undefined;
    }

    function applyServerSchemas(serverId: number, schemas: ServerSchemaRecord[]) {
        cachedSchemasState.value[serverId] = {
            cachedAt: new Date().toISOString(),
            schemas,
        };
    }

    function clearServerSchemas(serverId: number) {
        delete cachedSchemasState.value[serverId];
    }

    function clearAllServerSchemas() {
        for (const key of Object.keys(cachedSchemasState.value)) {
            delete cachedSchemasState.value[Number(key)];
        }
    }

    // --- Connection metadata cache methods ---

    function getCachedConnectionSchema(connectionId: number) {
        const cache = connectionSchemaCacheState.value[connectionId];
        return isMetadataCacheFresh(cache?.cachedAt) && hasConnectionSchemaChildren(cache) ? cache : undefined;
    }

    function clearConnectionMetadataCache(connectionId: number) {
        delete connectionSchemaCacheState.value[connectionId];
    }

    function clearAllConnectionMetadata() {
        for (const key of Object.keys(connectionSchemaCacheState.value)) {
            delete connectionSchemaCacheState.value[Number(key)];
        }
    }

    function applyConnectionSchemaCache(connectionId: number, cache: ConnectionSchemaCache) {
        connectionSchemaCacheState.value[connectionId] = cache;
    }

    function applyConnectionSnapshotToCache(connectionId: number, tables: TableSummary[], tableInfoByName: Record<string, TableInfo>) {
        const previousTableInfo = connectionSchemaCacheState.value[connectionId]?.tableInfoByName ?? {};

        connectionSchemaCacheState.value[connectionId] = {
            cachedAt: new Date().toISOString(),
            tables,
            tableInfoByName: {
                ...previousTableInfo,
                ...tableInfoByName,
            },
        };
    }

    function applyTableInfoToCache(connectionId: number, tableName: string, tableInfo: TableInfo, fallbackTables?: TableSummary[]) {
        const existingCache = connectionSchemaCacheState.value[connectionId];

        connectionSchemaCacheState.value[connectionId] = {
            cachedAt: new Date().toISOString(),
            tables: existingCache?.tables ?? fallbackTables ?? [],
            tableInfoByName: {
                ...existingCache?.tableInfoByName,
                [tableName]: tableInfo,
            },
        };
    }

    // --- Global cache clearing ---

    function clearSidebarExpansionState() {
        const keysToReset: string[] = [];

        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);

            if (!key) {
                continue;
            }

            if (key.startsWith('db-sidebar-tree:') || key === 'scriptsTree') {
                keysToReset.push(key);
            }
        }

        for (const key of keysToReset) {
            resetCacheState(key);
        }
    }

    function clearAllCaches() {
        clearAllConnectionMetadata();
        clearAllServerSchemas();
        clearSidebarExpansionState();
    }

    // --- Watchers to clean up stale entries ---

    watch(
        () => _dbCoreState.servers.map((server) => server.id),
        (serverIds) => {
            const activeIds = new Set(serverIds);

            for (const key of Object.keys(cachedSchemasState.value)) {
                const serverId = Number(key);

                if (!activeIds.has(serverId)) {
                    delete cachedSchemasState.value[serverId];
                }
            }
        },
        { immediate: true }
    );

    watch(
        () => _dbCoreState.connections.map((connection) => connection.id),
        (connectionIds) => {
            const activeIds = new Set(connectionIds);

            for (const key of Object.keys(connectionSchemaCacheState.value)) {
                const connectionId = Number(key);

                if (!activeIds.has(connectionId)) {
                    delete connectionSchemaCacheState.value[connectionId];
                }
            }
        },
        { immediate: true }
    );

    return reactive({
        // Reactive state (exposed for direct access by other composables)
        cachedSchemasState,
        connectionSchemaCacheState,
        collapseStateVersion,
        collectionFilterVersion,

        // Schema cache
        getCachedServerSchemas,
        applyServerSchemas,
        clearServerSchemas,
        clearAllServerSchemas,

        // Connection metadata cache
        getCachedConnectionSchema,
        clearConnectionMetadataCache,
        clearAllConnectionMetadata,
        applyConnectionSchemaCache,
        applyConnectionSnapshotToCache,
        applyTableInfoToCache,

        // Tree persistence
        getPersistedTreeState,
        setPersistedTreeState,
        getServerTreeStorageKey,

        // Global
        clearSidebarExpansionState,
        clearAllCaches,
    });
}

let dbCachesSingleton: ReturnType<typeof _useDbCaches> | undefined;

export function useDbCaches() {
    dbCachesSingleton ??= _useDbCaches();
    return dbCachesSingleton;
}
