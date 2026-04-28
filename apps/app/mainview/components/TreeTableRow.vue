<script setup lang="ts">
import FileTreeButton from '@components/FileTreeButton.vue';
import TreeCollection from '@components/TreeCollection.vue';
import { useConnections } from '@composables/useConnections';
import { copyTableAsDdl } from '@composables/useCopyTableDdl';
import { useDbSettings } from '@composables/useDbSettings';
import { useModifyTable } from '@composables/useModifyTable';
import { useNavState } from '@composables/useNavState';
import { DetailCollectionKind, DetailCollectionTreeItem, DetailLeafTreeItem, TableTreeItem, useServerTree } from '@composables/useServerTree';
import { ContextMenuEntry } from '@directives/contextMenuTypes';
import { serializeSqlEditorTableDropPayload, SQL_EDITOR_TABLE_DRAG_MIME } from '@lib/sqlEditorDnd';
import { ServerRecord } from '@utils/appClient';
import { withMinLifetime } from '@utils/useMinLifetime';
import { formatNumber } from '@utils/utils';

const props = defineProps<{
    server: ServerRecord;
    table: TableTreeItem;
    parentId: string;
}>();

const connections = useConnections();
const state = useServerTree();
const navState = useNavState();
const modifyTable = useModifyTable();

function getColumnItems(group: DetailCollectionTreeItem): DetailLeafTreeItem[] {
    const info = connections.getTableDetailsState(group.connectionId, group.tableName).info;

    if (!info) {
        return [];
    }

    const columns = [...info.columns];

    const sortMode = state.getColumnCollectionSortMode(group.connectionId, group.tableName);

    if (sortMode === 'name-asc') {
        columns.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }));
    } else if (sortMode === 'name-desc') {
        columns.sort((left, right) => right.name.localeCompare(left.name, undefined, { sensitivity: 'base', numeric: true }));
    }

    return columns.map((column) => {
        const accent = column.isPrimaryKey
            ? 'pk'
            : info.indexes.some((index) => index.isUnique && index.columns?.includes(column.name))
              ? 'ux'
              : info.foreignKeys.some((fk) => fk.from === column.name)
                ? 'fk'
                : info.indexes.some((index) => index.columns?.includes(column.name))
                  ? 'idx'
                  : undefined;
        return {
            id: `column:${group.connectionId}:${group.tableName}:${column.name}`,
            title: column.name,
            accent: accent,
            tooltip: accent == 'pk' ? 'Primary key' : accent === 'ux' ? 'Unique index' : accent === 'fk' ? 'Foreign key' : accent === 'idx' ? 'Non-unique index' : undefined,
            subtitle: `${column.type || 'untyped'}${column.isPrimaryKey ? ' · pk' : ''}${column.notNull ? ' · not null' : ''}`,
        };
    });
}

function getKeyItems(group: DetailCollectionTreeItem): DetailLeafTreeItem[] {
    const info = connections.getTableDetailsState(group.connectionId, group.tableName).info;

    if (!info) {
        return [];
    }

    return [
        ...info.columns
            .filter((column) => column.isPrimaryKey)
            .map((column) => ({
                id: `pk:${group.connectionId}:${group.tableName}:${column.name}`,
                title: column.name,
                subtitle: 'PRIMARY KEY',
            })),
        ...info.foreignKeys.map((foreignKey) => ({
            id: `fk:${group.connectionId}:${group.tableName}:${foreignKey.id}:${foreignKey.sequence}`,
            title: foreignKey.from,
            subtitle: `FOREIGN KEY -> ${foreignKey.table}.${foreignKey.to}`,
        })),
    ];
}

function detailCollectionMenuItems(group: DetailCollectionTreeItem): ContextMenuEntry[] {
    if (group.kind !== 'columns') {
        return [];
    }

    return [
        {
            id: `columns-sort-none:${group.connectionId}:${group.tableName}`,
            label: 'No sorting',
            checked: state.getColumnCollectionSortMode(group.connectionId, group.tableName) === 'none',
            action: () => {
                state.setColumnCollectionSortMode(group.connectionId, group.tableName, 'none');
            },
        },
        {
            id: `columns-sort-asc:${group.connectionId}:${group.tableName}`,
            label: 'Sort ascending',
            checked: state.getColumnCollectionSortMode(group.connectionId, group.tableName) === 'name-asc',
            action: () => {
                state.setColumnCollectionSortMode(group.connectionId, group.tableName, 'name-asc');
            },
        },
        {
            id: `columns-sort-desc:${group.connectionId}:${group.tableName}`,
            label: 'Sort descending',
            checked: state.getColumnCollectionSortMode(group.connectionId, group.tableName) === 'name-desc',
            action: () => {
                state.setColumnCollectionSortMode(group.connectionId, group.tableName, 'name-desc');
            },
        },
    ];
}

function getColumnSortIcon(group: DetailCollectionTreeItem) {
    const sortMode = state.getColumnCollectionSortMode(group.connectionId, group.tableName);

    if (sortMode === 'name-asc') {
        return 'icon-[fluent--caret-up-12-filled]';
    }

    if (sortMode === 'name-desc') {
        return 'icon-[fluent--caret-down-12-filled]';
    }

    return 'icon-[fluent--arrow-sort-16-filled]';
}

function getColumnSortTooltip(group: DetailCollectionTreeItem) {
    const sortMode = state.getColumnCollectionSortMode(group.connectionId, group.tableName);

    if (sortMode === 'name-asc') {
        return 'Sorted ascending';
    }

    if (sortMode === 'name-desc') {
        return 'Sorted descending';
    }

    return 'Sort columns';
}

function toggleColumnCollectionSort(group: DetailCollectionTreeItem, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    state.toggleColumnCollectionSort(group.connectionId, group.tableName);
}

function getIndexItems(group: DetailCollectionTreeItem): DetailLeafTreeItem[] {
    const info = connections.getTableDetailsState(group.connectionId, group.tableName).info;

    if (!info) {
        return [];
    }

    return info.indexes.map((index) => ({
        id: `index:${group.connectionId}:${group.tableName}:${index.name}`,
        title: index.name,
        rightText: `${index.origin}${index.isUnique ? ' · unique' : ''}`,
    }));
}

async function handleTableSelect() {
    navState.selectTable(props.table.connectionId, props.table.name);
}

function handleTableDragStart(event: DragEvent) {
    if (!event.dataTransfer) {
        return;
    }

    const dragData = {
        mimeType: SQL_EDITOR_TABLE_DRAG_MIME,
        value: serializeSqlEditorTableDropPayload({
            connectionId: props.table.connectionId,
            tableName: props.table.name,
        }),
    };
    event.dataTransfer.setData(dragData.mimeType, dragData.value);
}

async function toggleTableRow() {
    const expanded = state.toggleGroupCollapsed(props.server.id, state.getTableNodeId(props.table.connectionId, props.table.name), true);
    if (expanded) {
        await connections.ensureTableDetails(props.table.connectionId, props.table.name);
    }
}

function tableMenuItems(): ContextMenuEntry[] {
    const table = props.table;
    const items: ContextMenuEntry[] = [
        {
            id: `table-select:${table.id}`,
            label: 'Open table',
            iconClass: 'icon-[mdi--cursor-default-click-outline]',
            action: async () => {
                await handleTableSelect();
            },
        },
        {
            id: `table-refresh:${table.id}`,
            label: 'Refresh metadata',
            iconClass: 'icon-[mdi--refresh]',
            action: async () => {
                const tableNodeId = state.getTableNodeId(table.connectionId, table.name);
                state.refreshingTableNodeIds[tableNodeId] = true;

                try {
                    await withMinLifetime(() => connections.ensureTableDetails(table.connectionId, table.name, true), 2000);
                } finally {
                    delete state.refreshingTableNodeIds[tableNodeId];
                }
            },
        },
    ];

    if (table.type === 'table') {
        items.push(
            {
                type: 'separator',
                id: `table-separator:${table.id}`,
            },
            {
                id: `table-copy-ddl:${table.id}`,
                label: 'Copy as DDL',
                iconClass: 'icon-[mdi--content-copy]',
                action: async () => {
                    await copyTableAsDdl(table.connectionId, table.name, props.server.driver);
                },
            },
            {
                id: `table-modify:${table.id}`,
                label: 'Modify Table...',
                iconClass: 'icon-[mdi--pencil-outline]',
                action: async () => {
                    await modifyTable.openModal({
                        connectionId: table.connectionId,
                        tableName: table.name,
                    });
                },
            },
            {
                id: `table-delete:${table.id}`,
                label: 'Delete Table...',
                iconClass: 'icon-[mdi--delete-outline]',
                danger: true,
                action: async () => {
                    await connections.dropTable(table.connectionId, table.name);
                },
            }
        );
    }

    return items;
}

const dbSettings = useDbSettings();
function getTableDetailChildren(): DetailCollectionTreeItem[] {
    const info = connections.getTableDetailsState(props.table.connectionId, props.table.name).info;

    if (!info) {
        return [];
    }

    function buildDetailCollectionItem(connectionId: number, tableName: string, kind: DetailCollectionKind, count: number) {
        return {
            id: state.getCollectionNodeId(connectionId, kind, tableName),
            title: kind,
            rightText: formatNumber(count),
            kind,
            connectionId,
            tableName,
            expandable: true,
            children: [],
        } satisfies DetailCollectionTreeItem & { children: never[] };
    }

    const children: DetailCollectionTreeItem[] = [];

    const filter = dbSettings.state.collectionFilter.tables;

    if (filter.columns) {
        children.push(buildDetailCollectionItem(props.table.connectionId, props.table.name, 'columns', info.columns.length));
    }

    if (filter.keys) {
        children.push(
            buildDetailCollectionItem(props.table.connectionId, props.table.name, 'keys', info.columns.filter((column) => column.isPrimaryKey).length + info.foreignKeys.length)
        );
    }

    if (filter.indexes) {
        children.push(buildDetailCollectionItem(props.table.connectionId, props.table.name, 'indexes', info.indexes.length));
    }

    return children;
}
</script>

<template>
    <FileTreeButton
        :item="table"
        :data-testid="`file-tree-item-${table.id}`"
        :data-node-id="state.getTableNodeId(table.connectionId, table.name)"
        :data-parent-id="parentId"
        :draggable="true"
        :collapsed="state.isGroupCollapsed(server.id, String(table.id), true)"
        :is-loading="state.isTableLoading(table.connectionId, table.name)"
        :selected="state.treeSelection.includes(String(table.id))"
        :onClick="() => void toggleTableRow()"
        :onDblClick="() => void handleTableSelect()"
        :context-menu-items="tableMenuItems"
        :onDragstart="(event) => handleTableDragStart(event)"
        :children="getTableDetailChildren"
    >
        <template #child="{ item: g, parentId, allItems }">
            <div class="flex min-w-0 flex-col pl-1">
                <!-- columns, keys or indexes -->
                <TreeCollection
                    :skip-title="allItems.length === 1"
                    :server="server"
                    :collection="g"
                    :parent-id="parentId"
                    :context-menu-items="g.kind === 'columns' ? detailCollectionMenuItems : undefined"
                    :children="() => (g.kind === 'columns' ? getColumnItems(g) : g.kind === 'keys' ? getKeyItems(g) : getIndexItems(g))"
                >
                    <template v-if="g.kind === 'columns'" #right-prefix>
                        <span
                            v-tooltip.xs.nowrap="getColumnSortTooltip(g)"
                            class="mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center border border-transparent text-2xs transition hover:border-x7 hover:bg-x6 rounded-sm"
                            :class="state.getColumnCollectionSortMode(g.connectionId, g.tableName) !== 'none' ? 'text-blue-400 ' : 'opacity-60'"
                            role="button"
                            tabindex="-1"
                            @click="toggleColumnCollectionSort(g, $event)"
                        >
                            <span :class="[getColumnSortIcon(g), 'text-lg']"></span>
                        </span>
                    </template>

                    <template #default="{ item, parentId }">
                        <FileTreeButton :item="item" :data-node-id="`${parentId}:${item.title}`" :data-parent-id="parentId" :expandable="false" :onClick="() => {}">
                            <template #text="{ text }">
                                {{ text }}
                                <template v-if="item.accent">
                                    <span
                                        v-tooltip="item.tooltip"
                                        class="ml-0.5 icon-[mingcute--key-2-fill] -rotate-y-180 text-2xs leading-none"
                                        :class="
                                            item.accent === 'pk'
                                                ? 'text-yellow-100'
                                                : item.accent === 'ux'
                                                  ? 'text-blue-200'
                                                  : item.accent === 'fk'
                                                    ? 'text-green-200'
                                                    : item.accent === 'idx'
                                                      ? 'text-purple-100'
                                                      : 'text-white'
                                        "
                                    />
                                </template>
                            </template>
                        </FileTreeButton>
                    </template>
                </TreeCollection>
            </div>
        </template>
    </FileTreeButton>
</template>
