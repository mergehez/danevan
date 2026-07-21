import { _dbCoreState } from '@composables/dbCoreState';
import { useConnections } from '@composables/useConnections';
import { useQuery } from '@composables/useQuery';
import { useScriptsDb } from '@composables/useScriptsDb';
import { useServers } from '@composables/useServers';
import { Tab, useSettings } from '@composables/useSettings';
import { tasks } from '@composables/useTasks';
import { strToNumber, uniqueId } from '@lib/utils';
import type { QueryExecutionResult, SqlDiagnosticMarker } from '@utils/appClient';
import { computed, reactive, watch } from 'vue';

export const CustomEndpointsTag = '_DokieCustoms' as const;

const isScriptTab = (tab: Tab) => tab.type === 'script' || tab.type === 'scratch';

type DisplayTab = Tab & {
    tooltip: string;
};

type ScriptTabRuntimeState = {
    queryResult: QueryExecutionResult | undefined;
    resultPanelTab: 'result' | 'problems';
    scriptProblems: SqlDiagnosticMarker[];
};

function normalizeStoredTab(tab: Tab): Tab {
    return {
        hash: tab.hash,
        type: tab.type,
        connectionId: tab.connectionId,
        targetId: tab.targetId,
        pinned: tab.pinned,
        name: tab.name,
        draftSql: tab.draftSql,
    };
}

const createNavState = () => {
    const settings = useSettings();
    const conns = useConnections();
    const scripts = useScriptsDb();
    const servers = useServers();
    const query = useQuery();
    const closedTabsState = reactive<Tab[]>([]);
    const scriptTabRuntimeStateByHash = reactive<Record<string, ScriptTabRuntimeState | undefined>>({});
    const hydratingTableTabConnectionIds = reactive<Record<number, boolean>>({});
    const hasHydratedBootstrap = computed(() => _dbCoreState.stateCounter > 0);
    let draftSyncTimeout: ReturnType<typeof setTimeout> | undefined;
    let pendingDraftSync: { tabHash: string; draftSql: string } | undefined;

    function setTabs(tabs: Tab[]) {
        settings.setTabs(tabs.map((tab) => normalizeStoredTab(tab)));
    }

    function replaceTab(nextTab: Tab) {
        setTabs(settings.tabs.map((tab) => (tab.hash === nextTab.hash ? nextTab : tab)));
    }

    function flushPendingDraftSync() {
        if (draftSyncTimeout) {
            clearTimeout(draftSyncTimeout);
            draftSyncTimeout = undefined;
        }

        if (!pendingDraftSync) {
            return;
        }

        const { tabHash, draftSql } = pendingDraftSync;
        pendingDraftSync = undefined;
        const currentTab = settings.tabs.find((tab) => tab.hash === tabHash);

        if (!currentTab || (currentTab.type !== 'script' && currentTab.type !== 'scratch') || currentTab.draftSql === draftSql) {
            return;
        }

        replaceTab({
            ...currentTab,
            draftSql,
        });
    }

    function scheduleDraftSync(tabHash: string, draftSql: string) {
        pendingDraftSync = { tabHash, draftSql };

        if (draftSyncTimeout) {
            clearTimeout(draftSyncTimeout);
        }

        draftSyncTimeout = setTimeout(() => {
            flushPendingDraftSync();
        }, 150);
    }

    function updateTabConnection(tabHash: string, connectionId: number) {
        const currentTab = settings.tabs.find((tab) => tab.hash === tabHash);

        if (!currentTab || currentTab.connectionId === connectionId) {
            return;
        }

        replaceTab({
            ...currentTab,
            connectionId,
        });
    }

    function ensureActiveTabExists() {
        if (!settings.activeTabHash) {
            return;
        }

        if (settings.tabs.some((tab) => tab.hash === settings.activeTabHash)) {
            return;
        }

        settings.setActiveTab(settings.tabs[0]);
    }

    function isTabValid(tab: Tab) {
        const connection = conns.connections.find((entry) => entry.id === tab.connectionId);

        if (!connection) {
            return false;
        }

        if (tab.type === 'script') {
            return scripts.scripts.some((script) => script.id === tab.targetId);
        }

        if (tab.type === 'table') {
            const tableName = resolveTableName(tab);

            if (!tableName) {
                return false;
            }

            const tableState = conns.getConnectionTablesState(tab.connectionId);
            return hydratingTableTabConnectionIds[tab.connectionId] || !tableState.loaded || tableState.tables.some((table) => table.name === tableName);
        }

        return true;
    }

    function sanitizeTabs() {
        if (!hasHydratedBootstrap.value) {
            return;
        }

        const validTabs = settings.tabs.filter((tab) => isTabValid(tab));

        if (validTabs.length === settings.tabs.length) {
            return;
        }

        const removedTabs = settings.tabs.filter((tab) => !validTabs.some((entry) => entry.hash === tab.hash));

        if (removedTabs.length > 0) {
            pushClosedTabs(removedTabs);
        }

        setTabs(validTabs);

        if (!validTabs.some((tab) => tab.hash === settings.activeTabHash)) {
            settings.setActiveTab(validTabs[0]);
        }
    }

    function getConnectionName(connectionId: number) {
        const connection = conns.connections.find((entry) => entry.id === connectionId);
        return connection?.database_name || connection?.name || 'Unknown connection';
    }

    function getServerName(connectionId: number) {
        const connection = conns.connections.find((entry) => entry.id === connectionId);
        const server = servers.servers.find((entry) => entry.id === connection?.server_id);
        return server?.name || 'Unknown server';
    }

    function resolveTableName(tab: Tab) {
        return conns.getConnectionTablesState(tab.connectionId).tables.find((table) => strToNumber(table.name) === tab.targetId)?.name ?? tab.name;
    }

    function resolveTabName(tab: Tab) {
        if (tab.type === 'table') {
            return resolveTableName(tab) ?? 'Unknown table';
        }

        if (tab.type === 'script') {
            return scripts.scripts.find((script) => script.id === tab.targetId)?.name ?? tab.name ?? 'Unknown script';
        }

        if (tab.type === 'scratch') {
            return tab.name ?? 'Scratch SQL';
        }

        throw new Error('Unknown tab type: ' + tab.type);
    }

    function resolveTabTooltip(tab: Tab) {
        return [getServerName(tab.connectionId), getConnectionName(tab.connectionId), resolveTabName(tab)].join(' / ');
    }

    function toDisplayTab(tab: Tab) {
        return {
            ...tab,
            name: resolveTabName(tab),
            tooltip: resolveTabTooltip(tab),
        } satisfies DisplayTab;
    }

    function pushClosedTabs(tabs: Tab[]) {
        for (const tab of [...tabs].reverse()) {
            const deduped = closedTabsState.filter((entry) => entry.hash !== tab.hash);
            closedTabsState.splice(0, closedTabsState.length, normalizeStoredTab(tab), ...deduped.slice(0, 19).map((entry) => normalizeStoredTab(entry)));
        }
    }

    function getScriptTabRuntimeState(tabHash: string | undefined) {
        if (!tabHash) {
            return {
                queryResult: undefined,
                resultPanelTab: 'problems' as const,
                scriptProblems: [],
            } satisfies ScriptTabRuntimeState;
        }

        return (
            scriptTabRuntimeStateByHash[tabHash] ?? {
                queryResult: undefined,
                resultPanelTab: 'problems' as const,
                scriptProblems: [],
            }
        );
    }

    function setScriptTabRuntimeState(tabHash: string, nextState: Partial<ScriptTabRuntimeState>) {
        const currentState = getScriptTabRuntimeState(tabHash);

        scriptTabRuntimeStateByHash[tabHash] = {
            queryResult: nextState.queryResult !== undefined ? nextState.queryResult : currentState.queryResult,
            resultPanelTab: nextState.resultPanelTab ?? currentState.resultPanelTab,
            scriptProblems: nextState.scriptProblems ?? currentState.scriptProblems,
        } satisfies ScriptTabRuntimeState;
    }

    function moveScriptTabRuntimeState(fromHash: string, toHash: string) {
        if (fromHash === toHash) {
            return;
        }

        const currentState = scriptTabRuntimeStateByHash[fromHash];

        if (!currentState) {
            return;
        }

        scriptTabRuntimeStateByHash[toHash] = {
            queryResult: currentState.queryResult,
            resultPanelTab: currentState.resultPanelTab,
            scriptProblems: [...currentState.scriptProblems],
        } satisfies ScriptTabRuntimeState;
        delete scriptTabRuntimeStateByHash[fromHash];
    }

    async function hydrateTableTabConnections() {
        if (!hasHydratedBootstrap.value) {
            return;
        }

        const tableTabConnectionIds = [...new Set(settings.tabs.filter((tab) => tab.type === 'table').map((tab) => tab.connectionId))].filter((connectionId) =>
            conns.connections.some((connection) => connection.id === connectionId)
        );

        await Promise.all(
            tableTabConnectionIds.map(async (connectionId) => {
                const tableState = conns.getConnectionTablesState(connectionId);

                if (tableState.loaded || tableState.loading || hydratingTableTabConnectionIds[connectionId]) {
                    return;
                }

                hydratingTableTabConnectionIds[connectionId] = true;

                try {
                    await conns.ensureConnectionTables(connectionId);
                } finally {
                    delete hydratingTableTabConnectionIds[connectionId];
                }
            })
        );
    }

    const selectedTabs = computed(() => settings.tabs.map((tab) => toDisplayTab(tab)));
    const scriptTabs = computed(() => selectedTabs.value.filter((tab) => isScriptTab(tab)));
    const nonScriptTabs = computed(() => selectedTabs.value.filter((tab) => !isScriptTab(tab)));
    const activeTab = computed(() => selectedTabs.value.find((tab) => tab.hash === settings.activeTabHash));

    const selectScript = (scriptId: number) => {
        const script = scripts.scripts.find((s) => s.id === scriptId);
        if (!script) return;
        let tab: Tab | undefined = settings.tabs.find((t) => t.type === 'script' && t.targetId === scriptId);
        if (tab) {
            selectTab(tab);
            return;
        }
        tab = {
            hash: `script-${scriptId}`,
            type: 'script',
            connectionId: script.connection_id,
            targetId: scriptId,
            pinned: false,
            name: script.name,
            draftSql: script.sql_text,
        };
        selectTab(tab);
    };

    const selectTable = (connectionId: number, tableName: string) => {
        let tab: Tab | undefined = settings.tabs.find((t) => t.type === 'table' && t.connectionId === connectionId && t.targetId === strToNumber(tableName));
        if (tab) {
            selectTab(tab);
            return;
        }
        tab = {
            hash: `table-${connectionId}-${tableName}`,
            type: 'table',
            connectionId,
            targetId: strToNumber(tableName),
            pinned: false,
            name: tableName,
        };
        selectTab(tab);
    };

    const openScratchTab = (connectionId = conns.selectedConnectionId ?? conns.connections[0]?.id) => {
        if (typeof connectionId !== 'number') {
            return;
        }

        const hash = `scratch-${uniqueId(8)}`;
        const tab: Tab = {
            hash,
            type: 'scratch',
            connectionId,
            targetId: strToNumber(hash),
            pinned: false,
            name: 'Scratch SQL',
            draftSql: '',
        };

        selectTab(tab);
    };

    const replaceScratchTabWithScript = (scratchHash: string, scriptId: number) => {
        const scratchTab = settings.tabs.find((tab) => tab.hash === scratchHash && tab.type === 'scratch');
        const script = scripts.scripts.find((entry) => entry.id === scriptId);

        if (!scratchTab || !script) {
            selectScript(scriptId);
            return;
        }

        const nextTab: Tab = {
            hash: `script-${scriptId}`,
            type: 'script',
            connectionId: script.connection_id,
            targetId: scriptId,
            pinned: scratchTab.pinned,
            name: script.name,
            draftSql: scratchTab.draftSql ?? script.sql_text,
        };

        moveScriptTabRuntimeState(scratchHash, nextTab.hash);
        setTabs(settings.tabs.map((tab) => (tab.hash === scratchHash ? nextTab : tab)));
        settings.setActiveTab(nextTab);
    };

    const selectTab = (tab: Tab) => {
        const existingTab = settings.tabs.find((t) => t.hash === tab.hash);

        if (!existingTab) {
            setTabs([...settings.tabs, normalizeStoredTab(tab)]);
        }

        settings.setActiveTab(existingTab ?? normalizeStoredTab(tab));
    };

    const closeTab = (_tab: Tab) => {
        const i = settings.tabs.findIndex((t) => t.hash == _tab.hash);
        if (i >= 0) {
            pushClosedTabs([settings.tabs[i]]);
            const nextTabs = settings.tabs.filter((t) => t.hash !== _tab.hash);
            const nextActive = nextTabs.find((t) => t.hash == (settings.tabs[i + 1] ?? settings.tabs[i - 1])?.hash) ?? nextTabs[i] ?? nextTabs[i - 1];
            setTabs(nextTabs);
            settings.setActiveTab(nextActive);
        }
    };

    const closeOtherTabs = (tab: Tab) => {
        const closingTabs = settings.tabs.filter((entry) => entry.hash !== tab.hash);
        pushClosedTabs(closingTabs);
        setTabs(settings.tabs.filter((entry) => entry.hash === tab.hash));
        settings.setActiveTab(tab);
    };

    const closeAllTabs = () => {
        pushClosedTabs(settings.tabs);
        setTabs([]);
        settings.setActiveTab(undefined);
    };

    const reopenClosedTab = () => {
        const tab = closedTabsState.shift();

        if (!tab) {
            return;
        }

        selectTab(tab);
    };

    const onScriptTabsChange = (tabs: Tab[]) => {
        setTabs([...tabs, ...settings.tabs.filter((tab) => !isScriptTab(tab))]);
    };

    const onNonScriptTabsChange = (tabs: Tab[]) => {
        setTabs([...settings.tabs.filter((tab) => isScriptTab(tab)), ...tabs]);
    };

    async function activateTab(tab: Tab | undefined) {
        if (!tab) {
            return;
        }

        try {
            tasks.dismissError();

            if (conns.selectedConnectionId !== tab.connectionId) {
                await conns.selectConnection(tab.connectionId);
            }

            if (tab.type === 'table') {
                await scripts.selectScript(undefined);
                await query.loadTables();

                const tableName = resolveTableName(tab);

                if (!tableName) {
                    sanitizeTabs();
                    return;
                }

                if (query.selectedTableName !== tableName) {
                    await query.selectTable(tableName);
                }

                return;
            }

            if (tab.type === 'script') {
                const script = scripts.scripts.find((entry) => entry.id === tab.targetId);

                if (!script) {
                    sanitizeTabs();
                    return;
                }

                if (script.connection_id !== tab.connectionId || script.name !== tab.name) {
                    replaceTab({
                        ...tab,
                        connectionId: script.connection_id,
                        name: script.name,
                        draftSql: tab.draftSql ?? script.sql_text,
                    });
                }

                if (scripts.selectedScriptId !== tab.targetId) {
                    await scripts.selectScript(tab.targetId);
                }

                const nextQueryText = tab.draftSql ?? script.sql_text ?? '';

                if (query.queryText !== nextQueryText) {
                    query.queryText = nextQueryText;
                }

                return;
            }

            await scripts.selectScript(undefined);

            if (query.queryText !== (tab.draftSql ?? '')) {
                query.queryText = tab.draftSql ?? '';
            }
        } catch (error) {
            sanitizeTabs();
            tasks.reportError(error instanceof Error ? error.message : String(error));
        }
    }

    watch(
        () => [settings.activeTabHash, settings.tabs.map((tab) => tab.hash).join('|')],
        () => {
            flushPendingDraftSync();
            ensureActiveTabExists();
            void (async () => {
                await hydrateTableTabConnections();
                sanitizeTabs();
                ensureActiveTabExists();
                await activateTab(settings.tabs.find((tab) => tab.hash === settings.activeTabHash));
            })();
        },
        { immediate: true }
    );

    watch(
        () => [hasHydratedBootstrap.value, conns.connections.map((connection) => connection.id).join('|'), scripts.scripts.map((script) => script.id).join('|')],
        () => {
            sanitizeTabs();
        },
        { immediate: true }
    );

    watch(
        () => settings.tabs.map((tab) => tab.hash).join('|'),
        () => {
            const activeHashes = new Set(settings.tabs.map((tab) => tab.hash));

            for (const hash of Object.keys(scriptTabRuntimeStateByHash)) {
                if (!activeHashes.has(hash)) {
                    delete scriptTabRuntimeStateByHash[hash];
                }
            }
        },
        { immediate: true }
    );

    watch(
        () => query.queryText,
        (nextQueryText) => {
            const currentTab = settings.tabs.find((tab) => tab.hash === settings.activeTabHash);

            if (!currentTab || (currentTab.type !== 'script' && currentTab.type !== 'scratch')) {
                return;
            }

            if (currentTab.draftSql === nextQueryText) {
                return;
            }

            scheduleDraftSync(currentTab.hash, nextQueryText);
        }
    );

    watch(
        () => scripts.scripts.map((script) => `${script.id}:${script.connection_id}:${script.name}:${script.sql_text}`).join('|'),
        () => {
            const currentTab = settings.tabs.find((tab) => tab.hash === settings.activeTabHash);

            if (!currentTab || currentTab.type !== 'script') {
                return;
            }

            const script = scripts.scripts.find((entry) => entry.id === currentTab.targetId);

            if (!script) {
                return;
            }

            if (currentTab.connectionId === script.connection_id && currentTab.name === script.name) {
                return;
            }

            replaceTab({
                ...currentTab,
                connectionId: script.connection_id,
                name: script.name,
            });
        },
        { immediate: true }
    );

    return reactive({
        selectedTabs,
        scriptTabs,
        nonScriptTabs,
        activeTab,
        closedTabs: computed(() => closedTabsState),
        getScriptTabRuntimeState,
        setScriptTabRuntimeState,
        onScriptTabsChange,
        onNonScriptTabsChange,
        selectTab: selectTab,
        selectScript: selectScript,
        selectTable: selectTable,
        openScratchTab,
        replaceScratchTabWithScript,
        updateTabConnection,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        reopenClosedTab,
    });
};
let _navState: ReturnType<typeof createNavState>;
export const useNavState = () => {
    return (_navState ??= createNavState());
};
