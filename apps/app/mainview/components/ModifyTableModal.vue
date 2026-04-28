<script setup lang="ts">
import SqlEditor from '@components/SqlEditor.vue';
import { useModifyTable } from '@composables/useModifyTable';
import { getDbCollationOptions } from '@lib/collations';
import { getDbColumnDataTypeOptions } from '@lib/dbColumnDataType';
import { getDbDefaultExpressionOptions } from '@lib/dbDefaultExpression';
import { FileTreeItem, useFileTree } from '@shared/utils/useFileTree';
import Alert from '@ui/Alert.vue';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import Checkbox from '@ui/Checkbox.vue';
import FileTree from '@ui/FileTree.vue';
import IconButton from '@ui/IconButton.vue';
import Input from '@ui/Input.vue';
import ListBox from '@ui/ListBox.vue';
import Select from '@ui/Select.vue';
import Splitter from '@ui/Splitter.vue';
import SplitterVertical from '@ui/SplitterVertical.vue';
import { computed, ref, watch } from 'vue';

const modifyTable = useModifyTable();

const selectedColumn = computed(() => modifyTable.selectedColumn);
const selectedTable = computed(() => modifyTable.selectedTable);
const selectedKey = computed(() => modifyTable.selectedKey);
const selectedKeyColumn = computed(() => modifyTable.selectedKeyColumn);
const selectedForeignKey = computed(() => modifyTable.selectedForeignKey);
const selectedForeignKeyColumn = computed(() => modifyTable.selectedForeignKeyColumn);
const selectedIndex = computed(() => modifyTable.selectedIndex);
const selectedIndexColumn = computed(() => modifyTable.selectedIndexColumn);
const draggedColumnId = ref<string | undefined>();
const dragOverColumnId = ref<string | undefined>();

const referentialActionOptions = ['no_action', 'restrict', 'cascade', 'set_null', 'set_default'];
const indexOrderOptions = ['NONE', 'ASC', 'DESC'];

const rowLabelClass = 'text-xs whitespace-nowrap';
const listToolbarClass = 'flex items-center gap-px border border-x4 bg-x2 px-1.5 py-1';
const listItemClass = 'flex w-full items-center gap-2 border-b border-x4 px-2 py-1 text-left text-xs transition';
const dirtyLabelTintClass = 'text-amber-300';
const formGridClass = 'grid grid-cols-[auto_1fr] gap-y-1 gap-x-2 items-center';
const subGridClass = 'grid grid-cols-[120px_1fr] gap-y-1 gap-x-2 border border-x4';

type SidebarNodeKind = 'table' | 'group' | 'column' | 'key' | 'foreign-key' | 'index';

type SidebarNode = {
    id: string;
    title: string;
    kind: SidebarNodeKind;
    groupKind?: 'columns' | 'keys' | 'foreign-keys' | 'indexes';
    rightText?: string;
    status?: 'existing' | 'new' | 'deleted';
    expandable?: boolean;
    children?: SidebarNode[];
};

const toolbarEntityLabel = computed(() => {
    if (modifyTable.selectedGroupKind === 'columns') return 'column';
    if (modifyTable.selectedGroupKind === 'keys') return 'key';
    if (modifyTable.selectedGroupKind === 'foreign-keys') return 'foreign key';
    if (modifyTable.selectedGroupKind === 'indexes') return 'index';
    return 'item';
});

const canAddEntity = computed(() => !!modifyTable.selectedGroupKind);
const addTooltip = computed(() => `Add ${toolbarEntityLabel.value}`);
const deleteTooltip = computed(() => `Remove ${toolbarEntityLabel.value}`);
const duplicateTooltip = computed(() => `Duplicate ${toolbarEntityLabel.value}`);
const moveUpTooltip = computed(() => `Move ${toolbarEntityLabel.value} up`);
const moveDownTooltip = computed(() => `Move ${toolbarEntityLabel.value} down`);

const rootContextText = computed(() => {
    const databaseName = modifyTable.connection?.database_name || modifyTable.connection?.name || '';
    const hostName = modifyTable.connection?.host || modifyTable.server?.name || '';

    if (databaseName && hostName) {
        return `${databaseName} [@${hostName}]`;
    }

    return databaseName || hostName || '';
});

const sidebarTreeState = useFileTree<SidebarNode>({
    localStorageKey: 'modifyTableSidebar',
    tree: computed<FileTreeItem<SidebarNode>>(() => ({
        title: '',
        children: [
            {
                id: 'table',
                title: modifyTable.table.name.trim() || modifyTable.tableName || 'table',
                kind: 'table',
                rightText: rootContextText.value || undefined,
                expandable: true,
                children: [
                    ...modifyTable.navigationSections.map((section) => ({
                        id: section.id,
                        title: section.title,
                        kind: 'group' as const,
                        groupKind: section.kind,
                        rightText: section.items.length ? String(section.items.length) : undefined,
                        expandable: true,
                        children: section.items.map((item) => ({
                            id: item.id,
                            title: item.title,
                            kind: item.kind as SidebarNodeKind,
                            rightText: item.rightText,
                            status: item.status,
                        })),
                    })),
                    { id: 'group:checks', title: 'checks', kind: 'group' as const, expandable: true, children: [] },
                    { id: 'group:triggers', title: 'triggers', kind: 'group' as const, expandable: true, children: [] },
                    { id: 'group:virtual-columns', title: 'virtual columns', kind: 'group' as const, expandable: true, children: [] },
                    { id: 'group:virtual-foreign-keys', title: 'virtual foreign keys', kind: 'group' as const, expandable: true, children: [] },
                ],
            },
        ],
    })),
    selection: computed(() => modifyTable.selectedNodeId || 'table'),
    selectGroups: true,
    scrollable: true,
    emptyText: '',
    onSelect: (item: SidebarNode) => {
        if (item.kind === 'table') {
            modifyTable.selectTable();
            return;
        }

        if (item.kind === 'group') {
            if (item.groupKind) {
                modifyTable.selectGroup(item.groupKind);
            }
            return;
        }

        modifyTable.selectNode(item.id);
    },
});

const selectionTitle = computed(() => {
    if (selectedTable.value) return selectedTable.value.name || modifyTable.tableName || 'Table';
    if (selectedColumn.value) return selectedColumn.value.name || 'Column';
    if (selectedKey.value) return selectedKey.value.name || 'Key';
    if (selectedForeignKey.value) return selectedForeignKey.value.name || 'Foreign Key';
    if (selectedIndex.value) return selectedIndex.value.name || 'Index';
    return '';
});

const previewSummary = computed(() => {
    const statementCount = modifyTable.previewStatements.length;
    if (statementCount === 0) return 'No change yet';
    return `${statementCount} statement${statementCount < 2 ? '' : 's'}`;
});

watch(
    () => selectedForeignKey.value?.targetTable,
    async (targetTable) => {
        if (!targetTable) {
            return;
        }

        await modifyTable.ensureTargetTableDetails(targetTable);

        if (!selectedForeignKeyColumn.value) {
            return;
        }

        const options = modifyTable.getTargetTableColumnNames(targetTable);

        if (options.length > 0 && !options.includes(selectedForeignKeyColumn.value.targetName)) {
            selectedForeignKeyColumn.value.targetName = options[0]!;
        }
    },
    { immediate: true }
);

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

function handleSidebarDragStart(item: SidebarNode, event: DragEvent) {
    if (item.kind !== 'column') {
        return;
    }

    const columnId = item.id.slice('column:'.length);
    draggedColumnId.value = columnId;
    event.dataTransfer?.setData('text/plain', columnId);
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
    }
}

function handleSidebarDragOver(item: SidebarNode, event: DragEvent) {
    if (item.kind !== 'column' || !draggedColumnId.value) {
        return;
    }

    event.preventDefault();
    dragOverColumnId.value = item.id.slice('column:'.length);
}

function handleSidebarDrop(item: SidebarNode, event: DragEvent) {
    if (item.kind !== 'column' || !draggedColumnId.value) {
        return;
    }

    event.preventDefault();
    modifyTable.moveColumnTo(draggedColumnId.value, item.id.slice('column:'.length));
    dragOverColumnId.value = undefined;
    draggedColumnId.value = undefined;
}

function handleSidebarDragEnd() {
    dragOverColumnId.value = undefined;
    draggedColumnId.value = undefined;
}

function onModalOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
        modifyTable.closeModal();
    }
}

function getSectionSuffix(kind: SidebarNode['groupKind']) {
    if (kind === 'columns') return 'COL';
    if (kind === 'keys') return 'KEY';
    if (kind === 'foreign-keys') return 'FK';
    if (kind === 'indexes') return 'IDX';
    return '';
}
</script>

<template>
    <CenteredModal :open="modifyTable.open" localStorageKey="modify-table-modal" :title="''" compact-header contentClass=" h-[80vh] border-x4" @update:open="onModalOpenChange">
        <template #title>
            <div class="font-semibold">Modify</div>
        </template>

        <div class="flex min-h-180 flex-col bg-x2 flex-1">
            <Splitter
                class="min-h-0 flex-1 bg-x2"
                base-side="left"
                default-width="280px"
                min-width="240px"
                max-width="44%"
                local-storage-key="modifyTableSidebarWidth"
                leftClass=""
                rightClass=""
                draggerClass="bg-x3 hover:bg-x5"
            >
                <template #left>
                    <div class="flex h-full min-h-0 flex-col">
                        <div class="flex items-center gap-px border-b border-x4 pl-0.5 pr-2 py-1">
                            <IconButton severity="raised" :disabled="!canAddEntity" :v-tooltip="addTooltip" @click="modifyTable.addSelectedEntity" icon="icon-[mdi--plus]" />
                            <IconButton
                                severity="raised"
                                :disabled="!modifyTable.canDeleteSelection"
                                :v-tooltip.xs.nowrap="deleteTooltip"
                                @click="modifyTable.deleteSelectedEntity"
                                icon="icon-[mdi--minus]"
                            />
                            <IconButton
                                severity="raised"
                                :disabled="!modifyTable.canDuplicateSelection"
                                :v-tooltip.xs.nowrap="duplicateTooltip"
                                @click="modifyTable.duplicateSelectedEntity"
                                icon="icon-[mdi--content-copy]"
                            />
                            <IconButton
                                severity="raised"
                                :disabled="!modifyTable.canMoveSelectionUp"
                                :v-tooltip.xs.nowrap="moveUpTooltip"
                                @click="modifyTable.moveSelectedEntityUp"
                                icon="icon-[mdi--arrow-up]"
                            />
                            <IconButton
                                severity="raised"
                                :disabled="!modifyTable.canMoveSelectionDown"
                                :v-tooltip.xs.nowrap="moveDownTooltip"
                                @click="modifyTable.moveSelectedEntityDown"
                                icon="icon-[mdi--arrow-down]"
                            />
                        </div>

                        <div class="min-h-0 flex-1 px-1 py-1 -ml-3">
                            <FileTree :state="sidebarTreeState">
                                <template #default="{ item, isGroup, isCollapsed, selected, rowPaddingStyle, onClick, onKeydown }">
                                    <button
                                        type="button"
                                        class="flex h-5.5 w-full items-center gap-1 px-1 text-left text-xs transition focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-x6"
                                        :class="[
                                            selected ? 'bg-x4' : 'hover:bg-x3',
                                            item.kind === 'column' && dragOverColumnId === item.id.slice('column:'.length) ? 'ring-1 ring-inset ring-x6' : '',
                                        ]"
                                        :style="rowPaddingStyle"
                                        :draggable="item.kind === 'column'"
                                        @click="onClick"
                                        @keydown="onKeydown"
                                        @dragstart="handleSidebarDragStart(item, $event)"
                                        @dragover="handleSidebarDragOver(item, $event)"
                                        @drop="handleSidebarDrop(item, $event)"
                                        @dragend="handleSidebarDragEnd"
                                    >
                                        <span
                                            v-if="isGroup"
                                            class="icon shrink-0 text-xs opacity-55"
                                            :class="isCollapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]'"
                                        />
                                        <span v-else class="block w-1 shrink-0" />
                                        <!-- <span class="icon shrink-0 text-sm opacity-70" :class="getSidebarIcon(item, isGroup)" /> -->
                                        <span class="min-w-0 truncate" :class="item.status === 'deleted' ? 'line-through opacity-40' : ''">{{ item.title }}</span>
                                        <span v-if="item.kind === 'group' && getSectionSuffix(item.groupKind)" class="shrink-0 text-2xs uppercase tracking-[0.18em] opacity-20">
                                            {{ getSectionSuffix(item.groupKind) }}
                                        </span>
                                        <span v-if="item.rightText" class="ml-auto min-w-0 truncate text-right text-2xs opacity-35">{{ item.rightText }}</span>
                                    </button>
                                </template>
                            </FileTree>
                        </div>
                    </div>
                </template>

                <template #right>
                    <SplitterVertical
                        class="h-full"
                        base-side="bottom"
                        default-height="128px"
                        min-height="96px"
                        max-height="55%"
                        local-storage-key="modifyTablePreviewHeight"
                        bottomClass=""
                        draggerClass="bg-x3 hover:bg-x5"
                    >
                        <template #top>
                            <div class="flex h-full min-h-0 flex-col">
                                <div class="flex items-center gap-2 border-b border-x4 px-3 py-1.5 text-xs">
                                    <span class="truncate font-medium text-lg">{{ selectionTitle }}</span>
                                </div>

                                <div class="px-3 pt-2">
                                    <Alert v-if="modifyTable.errorMessage" severity="danger" small>{{ modifyTable.errorMessage }}</Alert>
                                    <Alert v-else-if="modifyTable.rebuildWarnings.length > 0 && !modifyTable.allowTableRebuild" severity="warning" small>
                                        <div class="flex items-center justify-between gap-3">
                                            <span class="min-w-0 flex-1">{{ modifyTable.rebuildWarnings[0] }}</span>
                                            <Button type="button" severity="secondary" smaller @click="modifyTable.enableTableRebuild">Enable Table Rebuilding</Button>
                                        </div>
                                    </Alert>
                                    <Alert v-else-if="modifyTable.validationErrors.length > 0" severity="warning" small>
                                        <div class="flex items-center justify-between gap-3">
                                            <span class="min-w-0 flex-1">{{ modifyTable.validationErrors[0] }}</span>
                                            <Button
                                                v-if="modifyTable.autoIncrementPrimaryKeyWarning === modifyTable.validationErrors[0] && modifyTable.canMakeSelectedColumnPrimaryKey"
                                                type="button"
                                                severity="secondary"
                                                smaller
                                                @click="modifyTable.makeSelectedColumnPrimaryKey"
                                            >
                                                Make This Column Primary Key
                                            </Button>
                                        </div>
                                    </Alert>
                                </div>

                                <div class="min-h-0 flex-1 overflow-y-auto px-3">
                                    <div v-if="modifyTable.loading" class="flex h-full min-h-60 items-center justify-center text-sm opacity-70">Loading table metadata...</div>

                                    <div v-else-if="selectedTable" class="space-y-3">
                                        <div>
                                            <div :class="formGridClass">
                                                <div :class="getLabelClass(isTableFieldDirty('name'))">Name</div>
                                                <Input v-model="selectedTable.name" small />

                                                <div :class="getLabelClass(isTableFieldDirty('comment'))">Comment</div>
                                                <Input v-model="selectedTable.comment" small />

                                                <div :class="getLabelClass(isTableFieldDirty('engine'))">Engine</div>
                                                <Input v-model="selectedTable.engine" small />

                                                <div :class="getLabelClass(isTableFieldDirty('collation'))">Collation</div>
                                                <ListBox
                                                    small
                                                    free-edit
                                                    :selection="selectedTable.collation"
                                                    :onSelect="(value, query) => (selectedTable!.collation = value?.value ?? query)"
                                                    :items="getDbCollationOptions(modifyTable.collationOptionValues, selectedTable?.collation)"
                                                />

                                                <div :class="getLabelClass(isTableFieldDirty('options'))">Options</div>
                                                <Input v-model="selectedTable.options" small />
                                            </div>
                                        </div>

                                        <div class="border border-x4">
                                            <div :class="[formGridClass, 'border-b border-x4']">
                                                <div class="border-r border-x4 px-3 py-1.5 text-xs opacity-70">Grants</div>
                                                <div class="flex items-center gap-px px-1.5 py-1">
                                                    <IconButton severity="raised" disabled v-tooltip.xs.nowrap="'Add grant'" icon="icon-[mdi--plus]" />
                                                    <IconButton severity="raised" disabled v-tooltip.xs.nowrap="'Remove grant'" icon="icon-[mdi--minus]" />
                                                    <IconButton severity="raised" disabled v-tooltip.xs.nowrap="'Move grant up'" icon="icon-[mdi--arrow-up]" />
                                                    <IconButton severity="raised" disabled v-tooltip.xs.nowrap="'Move grant down'" icon="icon-[mdi--arrow-down]" />
                                                </div>
                                            </div>
                                            <div class="flex min-h-10 max-h-46 items-center justify-center bg-x2 text-sm opacity-60">Nothing to show</div>
                                        </div>
                                    </div>

                                    <div v-else-if="selectedColumn">
                                        <div :class="formGridClass">
                                            <div :class="getLabelClass(isColumnFieldDirty('name'))">Name</div>
                                            <Input v-model="selectedColumn.name" small :disabled="selectedColumn.status === 'deleted'" />

                                            <div :class="getLabelClass(isColumnFieldDirty('comment'))">Comment</div>
                                            <Input v-model="selectedColumn.comment" small :disabled="selectedColumn.status === 'deleted' || !modifyTable.canEditComment" />

                                            <div :class="getLabelClass(isColumnFieldDirty('type'))">Data Type</div>
                                            <ListBox
                                                small
                                                free-edit
                                                :selection="selectedColumn.type"
                                                :onSelect="(value, query) => (selectedColumn!.type = value?.value ?? query)"
                                                :items="getDbColumnDataTypeOptions(modifyTable.driver, selectedColumn?.type)"
                                                :disabled="selectedColumn.status === 'deleted'"
                                            />

                                            <div :class="getLabelClass(isColumnFieldDirty('notNull') || isColumnFieldDirty('isAutoIncrement'))"></div>
                                            <div class="flex flex-wrap items-center gap-4">
                                                <Checkbox label="Not Null" v-model="selectedColumn.notNull" :disabled="selectedColumn.status === 'deleted'" small />
                                                <Checkbox
                                                    label="Auto Increment"
                                                    v-model="selectedColumn.isAutoIncrement"
                                                    :disabled="selectedColumn.status === 'deleted' || !modifyTable.canEditAutoIncrement"
                                                    small
                                                />
                                                <Input v-model="selectedColumn.primaryKeyOrdinal" disabled class="w-12" smaller />
                                            </div>

                                            <div :class="getLabelClass(isColumnFieldDirty('columnKind'))">Column Kind</div>
                                            <Select
                                                v-model="selectedColumn.columnKind"
                                                :options="[
                                                    { label: 'NORMAL', value: 'NORMAL' },
                                                    { label: 'GENERATED_VIRTUAL', value: 'GENERATED_VIRTUAL' },
                                                    { label: 'GENERATED_STORED', value: 'GENERATED_STORED' },
                                                ]"
                                                :disabled="selectedColumn.status === 'deleted'"
                                                small
                                            />

                                            <div :class="getLabelClass(isColumnFieldDirty('defaultValue'))">Default Expression</div>
                                            <ListBox
                                                small
                                                free-edit
                                                :selection="selectedColumn.defaultValue"
                                                :onSelect="(value, query) => (selectedColumn!.defaultValue = value?.value ?? query)"
                                                :items="getDbDefaultExpressionOptions(modifyTable.driver, selectedColumn?.defaultValue)"
                                                :disabled="selectedColumn.status === 'deleted'"
                                            />

                                            <div :class="getLabelClass(isColumnFieldDirty('hidden'))"></div>
                                            <Checkbox label="Hidden" v-model="selectedColumn.hidden" :disabled="selectedColumn.status === 'deleted'" small />

                                            <div :class="getLabelClass(isColumnFieldDirty('onUpdate'))">On Update</div>
                                            <Input v-model="selectedColumn.onUpdate" :disabled="selectedColumn.status === 'deleted' || !modifyTable.canEditOnUpdate" small />

                                            <div :class="getLabelClass(isColumnFieldDirty('collation'))">Collation</div>

                                            <ListBox
                                                small
                                                free-edit
                                                :selection="selectedColumn.collation"
                                                :onSelect="(value, query) => (selectedColumn!.collation = value?.value ?? query)"
                                                :items="getDbCollationOptions(modifyTable.collationOptionValues, selectedColumn?.collation)"
                                                :disabled="selectedColumn.status === 'deleted'"
                                            />
                                        </div>
                                    </div>

                                    <div v-else-if="selectedKey" class="space-y-3">
                                        <div>
                                            <div :class="formGridClass">
                                                <div :class="getLabelClass(isKeyFieldDirty('name'))">Name</div>
                                                <Input v-model="selectedKey.name" :disabled="selectedKey.status === 'deleted'" small />

                                                <div :class="getLabelClass(isKeyFieldDirty('isPrimary'))"></div>
                                                <Checkbox v-model="selectedKey.isPrimary" :disabled="selectedKey.status === 'deleted'" label="Primary" small />
                                            </div>
                                        </div>

                                        <div>
                                            <div :class="listToolbarClass">
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedKey.status === 'deleted'"
                                                    v-tooltip.xs.nowrap="'Add key column'"
                                                    @click="modifyTable.addSelectedKeyColumn"
                                                    icon="icon-[mdi--plus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedKey.status === 'deleted' || !selectedKeyColumn"
                                                    v-tooltip.xs.nowrap="'Remove key column'"
                                                    @click="modifyTable.removeSelectedKeyColumn"
                                                    icon="icon-[mdi--minus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedKey.columns.length < 2 || selectedKey.status === 'deleted' || !selectedKeyColumn"
                                                    v-tooltip.xs.nowrap="'Move key column up'"
                                                    @click="modifyTable.moveSelectedKeyColumnUp"
                                                    icon="icon-[mdi--arrow-up]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedKey.columns.length < 2 || selectedKey.status === 'deleted' || !selectedKeyColumn"
                                                    v-tooltip.xs.nowrap="'Move key column down'"
                                                    @click="modifyTable.moveSelectedKeyColumnDown"
                                                    icon="icon-[mdi--arrow-down]"
                                                />
                                            </div>
                                            <div :class="subGridClass">
                                                <template v-if="selectedKey.columns.length">
                                                    <div class="border-r border-x4">
                                                        <div class="max-h-56 overflow-y-auto">
                                                            <button
                                                                v-for="column in selectedKey.columns"
                                                                :key="column.id"
                                                                type="button"
                                                                :class="[listItemClass, selectedKeyColumn?.id === column.id ? 'bg-x3' : 'hover:bg-x4']"
                                                                @click="modifyTable.selectKeyColumn(column.id)"
                                                            >
                                                                <span class="min-w-0 flex-1 truncate">{{ column.columnName || 'column' }}</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div v-if="selectedKeyColumn" :class="[formGridClass, 'px-1 py-2']">
                                                        <span :class="rowLabelClass">Column Name</span>
                                                        <Select
                                                            v-model="selectedKeyColumn.columnName"
                                                            :options="modifyTable.activeColumnNames"
                                                            :disabled="selectedKey.status === 'deleted'"
                                                            small
                                                        />
                                                    </div>
                                                </template>
                                                <div v-else class="col-span-full text-xs opacity-60 p-3">No key column selected yet!</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else-if="selectedForeignKey" class="space-y-3">
                                        <div>
                                            <div :class="formGridClass">
                                                <div :class="getLabelClass(isForeignKeyFieldDirty('name'))">Name</div>
                                                <Input v-model="selectedForeignKey.name" :disabled="selectedForeignKey.status === 'deleted'" small />

                                                <div :class="getLabelClass(isForeignKeyFieldDirty('targetTable'))">Target Table</div>
                                                <Select
                                                    v-model="selectedForeignKey.targetTable"
                                                    :options="modifyTable.targetTableNames"
                                                    :disabled="selectedForeignKey.status === 'deleted'"
                                                    small
                                                />

                                                <div :class="getLabelClass(isForeignKeyFieldDirty('onDelete'))">On Delete</div>
                                                <Select
                                                    v-model="selectedForeignKey.onDelete"
                                                    :options="referentialActionOptions"
                                                    :disabled="selectedForeignKey.status === 'deleted'"
                                                    small
                                                />

                                                <div :class="getLabelClass(isForeignKeyFieldDirty('onUpdate'))">On Update</div>
                                                <Select
                                                    v-model="selectedForeignKey.onUpdate"
                                                    :options="referentialActionOptions"
                                                    :disabled="selectedForeignKey.status === 'deleted'"
                                                    small
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <div :class="listToolbarClass">
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedForeignKey.status === 'deleted'"
                                                    v-tooltip.xs.nowrap="'Add foreign key column'"
                                                    @click="modifyTable.addSelectedForeignKeyColumn"
                                                    icon="icon-[mdi--plus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedForeignKey.status === 'deleted' || !selectedForeignKeyColumn"
                                                    v-tooltip.xs.nowrap="'Remove foreign key column'"
                                                    @click="modifyTable.removeSelectedForeignKeyColumn"
                                                    icon="icon-[mdi--minus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedForeignKey.columns.length < 2 || selectedForeignKey.status === 'deleted' || !selectedForeignKeyColumn"
                                                    v-tooltip.xs.nowrap="'Move foreign key column up'"
                                                    @click="modifyTable.moveSelectedForeignKeyColumnUp"
                                                    icon="icon-[mdi--arrow-up]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedForeignKey.columns.length < 2 || selectedForeignKey.status === 'deleted' || !selectedForeignKeyColumn"
                                                    v-tooltip.xs.nowrap="'Move foreign key column down'"
                                                    @click="modifyTable.moveSelectedForeignKeyColumnDown"
                                                    icon="icon-[mdi--arrow-down]"
                                                />
                                            </div>
                                            <div :class="[subGridClass, 'grid-cols-[150px_1fr]']">
                                                <div class="border-r border-x4">
                                                    <div class="max-h-56 overflow-y-auto">
                                                        <button
                                                            v-for="column in selectedForeignKey.columns"
                                                            :key="column.id"
                                                            type="button"
                                                            :class="[listItemClass, selectedForeignKeyColumn?.id === column.id ? 'bg-x3' : 'hover:bg-x4']"
                                                            @click="modifyTable.selectForeignKeyColumn(column.id)"
                                                        >
                                                            <span class="min-w-0 flex-1 truncate">{{ column.columnName || 'column' }} -> {{ column.targetName || 'target' }}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div :class="[formGridClass, 'px-1 py-2']">
                                                    <span :class="rowLabelClass">Column Name</span>
                                                    <Select
                                                        v-if="selectedForeignKeyColumn"
                                                        v-model="selectedForeignKeyColumn.columnName"
                                                        :options="modifyTable.activeColumnNames"
                                                        :disabled="selectedForeignKey.status === 'deleted'"
                                                        small
                                                    />
                                                    <span :class="rowLabelClass">Target Name</span>
                                                    <Select
                                                        v-if="selectedForeignKeyColumn"
                                                        v-model="selectedForeignKeyColumn.targetName"
                                                        :options="modifyTable.getTargetTableColumnNames(selectedForeignKey?.targetTable)"
                                                        :disabled="selectedForeignKey.status === 'deleted'"
                                                        small
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else-if="selectedIndex" class="space-y-3">
                                        <div :class="formGridClass">
                                            <div :class="getLabelClass(isIndexFieldDirty('name'))">Name</div>
                                            <Input v-model="selectedIndex.name" :disabled="selectedIndex.status === 'deleted'" small />

                                            <div :class="getLabelClass(isIndexFieldDirty('comment'))">Comment</div>
                                            <Input v-model="selectedIndex.comment" :disabled="selectedIndex.status === 'deleted'" small />

                                            <div :class="getLabelClass(isIndexFieldDirty('isUnique'))"></div>
                                            <Checkbox v-model="selectedIndex.isUnique" :disabled="selectedIndex.status === 'deleted'" label="Unique" small />

                                            <div :class="getLabelClass(isIndexFieldDirty('type'))">Type</div>
                                            <Input v-model="selectedIndex.type" :disabled="selectedIndex.status === 'deleted'" small />
                                        </div>

                                        <div>
                                            <div :class="listToolbarClass">
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedIndex.status === 'deleted'"
                                                    v-tooltip.xs.nowrap="'Add index column'"
                                                    @click="modifyTable.addSelectedIndexColumn"
                                                    icon="icon-[mdi--plus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedIndex.status === 'deleted' || !selectedIndexColumn"
                                                    v-tooltip.xs.nowrap="'Remove index column'"
                                                    @click="modifyTable.removeSelectedIndexColumn"
                                                    icon="icon-[mdi--minus]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedIndex.columns.length < 2 || selectedIndex.status === 'deleted' || !selectedIndexColumn"
                                                    v-tooltip.xs.nowrap="'Move index column up'"
                                                    @click="modifyTable.moveSelectedIndexColumnUp"
                                                    icon="icon-[mdi--arrow-up]"
                                                />
                                                <IconButton
                                                    severity="raised"
                                                    :disabled="selectedIndex.columns.length < 2 || selectedIndex.status === 'deleted' || !selectedIndexColumn"
                                                    v-tooltip.xs.nowrap="'Move index column down'"
                                                    @click="modifyTable.moveSelectedIndexColumnDown"
                                                    icon="icon-[mdi--arrow-down]"
                                                />
                                            </div>
                                            <div :class="subGridClass">
                                                <div class="border-r border-x4">
                                                    <div class="max-h-56 overflow-y-auto">
                                                        <button
                                                            v-for="column in selectedIndex.columns"
                                                            :key="column.id"
                                                            type="button"
                                                            :class="[listItemClass, selectedIndexColumn?.id === column.id ? 'bg-x3' : 'hover:bg-x4']"
                                                            @click="modifyTable.selectIndexColumn(column.id)"
                                                        >
                                                            <span class="min-w-0 flex-1 truncate">{{ column.columnName || 'column' }}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div :class="[formGridClass, 'px-1 py-2']">
                                                    <span :class="rowLabelClass">Column Name</span>
                                                    <Select
                                                        v-if="selectedIndexColumn"
                                                        v-model="selectedIndexColumn.columnName"
                                                        :options="modifyTable.activeColumnNames"
                                                        :disabled="selectedIndex.status === 'deleted'"
                                                        small
                                                    />

                                                    <span :class="rowLabelClass">Order</span>
                                                    <Select
                                                        v-if="selectedIndexColumn"
                                                        v-model="selectedIndexColumn.order"
                                                        :options="indexOrderOptions"
                                                        :disabled="selectedIndex.status === 'deleted'"
                                                        small
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div v-else class="flex h-full min-h-60 items-center justify-center border border-dashed border-x4 bg-transparent text-sm opacity-65">
                                        Select a table item in the sidebar to edit its properties.
                                    </div>
                                </div>
                            </div>
                        </template>

                        <template #bottom>
                            <div class="flex h-full min-h-0 flex-col">
                                <div class="flex items-center gap-1 border-b border-x4 bg-x2 pl-3 py-1 text-sm">
                                    <div class="text-sm opacity-80 flex-1">Preview</div>
                                    <div class="flex items-center gap-2 pr-2">
                                        <div class="text-xs opacity-50">{{ previewSummary }}</div>
                                    </div>
                                    <template v-if="modifyTable.canUndo || modifyTable.canRedo">
                                        <Button type="button" severity="secondary" smaller :disabled="!modifyTable.canUndo" @click="modifyTable.undoChanges">Undo</Button>
                                        <Button type="button" severity="secondary" smaller :disabled="!modifyTable.canRedo" @click="modifyTable.redoChanges">Redo</Button>
                                    </template>
                                </div>
                                <SqlEditor
                                    :model-value="modifyTable.previewDisplaySql"
                                    :extra-markers="modifyTable.previewMarkers"
                                    :sql-dialect="modifyTable.driver"
                                    title="Preview"
                                    no-head
                                    readonly
                                    class="min-h-0 flex-1"
                                />
                            </div>
                        </template>
                    </SplitterVertical>
                </template>
            </Splitter>

            <div class="flex items-center justify-end gap-2 border-t border-x4 bg-x3 px-4 py-2">
                <Checkbox
                    v-if="modifyTable.allowTableRebuild"
                    class="mr-auto"
                    v-model="modifyTable.allowTableRebuild"
                    label="Allow table rebuilding for unsupported MS Access changes"
                    small
                />
                <Button type="button" severity="secondary" smaller @click="modifyTable.closeModal">Cancel</Button>
                <Button type="button" severity="primary" smaller :disabled="!modifyTable.canApply" @click="modifyTable.applyChanges">
                    {{ modifyTable.applying ? 'Applying...' : 'OK' }}
                </Button>
            </div>
        </div>
    </CenteredModal>
</template>
