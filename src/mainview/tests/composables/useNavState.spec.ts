// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const selectScriptRun = vi.hoisted(() => vi.fn());

/**
 * Regression tests for the SQL editor cursor-jump bug.
 *
 * Root cause (confirmed via the app's own stack trace):
 * typing -> Monaco onDidChangeContent -> modelValue -> query.queryText ->
 * useNavState watch(query.queryText) -> scheduleDraftSync (150ms) ->
 * flushPendingDraftSync -> replaceTab -> setTabs.
 *
 * The watcher in useNavState watched
 *   () => [settings.activeTabHash, settings.tabs.map(t => t.hash).join('|')]
 * which returns a NEW array on every evaluation. Vue's watch compares
 * objects/arrays by REFERENCE, so ANY setTabs (even with identical hashes)
 * re-fires the watcher -> activateTab re-runs on every keystroke ->
 * scripts.selectScript() is called again (the "selectScript" busy indicator
 * at the bottom-right) and, while that backend call is pending, the user's
 * newer typing gets clobbered by the stale `tab.draftSql`, which makes
 * MonacoEditor call model.setValue() and the cursor jumps to the start.
 */

// ---------------------------------------------------------------------------
// Shared reactive stores for the mocked singletons. Plain hoisted holders are
// filled lazily by each vi.mock factory (which imports vue itself), because
// vi.mock factories are hoisted above the vue import.
// ---------------------------------------------------------------------------
const holders = vi.hoisted(() => ({
    settings: null as any,
    conns: null as any,
    scripts: null as any,
    servers: null as any,
    query: null as any,
    dbCoreState: null as any,
    selectScriptPending: false,
    resolveSelectScript: undefined as undefined | (() => void),
}));

vi.mock('../../composables/useSettings', async () => {
    const { reactive } = await import('vue');
    const store = reactive({
        tabs: [] as any[],
        activeTabHash: undefined as string | undefined,
    });
    holders.settings = store;
    return {
        useSettings: () => ({
            get tabs() {
                return store.tabs;
            },
            get activeTabHash() {
                return store.activeTabHash;
            },
            setTabs(tabs: any[]) {
                store.tabs = tabs;
            },
            setActiveTab(tab: any) {
                store.activeTabHash = tab?.hash;
            },
        }),
    };
});

vi.mock('../../composables/useConnections', async () => {
    const { reactive } = await import('vue');
    const store = reactive({
        connections: [] as any[],
        selectedConnectionId: undefined as number | undefined,
    });
    holders.conns = store;
    return {
        useConnections: () => ({
            get connections() {
                return store.connections;
            },
            get selectedConnectionId() {
                return store.selectedConnectionId;
            },
            selectConnection: vi.fn(async () => {}),
            getConnectionTablesState: () => ({ loaded: false, loading: false, tables: [] }),
            ensureConnectionTables: vi.fn(async () => {}),
        }),
    };
});

vi.mock('../../composables/useScriptsDb', () => {
    const selectScript = (scriptId: number | undefined) => {
        selectScriptRun(scriptId);

        if (holders.selectScriptPending) {
            return new Promise<void>((resolve) => {
                holders.resolveSelectScript = () => {
                    holders.selectScriptPending = false;
                    resolve();
                };
            });
        }

        return Promise.resolve();
    };

    return {
        useScriptsDb: () => ({
            scripts: [] as any[],
            selectedScriptId: undefined as number | undefined,
            selectScript,
        }),
    };
});

vi.mock('../../composables/useServers', async () => {
    const { reactive } = await import('vue');
    const store = reactive({ servers: [] as any[] });
    holders.servers = store;
    return {
        useServers: () => ({
            get servers() {
                return store.servers;
            },
        }),
    };
});

vi.mock('../../composables/useQuery', async () => {
    const { reactive } = await import('vue');
    const store = reactive({
        queryText: '',
        selectedTableName: undefined as string | undefined,
    });
    holders.query = store;
    return {
        useQuery: () => ({
            get queryText() {
                return store.queryText;
            },
            set queryText(value: string) {
                store.queryText = value;
            },
            get selectedTableName() {
                return store.selectedTableName;
            },
            loadTables: vi.fn(async () => {}),
            selectTable: vi.fn(async () => {}),
        }),
    };
});

vi.mock('../../composables/useGridFormatters', () => ({
    useGridFormatters: () => ({
        loadContext: vi.fn(),
    }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        dismissError: vi.fn(),
        reportError: vi.fn(),
    },
}));

vi.mock('../../composables/dbCoreState', () => {
    const dbCoreState = { stateCounter: 1 };
    holders.dbCoreState = dbCoreState;
    return { _dbCoreState: dbCoreState };
});

import { useNavState } from '../../composables/useNavState';

const scratchTab = () => ({
    hash: 'scratch-1',
    type: 'scratch' as const,
    connectionId: 1,
    targetId: 11,
    pinned: false,
    name: 'Scratch SQL',
    draftSql: '',
});

async function flushAll() {
    await nextTick();
    await nextTick();
    await Promise.resolve();
}

describe('useNavState draft-sync round-trip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        holders.settings.tabs = [];
        holders.settings.activeTabHash = undefined;
        holders.conns.connections = [{ id: 1, name: 'test' }];
        holders.conns.selectedConnectionId = 1;
        holders.query.queryText = '';
        selectScriptRun.mockClear();
        holders.selectScriptPending = false;
        holders.resolveSelectScript = undefined;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not re-run selectScript when the draft sync replaces the active tab', async () => {
        useNavState();

        // Single scratch tab, already active (the "single tab" scenario).
        holders.settings.tabs = [scratchTab()];
        holders.settings.activeTabHash = 'scratch-1';

        // Let the initial activation settle.
        await flushAll();
        await vi.runAllTimersAsync();
        await flushAll();

        selectScriptRun.mockClear();

        // Simulate the user typing: modelValue -> query.queryText.
        holders.query.queryText = 'hello';
        await flushAll();

        // Let the 150ms draft sync flush -> replaceTab -> setTabs.
        await vi.advanceTimersByTimeAsync(160);
        await flushAll();
        await vi.runAllTimersAsync();
        await flushAll();

        // Typing must not re-trigger activation/selectScript. Only the initial
        // activation (cleared above) is allowed.
        expect(selectScriptRun).not.toHaveBeenCalled();
    });

    it('does not clobber newer typing while a selectScript call is in flight', async () => {
        useNavState();

        holders.settings.tabs = [scratchTab()];
        holders.settings.activeTabHash = 'scratch-1';

        await flushAll();
        await vi.runAllTimersAsync();
        await flushAll();

        selectScriptRun.mockClear();

        // Type 'A', then let the draft sync flush. With the bug, the flush's
        // setTabs re-triggers activateTab, which calls selectScript (pending).
        holders.selectScriptPending = true;
        holders.query.queryText = 'A';
        await flushAll();
        await vi.advanceTimersByTimeAsync(160);
        await flushAll();

        // The user keeps typing while selectScript is still pending.
        holders.query.queryText = 'AB';
        await flushAll();

        // selectScript resolves; activateTab resumes and must NOT overwrite
        // the newer 'AB' with the stale draftSql 'A'. Assert immediately, before
        // any later draft-sync round-trip could re-apply the text.
        holders.resolveSelectScript?.();
        await flushAll();

        expect(holders.query.queryText).toBe('AB');
        expect(selectScriptRun).not.toHaveBeenCalled();
    });
});
