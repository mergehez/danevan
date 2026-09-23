import { reactive, readonly } from 'vue';

export type SqlHistorySource = 'script' | 'query' | 'modify-table' | 'drop-table' | 'other';

export type SqlHistoryEntry = {
    id: string;
    timestamp: number;
    source: SqlHistorySource;
    sql: string;
    status: 'success' | 'error';
    errorMessage?: string;
    durationMs?: number;
    connectionId?: number;
    connectionLabel?: string;
    dialect?: string;
};

const MAX_HISTORY = 100;
const state = reactive<{ entries: SqlHistoryEntry[] }>({ entries: [] });

export function createSqlHistoryEntry(entry: Omit<SqlHistoryEntry, 'id' | 'timestamp'>): SqlHistoryEntry {
    return {
        ...entry,
        id: `sql-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
    };
}

export function _useSqlHistory() {
    function record(entry: Omit<SqlHistoryEntry, 'id' | 'timestamp'>): SqlHistoryEntry {
        const full = createSqlHistoryEntry(entry);
        state.entries.unshift(full);

        if (state.entries.length > MAX_HISTORY) {
            state.entries.splice(MAX_HISTORY);
        }

        return full;
    }

    function clear() {
        state.entries.splice(0);
    }

    return {
        entries: readonly(state.entries),
        record,
        clear,
        get count() {
            return state.entries.length;
        },
    };
}

let historySingleton: ReturnType<typeof _useSqlHistory> | undefined;

export function useSqlHistory() {
    historySingleton ??= _useSqlHistory();
    return historySingleton;
}
