import { shallowReactive, watch } from 'vue';
import { cloneModifyTableHistorySnapshot } from './drafts';
import type { ModifyTableColumnDraft, ModifyTableForeignKeyDraft, ModifyTableHistorySnapshot, ModifyTableIndexDraft, ModifyTableKeyDraft, ModifyTableTableDraft } from './types';

/** The draft the history snapshots and restores; the store passes its reactive object. */
export type ModifyTableHistoryHost = {
    open: boolean;
    loading: boolean;
    allowTableRebuild: boolean;
    table: ModifyTableTableDraft;
    columns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
    selectedNodeId?: string;
    selectedKeyColumnId?: string;
    selectedForeignKeyColumnId?: string;
    selectedIndexColumnId?: string;
};

/**
 * Undo/redo over the whole table definition. A snapshot is serialised once per change and doubles as
 * the change signal, so the watcher compares strings instead of deep-cloning twice.
 */
export function createModifyTableHistory(state: ModifyTableHistoryHost) {
    // Shallow: the length drives the buttons, while the snapshots stay plain objects that
    // `structuredClone` can copy (a deep reactive array would hand back proxies).
    const undoStack = shallowReactive<ModifyTableHistorySnapshot[]>([]);
    const redoStack = shallowReactive<ModifyTableHistorySnapshot[]>([]);
    let currentHistorySnapshot: ModifyTableHistorySnapshot | undefined;
    let currentHistorySerialized: string | undefined;
    let suppressHistory = false;

    function buildSnapshot(): ModifyTableHistorySnapshot {
        return {
            allowTableRebuild: state.allowTableRebuild,
            table: state.table,
            columns: state.columns,
            keys: state.keys,
            foreignKeys: state.foreignKeys,
            indexes: state.indexes,
            selectedNodeId: state.selectedNodeId ?? null,
            selectedKeyColumnId: state.selectedKeyColumnId ?? null,
            selectedForeignKeyColumnId: state.selectedForeignKeyColumnId ?? null,
            selectedIndexColumnId: state.selectedIndexColumnId ?? null,
        };
    }

    function serializeSnapshot() {
        return JSON.stringify(buildSnapshot());
    }

    function captureSnapshot(): ModifyTableHistorySnapshot {
        return JSON.parse(serializeSnapshot()) as ModifyTableHistorySnapshot;
    }

    function reset() {
        undoStack.length = 0;
        redoStack.length = 0;
        currentHistorySnapshot = state.open && !state.loading ? captureSnapshot() : undefined;
        currentHistorySerialized = currentHistorySnapshot ? serializeSnapshot() : undefined;
    }

    function applySnapshot(snapshot: ModifyTableHistorySnapshot) {
        suppressHistory = true;
        // One clone for the reactive state, one detached copy for the history.
        const nextState = cloneModifyTableHistorySnapshot(snapshot);
        state.allowTableRebuild = snapshot.allowTableRebuild;
        state.table = nextState.table;
        state.columns = nextState.columns;
        state.keys = nextState.keys;
        state.foreignKeys = nextState.foreignKeys;
        state.indexes = nextState.indexes;
        state.selectedNodeId = snapshot.selectedNodeId ?? undefined;
        state.selectedKeyColumnId = snapshot.selectedKeyColumnId ?? undefined;
        state.selectedForeignKeyColumnId = snapshot.selectedForeignKeyColumnId ?? undefined;
        state.selectedIndexColumnId = snapshot.selectedIndexColumnId ?? undefined;
        currentHistorySnapshot = cloneModifyTableHistorySnapshot(snapshot);
        // Serialise what the watcher will see, so undoing does not register as a change.
        currentHistorySerialized = serializeSnapshot();
        suppressHistory = false;
    }

    watch(
        () => ({
            open: state.open,
            loading: state.loading,
            allowTableRebuild: state.allowTableRebuild,
            table: state.table,
            columns: state.columns,
            keys: state.keys,
            foreignKeys: state.foreignKeys,
            indexes: state.indexes,
            selectedNodeId: state.selectedNodeId ?? null,
            selectedKeyColumnId: state.selectedKeyColumnId ?? null,
            selectedForeignKeyColumnId: state.selectedForeignKeyColumnId ?? null,
            selectedIndexColumnId: state.selectedIndexColumnId ?? null,
        }),
        () => {
            if (suppressHistory || !state.open || state.loading) {
                return;
            }

            const nextSerialized = serializeSnapshot();

            if (!currentHistorySnapshot) {
                currentHistorySnapshot = JSON.parse(nextSerialized) as ModifyTableHistorySnapshot;
                currentHistorySerialized = nextSerialized;
                undoStack.length = 0;
                redoStack.length = 0;
                return;
            }

            if (nextSerialized === currentHistorySerialized) {
                return;
            }

            // The stored snapshot is already detached and never mutated in place.
            undoStack.push(currentHistorySnapshot);
            currentHistorySnapshot = JSON.parse(nextSerialized) as ModifyTableHistorySnapshot;
            currentHistorySerialized = nextSerialized;
            redoStack.length = 0;
        },
        { deep: true }
    );

    return {
        get canUndo() {
            return undoStack.length > 0;
        },
        get canRedo() {
            return redoStack.length > 0;
        },
        undoChanges() {
            const previousSnapshot = undoStack.pop();

            if (!previousSnapshot || !currentHistorySnapshot) {
                return;
            }

            redoStack.push(currentHistorySnapshot);
            applySnapshot(previousSnapshot);
        },
        redoChanges() {
            const nextSnapshot = redoStack.pop();

            if (!nextSnapshot || !currentHistorySnapshot) {
                return;
            }

            undoStack.push(currentHistorySnapshot);
            applySnapshot(nextSnapshot);
        },
        reset,
    };
}
