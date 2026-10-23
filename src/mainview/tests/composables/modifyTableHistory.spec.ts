import { describe, expect, it } from 'vitest';
import { nextTick, reactive } from 'vue';
import { createModifyTableHistory } from '../../composables/modifyTable/history';
import { createColumnDraft, createIndexColumnDraft, createTableDraft } from '../../composables/modifyTable/drafts';

function createHost() {
    const state = reactive({
        open: true,
        loading: false,
        allowTableRebuild: false,
        table: createTableDraft('people', 'sqlite'),
        columns: [
            createColumnDraft({
                cid: 0,
                name: 'id',
                type: 'integer',
                notNull: true,
                defaultValue: null,
                isPrimaryKey: true,
                primaryKeyOrdinal: 1,
                isAutoIncrement: false,
                comment: null,
                collation: null,
                onUpdate: null,
            }),
        ],
        keys: [],
        foreignKeys: [],
        indexes: [] as import('../../composables/modifyTable/types').ModifyTableIndexDraft[],
        selectedNodeId: 'column:existing:id',
        selectedKeyColumnId: undefined as string | undefined,
        selectedForeignKeyColumnId: undefined as string | undefined,
        selectedIndexColumnId: undefined as string | undefined,
    });

    return state;
}

describe('createModifyTableHistory', () => {
    it('undoes and redoes a draft change', async () => {
        const state = createHost();
        const history = createModifyTableHistory(state);
        history.reset();

        state.columns[0]!.name = 'identifier';
        await nextTick();

        expect(history.canUndo).toBe(true);
        expect(state.columns[0]!.name).toBe('identifier');

        history.undoChanges();
        await nextTick();

        expect(state.columns[0]!.name).toBe('id');
        expect(history.canRedo).toBe(true);

        history.redoChanges();
        await nextTick();

        expect(state.columns[0]!.name).toBe('identifier');
    });

    it('restores the indexes and the selection an undo removes', async () => {
        const state = createHost();
        const history = createModifyTableHistory(state);
        history.reset();

        state.indexes.push({
            id: 'new:1',
            name: 'ix_name',
            comment: '',
            isUnique: false,
            type: 'btree',
            status: 'new',
            columns: [createIndexColumnDraft('id')],
        });
        state.selectedNodeId = 'index:new:1';
        await nextTick();

        history.undoChanges();
        await nextTick();

        expect(state.indexes).toEqual([]);
        expect(state.selectedNodeId).toBe('column:existing:id');
    });

    it('ignores changes made while the dialog is loading or closed', async () => {
        const state = createHost();
        const history = createModifyTableHistory(state);
        history.reset();

        state.loading = true;
        state.columns[0]!.name = 'while-loading';
        await nextTick();
        state.loading = false;
        history.reset();

        expect(history.canUndo).toBe(false);
    });
});
