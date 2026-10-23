import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { computed, ref } from 'vue';
import { FileTree } from '../../../shared/components/FileTree.tsx';
import { IconButton } from '../../../shared/components/IconButton.tsx';
import type { ContextMenuEntry } from '../../../directives/contextMenuTypes';
import { type FileTreeItem, useFileTree } from '../../../shared/utils/useFileTree';
import { useModifyTable } from '../../composables/useModifyTable';

type SidebarNodeKind = 'table' | 'group' | 'column' | 'key' | 'foreign-key' | 'index';

export type SidebarNode = {
    id: string;
    title: string;
    kind: SidebarNodeKind;
    groupKind?: 'columns' | 'keys' | 'foreign-keys' | 'indexes';
    rightText?: string;
    status?: 'existing' | 'new' | 'deleted';
    expandable?: boolean;
    children?: SidebarNode[];
};

type Props = {
    /** The first field of the form, focused by the menu's Edit entry and by its shortcut. */
    onEdit: (item: SidebarNode) => void;
};

export const ModifyTableSidebar = component(
    (props: Props) => {
        const modifyTable = useModifyTable();
        const draggedColumnId = ref<string | undefined>();
        const dragOverColumnId = ref<string | undefined>();

        const listToolbarClass = 'flex items-center gap-px border-b border-x4 pl-0.5 pr-2 py-1';

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
            onSelect: (item: SidebarNode) => selectItem(item),
        });

        const toolbarEntityLabel = computed(() => {
            if (modifyTable.selectedGroupKind === 'columns') return 'column';
            if (modifyTable.selectedGroupKind === 'keys') return 'key';
            if (modifyTable.selectedGroupKind === 'foreign-keys') return 'foreign key';
            if (modifyTable.selectedGroupKind === 'indexes') return 'index';
            return 'item';
        });

        const canAddEntity = computed(() => !!modifyTable.selectedGroupKind);

        function selectItem(item: SidebarNode) {
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
        }

        function canDeleteItem(item: SidebarNode) {
            if (item.kind === 'column') {
                const column = modifyTable.columns.find((entry) => `column:${entry.id}` === item.id);
                return !!column && !column.isPrimaryKey;
            }

            return item.kind === 'key' || item.kind === 'foreign-key' || item.kind === 'index';
        }

        /** The item menu: the same actions as the toolbar, on the row the user right-clicked. */
        function getItemMenuItems(item: SidebarNode): ContextMenuEntry[] {
            const isEntity = item.kind !== 'group' && item.kind !== 'table';

            return [
                {
                    id: 'new',
                    label: 'New',
                    iconClass: 'icon-[mdi--plus]',
                    children: [
                        { id: 'new-column', label: 'Column', iconClass: 'icon-[mdi--view-column-outline]', action: () => modifyTable.addColumn() },
                        { id: 'new-key', label: 'Unique Key', iconClass: 'icon-[mdi--key-variant]', action: () => modifyTable.addKey() },
                        { id: 'new-foreign-key', label: 'Foreign Key', iconClass: 'icon-[mdi--link-variant]', action: () => modifyTable.addForeignKey() },
                        { id: 'new-index', label: 'Index', iconClass: 'icon-[mdi--format-list-numbered]', action: () => modifyTable.addIndex() },
                    ],
                },
                { type: 'separator', id: 'new-separator' },
                {
                    id: 'duplicate',
                    label: 'Duplicate',
                    iconClass: 'icon-[mdi--content-copy]',
                    shortcut: '⌘D',
                    disabled: !isEntity,
                    action: () => {
                        selectItem(item);
                        modifyTable.duplicateSelectedEntity();
                    },
                },
                {
                    id: 'edit',
                    label: 'Edit',
                    iconClass: 'icon-[mdi--pencil]',
                    shortcut: '⌘↓',
                    disabled: !isEntity,
                    action: () => {
                        selectItem(item);
                        props.onEdit(item);
                    },
                },
                {
                    id: 'delete',
                    label: 'Delete',
                    iconClass: 'icon-[mdi--delete-outline]',
                    shortcut: '⌫',
                    disabled: !canDeleteItem(item),
                    action: async () => {
                        selectItem(item);
                        await modifyTable.deleteSelectedEntity();
                    },
                },
                { type: 'separator', id: 'history-separator' },
                {
                    id: 'revert',
                    label: 'Revert',
                    iconClass: 'icon-[mdi--undo-variant]',
                    shortcut: '⌘Z',
                    disabled: !modifyTable.canUndo,
                    action: () => modifyTable.undoChanges(),
                },
            ];
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

        return () => (
            <div class="flex h-full min-h-0 flex-col">
                <div class={listToolbarClass}>
                    <IconButton
                        severity="raised"
                        data-testid="modify-add"
                        disabled={!canAddEntity.value}
                        v-tooltip={`Add ${toolbarEntityLabel.value}`}
                        icon="icon-[mdi--plus]"
                        onClick={modifyTable.addSelectedEntity}
                    />
                    <IconButton
                        severity="raised"
                        data-testid="modify-delete"
                        disabled={!modifyTable.canDeleteSelection}
                        v-tooltip={{ value: `Remove ${toolbarEntityLabel.value}`, xs: true, nowrap: true }}
                        icon="icon-[mdi--minus]"
                        onClick={modifyTable.deleteSelectedEntity}
                    />
                    <IconButton
                        severity="raised"
                        data-testid="modify-duplicate"
                        disabled={!modifyTable.canDuplicateSelection}
                        v-tooltip={{ value: `Duplicate ${toolbarEntityLabel.value}`, xs: true, nowrap: true }}
                        icon="icon-[mdi--content-copy]"
                        onClick={modifyTable.duplicateSelectedEntity}
                    />
                    <IconButton
                        severity="raised"
                        data-testid="modify-move-up"
                        disabled={!modifyTable.canMoveSelectionUp}
                        v-tooltip={{ value: `Move ${toolbarEntityLabel.value} up`, xs: true, nowrap: true }}
                        icon="icon-[mdi--arrow-up]"
                        onClick={modifyTable.moveSelectedEntityUp}
                    />
                    <IconButton
                        severity="raised"
                        data-testid="modify-move-down"
                        disabled={!modifyTable.canMoveSelectionDown}
                        v-tooltip={{ value: `Move ${toolbarEntityLabel.value} down`, xs: true, nowrap: true }}
                        icon="icon-[mdi--arrow-down]"
                        onClick={modifyTable.moveSelectedEntityDown}
                    />
                </div>
                <div class="min-h-0 flex-1 px-1 py-1 -ml-3">
                    <FileTree
                        state={sidebarTreeState}
                        slots={{
                            default: ({ item, isGroup, isCollapsed, selected, rowPaddingStyle, onClick, onKeydown }) => (
                                <button
                                    type="button"
                                    data-testid="modify-nav-item"
                                    data-nav-kind={item.kind}
                                    data-nav-title={item.title}
                                    data-group-kind={item.groupKind}
                                    style={rowPaddingStyle}
                                    draggable={item.kind === 'column'}
                                    onClick={onClick}
                                    onKeydown={onKeydown}
                                    onDragstart={(e) => handleSidebarDragStart(item, e)}
                                    onDragover={(e) => handleSidebarDragOver(item, e)}
                                    onDrop={(e) => handleSidebarDrop(item, e)}
                                    onDragend={handleSidebarDragEnd}
                                    v-menu={{ items: () => getItemMenuItems(item), key: item.id }}
                                    class={[
                                        'flex h-5.5 w-full items-center gap-1 px-1 text-left text-xs transition focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-x6',
                                        [
                                            selected ? 'bg-x4' : 'hover:bg-x3',
                                            item.kind === 'column' && dragOverColumnId.value === item.id.slice('column:'.length) ? 'ring-1 ring-inset ring-x6' : '',
                                        ],
                                    ]}
                                >
                                    {isGroup ? (
                                        <span class={['icon shrink-0 text-xs opacity-55', isCollapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]']} />
                                    ) : (
                                        <span class="block w-1 shrink-0" />
                                    )}
                                    <span class={['min-w-0 truncate', item.status === 'deleted' ? 'line-through opacity-40' : '']}>{item.title}</span>
                                    {item.rightText ? <span class="ml-auto min-w-0 truncate text-right text-2xs opacity-35">{item.rightText}</span> : null}
                                </button>
                            ),
                        }}
                    />
                </div>
            </div>
        );
    },
    { name: 'ModifyTableSidebar', props: ensureAllTsxProps<Props>()(['onEdit']) }
);

export default ModifyTableSidebar;
