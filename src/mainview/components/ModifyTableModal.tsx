import { component, ensureAllTsxProps, vModel } from '#shared/utils/tsxHelpers.tsx';
import { computed, ref, watch } from 'vue';
import { Alert } from '../../shared/components/Alert.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { Checkbox } from '../../shared/components/Checkbox.tsx';
import { FileTree } from '../../shared/components/FileTree.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { Input } from '../../shared/components/Input.tsx';
import { ListBox } from '../../shared/components/ListBox.tsx';
import { Select } from '../../shared/components/Select.tsx';
import { splitter } from '../../shared/components/Splitter.tsx';
import { splitterVertical } from '../../shared/components/SplitterVertical.tsx';
import { type FileTreeItem, useFileTree } from '../../shared/utils/useFileTree';
import { useModifyTable } from '../composables/useModifyTable';
import { getDbCollationOptions } from '../lib/collations';
import { getDbColumnDataTypeOptions } from '../lib/dbColumnDataType';
import { getDbDefaultExpressionOptions } from '../lib/dbDefaultExpression';
import { SqlEditor } from './SqlEditor.tsx';

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

type Props = {};

export const ModifyTableModal = component(
    (_: Props) => {
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

        return () => (
            <CenteredModal
                open={modifyTable.open}
                localStorageKey="modify-table-modal"
                title={''}
                compactHeader={true}
                contentClass=" h-[80vh] border-x4"
                onOpenChange={onModalOpenChange}
                slots={{
                    default: () => (
                        <div class="flex min-h-180 flex-col bg-x2 flex-1">
                            {splitter({
                                baseSide: 'left',
                                defaultWidth: '280px',
                                minWidth: '240px',
                                maxWidth: '44%',
                                localStorageKey: 'modifyTableSidebarWidth',
                                leftClass: '',
                                rightClass: '',
                                draggerClass: 'bg-x3 hover:bg-x5',
                                class: 'min-h-0 flex-1 bg-x2',
                                left: sectionSidebar(),
                                right: splitterVertical({
                                    baseSide: 'bottom',
                                    defaultHeight: '128px',
                                    minHeight: '96px',
                                    maxHeight: '55%',
                                    localStorageKey: 'modifyTablePreviewHeight',
                                    bottomClass: '',
                                    draggerClass: 'bg-x3 hover:bg-x5',
                                    class: 'h-full',
                                    top: sectionForm(),
                                    bottom: sectionPreview(),
                                }),
                            })}
                            {sectionFooterWithButtons()}
                        </div>
                    ),
                    title: () => <div class="font-semibold">Modify</div>,
                }}
            />
        );

        function sectionFooterWithButtons() {
            return (
                <div class="flex items-center justify-end gap-2 border-t border-x4 bg-x3 px-4 py-2">
                    {modifyTable.allowTableRebuild ? (
                        <Checkbox {...vModel(modifyTable, 'allowTableRebuild')} label="Allow table rebuilding for unsupported MS Access changes" small={true} class="mr-auto" />
                    ) : null}
                    <Button type="button" severity="secondary" smaller={true} onClick={modifyTable.closeModal}>
                        Cancel
                    </Button>
                    <Button type="button" severity="primary" smaller={true} data-testid="modify-apply" disabled={!modifyTable.canApply} onClick={modifyTable.applyChanges}>
                        {modifyTable.applying ? 'Applying...' : 'OK'}
                    </Button>
                </div>
            );
        }

        function sectionPreview(): unknown {
            return (
                <div class="flex h-full min-h-0 flex-col">
                    <div class="flex items-center gap-1 border-b border-x4 bg-x2 pl-3 py-1 text-sm">
                        <div class="text-sm opacity-80 flex-1">Preview</div>
                        <div class="flex items-center gap-2 pr-2">
                            <div class="text-xs opacity-50">{previewSummary.value}</div>
                        </div>
                        {modifyTable.canUndo || modifyTable.canRedo ? (
                            <>
                                <Button type="button" severity="secondary" smaller={true} disabled={!modifyTable.canUndo} onClick={modifyTable.undoChanges}>
                                    Undo
                                </Button>
                                <Button type="button" severity="secondary" smaller={true} disabled={!modifyTable.canRedo} onClick={modifyTable.redoChanges}>
                                    Redo
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <SqlEditor
                        modelValue={modifyTable.previewDisplaySql}
                        extraMarkers={modifyTable.previewMarkers}
                        sqlDialect={modifyTable.driver}
                        title="Preview"
                        noHead={true}
                        readonly={true}
                        class="min-h-0 flex-1"
                    />
                </div>
            );
        }

        function sectionForm(): unknown {
            return (
                <div class="flex h-full min-h-0 flex-col">
                    <div class="flex items-center gap-2 border-b border-x4 px-3 py-1.5 text-xs">
                        <span class="truncate font-medium text-lg">{selectionTitle.value}</span>
                    </div>
                    <div class="px-3 pt-2">
                        {modifyTable.errorMessage ? (
                            <Alert severity="danger" small={true}>
                                {modifyTable.errorMessage}
                            </Alert>
                        ) : modifyTable.rebuildWarnings.length > 0 && !modifyTable.allowTableRebuild ? (
                            <Alert severity="warning" small={true}>
                                <div class="flex items-center justify-between gap-3">
                                    <span class="min-w-0 flex-1">{modifyTable.rebuildWarnings[0]}</span>
                                    <Button type="button" severity="secondary" smaller={true} onClick={modifyTable.enableTableRebuild}>
                                        Enable Table Rebuilding
                                    </Button>
                                </div>
                            </Alert>
                        ) : modifyTable.validationErrors.length > 0 ? (
                            <Alert severity="warning" small={true}>
                                <div class="flex items-center justify-between gap-3">
                                    <span class="min-w-0 flex-1">{modifyTable.validationErrors[0]}</span>
                                    {modifyTable.autoIncrementPrimaryKeyWarning === modifyTable.validationErrors[0] && modifyTable.canMakeSelectedColumnPrimaryKey ? (
                                        <Button type="button" severity="secondary" smaller={true} onClick={modifyTable.makeSelectedColumnPrimaryKey}>
                                            Make This Column Primary Key
                                        </Button>
                                    ) : null}
                                </div>
                            </Alert>
                        ) : null}
                    </div>
                    <div class="min-h-0 flex-1 overflow-y-auto px-3">
                        {modifyTable.loading ? (
                            <div class="flex h-full min-h-60 items-center justify-center text-sm opacity-70">Loading table metadata...</div>
                        ) : selectedTable.value ? (
                            formForTable()
                        ) : selectedColumn.value ? (
                            formForColumn()
                        ) : selectedKey.value ? (
                            formForKey()
                        ) : selectedForeignKey.value ? (
                            formForForeignKey()
                        ) : selectedIndex.value ? (
                            formForIndex()
                        ) : (
                            <div class="flex h-full min-h-60 items-center justify-center border border-dashed border-x4 bg-transparent text-sm opacity-65">
                                Select a table item in the sidebar to edit its properties.
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        function sectionSidebar(): unknown {
            return (
                <div class="flex h-full min-h-0 flex-col">
                    <div class="flex items-center gap-px border-b border-x4 pl-0.5 pr-2 py-1">
                        <IconButton
                            severity="raised"
                            data-testid="modify-add"
                            disabled={!canAddEntity.value}
                            v-tooltip={addTooltip.value}
                            icon="icon-[mdi--plus]"
                            onClick={modifyTable.addSelectedEntity}
                        />
                        <IconButton
                            severity="raised"
                            data-testid="modify-delete"
                            disabled={!modifyTable.canDeleteSelection}
                            v-tooltip={deleteTooltip.value}
                            icon="icon-[mdi--minus]"
                            onClick={modifyTable.deleteSelectedEntity}
                        />
                        <IconButton
                            severity="raised"
                            data-testid="modify-duplicate"
                            disabled={!modifyTable.canDuplicateSelection}
                            v-tooltip={duplicateTooltip.value}
                            icon="icon-[mdi--content-copy]"
                            onClick={modifyTable.duplicateSelectedEntity}
                        />
                        <IconButton
                            severity="raised"
                            data-testid="modify-move-up"
                            disabled={!modifyTable.canMoveSelectionUp}
                            v-tooltip={moveUpTooltip.value}
                            icon="icon-[mdi--arrow-up]"
                            onClick={modifyTable.moveSelectedEntityUp}
                        />
                        <IconButton
                            severity="raised"
                            data-testid="modify-move-down"
                            disabled={!modifyTable.canMoveSelectionDown}
                            v-tooltip={moveDownTooltip.value}
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
                                        {/* <span class="icon shrink-0 text-sm opacity-70" :class="getSidebarIcon(item, isGroup)" /> */}
                                        <span class={['min-w-0 truncate', item.status === 'deleted' ? 'line-through opacity-40' : '']}>{item.title}</span>
                                        {item.rightText ? <span class="ml-auto min-w-0 truncate text-right text-2xs opacity-35">{item.rightText}</span> : null}
                                    </button>
                                ),
                            }}
                        />
                    </div>
                </div>
            );
        }

        function formForIndex() {
            const selIndex = selectedIndex.value!;
            return (
                <div class="space-y-3">
                    <div class={formGridClass}>
                        <div class={getLabelClass(isIndexFieldDirty('name'))}>Name</div>
                        <Input {...vModel(selIndex, 'name')} disabled={selIndex.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('comment'))}>Comment</div>
                        <Input {...vModel(selIndex, 'comment')} disabled={selIndex.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('isUnique'))} />
                        <Checkbox {...vModel(selIndex, 'isUnique')} disabled={selIndex.status === 'deleted'} label="Unique" small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('type'))}>Type</div>
                        <Input {...vModel(selIndex, 'type')} disabled={selIndex.status === 'deleted'} small={true} />
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selIndex.status === 'deleted'}
                                v-tooltip={'Add index column'}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedIndexColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={'Remove index column'}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedIndexColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.columns.length < 2 || selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={'Move index column up'}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedIndexColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.columns.length < 2 || selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={'Move index column down'}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedIndexColumnDown}
                            />
                        </div>
                        <div class={subGridClass}>
                            <div class="border-r border-x4">
                                <div class="max-h-56 overflow-y-auto">
                                    {selIndex.columns.map((column) => (
                                        <button
                                            type="button"
                                            onClick={() => modifyTable.selectIndexColumn(column.id)}
                                            class={[listItemClass, selectedIndexColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                            key={column.id}
                                        >
                                            <span class="min-w-0 flex-1 truncate">{column.columnName || 'column'}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div class={[formGridClass, 'px-1 py-2']}>
                                <span class={rowLabelClass}>Column Name</span>
                                {selectedIndexColumn.value ? (
                                    <Select
                                        {...vModel(selectedIndexColumn.value, 'columnName')}
                                        options={modifyTable.activeColumnNames}
                                        disabled={selIndex.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                                <span class={rowLabelClass}>Order</span>
                                {selectedIndexColumn.value ? (
                                    <Select {...vModel(selectedIndexColumn.value, 'order')} options={indexOrderOptions} disabled={selIndex.status === 'deleted'} small={true} />
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        function formForForeignKey() {
            const selFk = selectedForeignKey.value!;
            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isForeignKeyFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selFk, 'name')} disabled={selFk.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isForeignKeyFieldDirty('targetTable'))}>Target Table</div>
                            <Select {...vModel(selFk, 'targetTable')} options={modifyTable.targetTableNames} disabled={selFk.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isForeignKeyFieldDirty('onDelete'))}>On Delete</div>
                            <Select {...vModel(selFk, 'onDelete')} options={referentialActionOptions} disabled={selFk.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isForeignKeyFieldDirty('onUpdate'))}>On Update</div>
                            <Select {...vModel(selFk, 'onUpdate')} options={referentialActionOptions} disabled={selFk.status === 'deleted'} small={true} />
                        </div>
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selFk.status === 'deleted'}
                                v-tooltip={'Add foreign key column'}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedForeignKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={'Remove foreign key column'}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedForeignKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.columns.length < 2 || selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={'Move foreign key column up'}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedForeignKeyColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.columns.length < 2 || selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={'Move foreign key column down'}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedForeignKeyColumnDown}
                            />
                        </div>
                        <div class={[subGridClass, 'grid-cols-[150px_1fr]']}>
                            <div class="border-r border-x4">
                                <div class="max-h-56 overflow-y-auto">
                                    {selFk.columns.map((column) => (
                                        <button
                                            type="button"
                                            onClick={() => modifyTable.selectForeignKeyColumn(column.id)}
                                            class={[listItemClass, selectedForeignKeyColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                            key={column.id}
                                        >
                                            <span class="min-w-0 flex-1 truncate">
                                                {column.columnName || 'column'}
                                                {' -> '}
                                                {column.targetName || 'target'}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div class={[formGridClass, 'px-1 py-2']}>
                                <span class={rowLabelClass}>Column Name</span>
                                {selectedForeignKeyColumn.value ? (
                                    <Select
                                        {...vModel(selectedForeignKeyColumn.value, 'columnName')}
                                        options={modifyTable.activeColumnNames}
                                        disabled={selFk.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                                <span class={rowLabelClass}>Target Name</span>
                                {selectedForeignKeyColumn.value ? (
                                    <Select
                                        {...vModel(selectedForeignKeyColumn.value, 'targetName')}
                                        options={modifyTable.getTargetTableColumnNames(selFk?.targetTable)}
                                        disabled={selFk.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        function formForKey() {
            const selKey = selectedKey.value!;
            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isKeyFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selKey, 'name')} disabled={selKey.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isKeyFieldDirty('isPrimary'))} />
                            <Checkbox {...vModel(selKey, 'isPrimary')} disabled={selKey.status === 'deleted'} label="Primary" small={true} />
                        </div>
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selKey.status === 'deleted'}
                                v-tooltip={'Add key column'}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={'Remove key column'}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.columns.length < 2 || selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={'Move key column up'}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedKeyColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.columns.length < 2 || selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={'Move key column down'}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedKeyColumnDown}
                            />
                        </div>
                        <div class={subGridClass}>
                            {selKey.columns.length ? (
                                <>
                                    <div class="border-r border-x4">
                                        <div class="max-h-56 overflow-y-auto">
                                            {selKey.columns.map((column) => (
                                                <button
                                                    type="button"
                                                    onClick={() => modifyTable.selectKeyColumn(column.id)}
                                                    class={[listItemClass, selectedKeyColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                                    key={column.id}
                                                >
                                                    <span class="min-w-0 flex-1 truncate">{column.columnName || 'column'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {selectedKeyColumn.value ? (
                                        <div class={[formGridClass, 'px-1 py-2']}>
                                            <span class={rowLabelClass}>Column Name</span>
                                            <Select
                                                {...vModel(selectedKeyColumn.value, 'columnName')}
                                                options={modifyTable.activeColumnNames}
                                                disabled={selKey.status === 'deleted'}
                                                small={true}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div class="col-span-full text-xs opacity-60 p-3">No key column selected yet!</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        function formForColumn() {
            const selCol = selectedColumn.value!;
            return (
                <div>
                    <div class={formGridClass}>
                        <div class={getLabelClass(isColumnFieldDirty('name'))}>Name</div>
                        <Input {...vModel(selCol, 'name')} data-testid="modify-column-name" small={true} disabled={selCol.status === 'deleted'} />
                        <div class={getLabelClass(isColumnFieldDirty('comment'))}>Comment</div>
                        <Input {...vModel(selCol, 'comment')} small={true} disabled={selCol.status === 'deleted' || !modifyTable.canEditComment} />
                        <div class={getLabelClass(isColumnFieldDirty('type'))}>Data Type</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            data-testid="modify-column-type"
                            selection={selCol.type}
                            onSelect={(value, query) => (selCol.type = value?.value ?? query)}
                            items={getDbColumnDataTypeOptions(modifyTable.driver, selCol?.type)}
                            disabled={selCol.status === 'deleted'}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('notNull') || isColumnFieldDirty('isAutoIncrement'))} />
                        <div class="flex flex-wrap items-center gap-4">
                            <Checkbox label="Not Null" {...vModel(selCol, 'notNull')} disabled={selCol.status === 'deleted'} small={true} />
                            <Checkbox
                                label="Auto Increment"
                                {...vModel(selCol, 'isAutoIncrement')}
                                disabled={selCol.status === 'deleted' || !modifyTable.canEditAutoIncrement}
                                small={true}
                            />
                            <Input {...vModel(selCol, 'primaryKeyOrdinal')} disabled={true} smaller={true} class="w-12" />
                        </div>
                        <div class={getLabelClass(isColumnFieldDirty('columnKind'))}>Column Kind</div>
                        <Select
                            {...vModel(selCol, 'columnKind')}
                            options={[
                                { label: 'NORMAL', value: 'NORMAL' },
                                { label: 'GENERATED_VIRTUAL', value: 'GENERATED_VIRTUAL' },
                                { label: 'GENERATED_STORED', value: 'GENERATED_STORED' },
                            ]}
                            disabled={selCol.status === 'deleted'}
                            small={true}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('defaultValue'))}>Default Expression</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            selection={selCol.defaultValue}
                            onSelect={(value, query) => (selCol!.defaultValue = value?.value ?? query)}
                            items={getDbDefaultExpressionOptions(modifyTable.driver, selCol?.defaultValue)}
                            disabled={selCol.status === 'deleted'}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('hidden'))} />
                        <Checkbox label="Hidden" {...vModel(selCol, 'hidden')} disabled={selCol.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isColumnFieldDirty('onUpdate'))}>On Update</div>
                        <Input {...vModel(selCol, 'onUpdate')} disabled={selCol.status === 'deleted' || !modifyTable.canEditOnUpdate} small={true} />
                        <div class={getLabelClass(isColumnFieldDirty('collation'))}>Collation</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            selection={selCol.collation}
                            onSelect={(value, query) => (selCol!.collation = value?.value ?? query)}
                            items={getDbCollationOptions(modifyTable.collationOptionValues, selCol?.collation)}
                            disabled={selCol.status === 'deleted'}
                        />
                    </div>
                </div>
            );
        }

        function formForTable() {
            const selTable = selectedTable.value!;
            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isTableFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selTable, 'name')} small={true} />
                            <div class={getLabelClass(isTableFieldDirty('comment'))}>Comment</div>
                            <Input {...vModel(selTable, 'comment')} small={true} />
                            <div class={getLabelClass(isTableFieldDirty('engine'))}>Engine</div>
                            <Input {...vModel(selTable, 'engine')} small={true} />
                            <div class={getLabelClass(isTableFieldDirty('collation'))}>Collation</div>
                            <ListBox
                                small={true}
                                freeEdit={true}
                                selection={selTable.collation}
                                onSelect={(value, query) => (selTable.collation = value?.value ?? query)}
                                items={getDbCollationOptions(modifyTable.collationOptionValues, selTable?.collation)}
                            />
                            <div class={getLabelClass(isTableFieldDirty('options'))}>Options</div>
                            <Input {...vModel(selTable, 'options')} small={true} />
                        </div>
                    </div>
                    <div class="border border-x4">
                        <div class={[formGridClass, 'border-b border-x4']}>
                            <div class="border-r border-x4 px-3 py-1.5 text-xs opacity-70">Grants</div>
                            <div class="flex items-center gap-px px-1.5 py-1">
                                <IconButton severity="raised" disabled={true} v-tooltip={'Add grant'} icon="icon-[mdi--plus]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={'Remove grant'} icon="icon-[mdi--minus]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={'Move grant up'} icon="icon-[mdi--arrow-up]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={'Move grant down'} icon="icon-[mdi--arrow-down]" />
                            </div>
                        </div>
                        <div class="flex min-h-10 max-h-46 items-center justify-center bg-x2 text-sm opacity-60">Nothing to show</div>
                    </div>
                </div>
            );
        }
    },
    { name: 'ModifyTableModal', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableModal;
