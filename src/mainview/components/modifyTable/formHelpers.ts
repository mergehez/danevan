import { computed } from 'vue';
import { useModifyTable } from '../../composables/useModifyTable';

/** Shared form state for the Modify Table sections: the selection, the dirty markers and classes. */
export function useModifyTableForm() {
    const modifyTable = useModifyTable();

    const selectedColumn = computed(() => modifyTable.selectedColumn);
    const selectedTable = computed(() => modifyTable.selectedTable);
    const selectedKey = computed(() => modifyTable.selectedKey);
    const selectedKeyColumn = computed(() => modifyTable.selectedKeyColumn);
    const selectedForeignKey = computed(() => modifyTable.selectedForeignKey);
    const selectedForeignKeyColumn = computed(() => modifyTable.selectedForeignKeyColumn);
    const selectedIndex = computed(() => modifyTable.selectedIndex);
    const selectedIndexColumn = computed(() => modifyTable.selectedIndexColumn);

    const referentialActionOptions = ['no_action', 'restrict', 'cascade', 'set_null', 'set_default'];
    const indexOrderOptions = ['NONE', 'ASC', 'DESC'];

    const rowLabelClass = 'text-xs whitespace-nowrap';
    const listToolbarClass = 'flex items-center gap-px border border-x4 bg-x2 px-1.5 py-1';
    const listItemClass = 'flex w-full items-center gap-2 border-b border-x4 px-2 py-1 text-left text-xs transition';
    const dirtyLabelTintClass = 'text-amber-300';
    const formGridClass = 'grid grid-cols-[auto_1fr] gap-y-1 gap-x-2 items-center';
    const subGridClass = 'grid grid-cols-[120px_1fr] gap-y-1 gap-x-2 border border-x4';

    function normalizeOptionalText(value: string | null | undefined) {
        const normalizedValue = value?.trim();
        return normalizedValue ? normalizedValue : null;
    }

    function getLabelClass(isDirty: boolean) {
        return [rowLabelClass, isDirty ? dirtyLabelTintClass : ''];
    }

    function getOriginalSelectedColumn() {
        if (!selectedColumn.value?.originalName) {
            return undefined;
        }

        return modifyTable.currentTableInfo?.columns.find((column) => column.name === selectedColumn.value?.originalName);
    }

    function getOriginalSelectedKey() {
        const key = selectedKey.value;

        if (!key || !modifyTable.currentTableInfo) {
            return undefined;
        }

        if (key.originalName === 'PRIMARY' || key.isPrimary) {
            const columns = [...modifyTable.currentTableInfo.columns]
                .filter((column) => column.isPrimaryKey)
                .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
                .map((column) => column.name);

            return {
                name: 'PRIMARY',
                isPrimary: true,
                columns,
            };
        }

        const index = modifyTable.currentTableInfo.indexes.find((entry) => entry.isUnique && entry.name === (key.originalName ?? key.name));

        if (!index) {
            return undefined;
        }

        return {
            name: index.name,
            isPrimary: false,
            columns: index.columns,
        };
    }

    function getOriginalSelectedForeignKey() {
        if (!selectedForeignKey.value || !modifyTable.currentTableInfo) {
            return undefined;
        }

        const groupName = selectedForeignKey.value.originalName ?? selectedForeignKey.value.name;
        const rows = modifyTable.currentTableInfo.foreignKeys
            .filter((foreignKey) => (foreignKey.name ?? String(foreignKey.id)) === groupName)
            .sort((left, right) => left.sequence - right.sequence);

        if (rows.length === 0) {
            return undefined;
        }

        return {
            name: rows[0]?.name ?? groupName,
            targetTable: rows[0]?.table ?? '',
            onDelete: rows[0]?.onDelete?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            onUpdate: rows[0]?.onUpdate?.toLowerCase().replaceAll(' ', '_') ?? 'no_action',
            columns: rows.map((row) => ({ columnName: row.from, targetName: row.to })),
        };
    }

    function getOriginalSelectedIndex() {
        const indexDraft = selectedIndex.value;

        if (!indexDraft || !modifyTable.currentTableInfo) {
            return undefined;
        }

        if ((indexDraft.originalName ?? indexDraft.name) === 'PRIMARY') {
            const columns = [...modifyTable.currentTableInfo.columns]
                .filter((column) => column.isPrimaryKey)
                .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
                .map((column) => column.name);

            return {
                name: 'PRIMARY',
                comment: '',
                isUnique: true,
                type: '',
                columns,
                orders: [] as string[],
            };
        }

        const index = modifyTable.currentTableInfo.indexes.find((entry) => entry.name === (indexDraft.originalName ?? indexDraft.name));

        if (!index) {
            return undefined;
        }

        return {
            name: index.name,
            comment: index.comment ?? '',
            isUnique: index.isUnique,
            type: index.type ?? 'btree',
            columns: index.columns,
            orders: index.orders ?? [],
        };
    }

    function isTableFieldDirty(field: 'name' | 'comment' | 'engine' | 'collation' | 'options') {
        if (!selectedTable.value || !modifyTable.currentTableInfo) {
            return false;
        }

        if (field === 'name') {
            return (selectedTable.value.name.trim() || modifyTable.tableName || '') !== (modifyTable.currentTableInfo.name || modifyTable.tableName || '');
        }

        return normalizeOptionalText(selectedTable.value[field]) !== normalizeOptionalText(modifyTable.currentTableInfo[field]);
    }

    function isColumnFieldDirty(field: 'name' | 'comment' | 'type' | 'notNull' | 'isAutoIncrement' | 'columnKind' | 'defaultValue' | 'hidden' | 'onUpdate' | 'collation') {
        if (!selectedColumn.value) {
            return false;
        }

        const originalColumn = getOriginalSelectedColumn();

        if (!originalColumn) {
            if (field === 'name') return selectedColumn.value.name.trim().length > 0;
            if (field === 'type') return selectedColumn.value.type.trim().length > 0;
            if (field === 'notNull' || field === 'isAutoIncrement' || field === 'hidden') return !!selectedColumn.value[field];
            if (field === 'columnKind') return selectedColumn.value.columnKind !== 'NORMAL';
            return normalizeOptionalText(String(selectedColumn.value[field] ?? '')) !== null;
        }

        if (field === 'name' || field === 'type') {
            return selectedColumn.value[field].trim() !== originalColumn[field].trim();
        }

        if (field === 'hidden') {
            return selectedColumn.value.hidden !== false;
        }

        if (field === 'notNull' || field === 'isAutoIncrement') {
            return selectedColumn.value[field] !== (originalColumn[field] ?? false);
        }

        if (field === 'columnKind') {
            return normalizeOptionalText(selectedColumn.value.columnKind) !== 'NORMAL';
        }

        return normalizeOptionalText(String(selectedColumn.value[field] ?? '')) !== normalizeOptionalText(String(originalColumn[field] ?? ''));
    }

    function isKeyFieldDirty(field: 'name' | 'isPrimary') {
        if (!selectedKey.value) {
            return false;
        }

        const originalKey = getOriginalSelectedKey();

        if (!originalKey) {
            return field === 'name' ? selectedKey.value.name.trim().length > 0 : selectedKey.value.isPrimary;
        }

        return field === 'name' ? selectedKey.value.name.trim() !== originalKey.name : selectedKey.value.isPrimary !== originalKey.isPrimary;
    }

    function isForeignKeyFieldDirty(field: 'name' | 'targetTable' | 'onDelete' | 'onUpdate') {
        if (!selectedForeignKey.value) {
            return false;
        }

        const originalForeignKey = getOriginalSelectedForeignKey();

        if (!originalForeignKey) {
            return normalizeOptionalText(String(selectedForeignKey.value[field] ?? '')) !== null;
        }

        return normalizeOptionalText(String(selectedForeignKey.value[field] ?? '')) !== normalizeOptionalText(String(originalForeignKey[field] ?? ''));
    }

    function isIndexColumnFieldDirty(column: { id: string; columnName: string; order: string }, field: 'columnName' | 'order') {
        const position = selectedIndex.value?.columns.findIndex((entry) => entry.id === column.id) ?? -1;
        const originalIndex = getOriginalSelectedIndex();

        if (!originalIndex) {
            return field === 'columnName' ? column.columnName.trim().length > 0 : column.order !== 'NONE';
        }

        const originalColumnName = originalIndex.columns[position];

        if (originalColumnName === undefined) {
            return true;
        }

        return field === 'columnName' ? column.columnName.trim() !== originalColumnName.trim() : column.order !== (originalIndex.orders[position] ?? 'NONE');
    }

    function isKeyColumnFieldDirty(column: { id: string; columnName: string }) {
        const position = selectedKey.value?.columns.findIndex((entry) => entry.id === column.id) ?? -1;
        const originalKey = getOriginalSelectedKey();

        if (!originalKey) {
            return column.columnName.trim().length > 0;
        }

        const originalColumnName = originalKey.columns[position];

        if (originalColumnName === undefined) {
            return true;
        }

        return column.columnName.trim() !== originalColumnName.trim();
    }

    function isIndexFieldDirty(field: 'name' | 'comment' | 'isUnique' | 'type') {
        if (!selectedIndex.value) {
            return false;
        }

        const originalIndex = getOriginalSelectedIndex();

        if (!originalIndex) {
            if (field === 'isUnique') {
                return selectedIndex.value.isUnique;
            }

            return normalizeOptionalText(String(selectedIndex.value[field] ?? '')) !== null;
        }

        if (field === 'isUnique') {
            return selectedIndex.value.isUnique !== originalIndex.isUnique;
        }

        return normalizeOptionalText(String(selectedIndex.value[field] ?? '')) !== normalizeOptionalText(String(originalIndex[field] ?? ''));
    }

    return {
        modifyTable,
        selectedColumn,
        selectedTable,
        selectedKey,
        selectedKeyColumn,
        selectedForeignKey,
        selectedForeignKeyColumn,
        selectedIndex,
        selectedIndexColumn,
        referentialActionOptions,
        indexOrderOptions,
        rowLabelClass,
        listToolbarClass,
        listItemClass,
        formGridClass,
        subGridClass,
        getLabelClass,
        isTableFieldDirty,
        isColumnFieldDirty,
        isKeyFieldDirty,
        isKeyColumnFieldDirty,
        isForeignKeyFieldDirty,
        isIndexFieldDirty,
        isIndexColumnFieldDirty,
    };
}
