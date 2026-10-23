import { component, ensureAllTsxProps, vModel } from '#shared/utils/tsxHelpers.tsx';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Alert } from '../../shared/components/Alert.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { Checkbox } from '../../shared/components/Checkbox.tsx';
import { splitter } from '../../shared/components/Splitter.tsx';
import { splitterVertical } from '../../shared/components/SplitterVertical.tsx';
import { SqlEditor } from './SqlEditor.tsx';
import { ModifyTableColumnForm } from './modifyTable/ModifyTableColumnForm.tsx';
import { ModifyTableForeignKeyForm } from './modifyTable/ModifyTableForeignKeyForm.tsx';
import { ModifyTableIndexForm } from './modifyTable/ModifyTableIndexForm.tsx';
import { ModifyTableKeyForm } from './modifyTable/ModifyTableKeyForm.tsx';
import { ModifyTableSidebar } from './modifyTable/ModifyTableSidebar.tsx';
import { ModifyTableTableForm } from './modifyTable/ModifyTableTableForm.tsx';
import { useModifyTableForm } from './modifyTable/formHelpers.ts';

type Props = {};

export const ModifyTableModal = component(
    (_: Props) => {
        const { modifyTable, selectedTable, selectedColumn, selectedKey, selectedForeignKey, selectedIndex } = useModifyTableForm();
        // A function ref: the form area is rendered by the splitter component, so a string ref would
        // resolve in its scope rather than this one.
        const formContainer = ref<HTMLElement | null>(null);

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

                const selectedForeignKeyColumn = modifyTable.selectedForeignKeyColumn;

                if (!selectedForeignKeyColumn) {
                    return;
                }

                const options = modifyTable.getTargetTableColumnNames(targetTable);

                if (options.length > 0 && !options.includes(selectedForeignKeyColumn.targetName)) {
                    selectedForeignKeyColumn.targetName = options[0]!;
                }
            },
            { immediate: true }
        );

        function focusFormField() {
            void nextTick(() => {
                formContainer.value?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')?.focus();
            });
        }

        /** The menu's Edit entry and ⌘↓ land the caret in the first field of the selected item. */
        function editSelectedItem() {
            focusFormField();
        }

        function isTypingTarget(target: EventTarget | null) {
            return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor');
        }

        function handleKeydown(event: KeyboardEvent) {
            if (!modifyTable.open || isTypingTarget(event.target)) {
                return;
            }

            const withCommand = event.metaKey || event.ctrlKey;

            if (withCommand && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                modifyTable.duplicateSelectedEntity();
                return;
            }

            if (withCommand && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                modifyTable.undoChanges();
                return;
            }

            if (withCommand && event.key === 'ArrowDown') {
                event.preventDefault();
                editSelectedItem();
                return;
            }

            if (!withCommand && (event.key === 'Backspace' || event.key === 'Delete')) {
                event.preventDefault();
                void modifyTable.deleteSelectedEntity();
            }
        }

        // The modal stays mounted while closed, so the shortcut only listens while it is open.
        onMounted(() => window.addEventListener('keydown', handleKeydown));
        onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

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
                                left: <ModifyTableSidebar onEdit={editSelectedItem} />,
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
                            {sectionFooter()}
                        </div>
                    ),
                    title: () => <div class="font-semibold">Modify</div>,
                }}
            />
        );

        function sectionFooter() {
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

        function sectionPreview() {
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

        function sectionForm() {
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
                    <div ref={(element) => (formContainer.value = element as HTMLElement | null)} data-testid="modify-form" class="min-h-0 flex-1 overflow-y-auto px-3">
                        {modifyTable.loading ? (
                            <div class="flex h-full min-h-60 items-center justify-center text-sm opacity-70">Loading table metadata...</div>
                        ) : selectedTable.value ? (
                            <ModifyTableTableForm />
                        ) : selectedColumn.value ? (
                            <ModifyTableColumnForm />
                        ) : selectedKey.value ? (
                            <ModifyTableKeyForm />
                        ) : selectedForeignKey.value ? (
                            <ModifyTableForeignKeyForm />
                        ) : selectedIndex.value ? (
                            <ModifyTableIndexForm />
                        ) : (
                            <div class="flex h-full min-h-60 items-center justify-center border border-dashed border-x4 bg-transparent text-sm opacity-65">
                                Select a table item in the sidebar to edit its properties.
                            </div>
                        )}
                    </div>
                </div>
            );
        }
    },
    { name: 'ModifyTableModal', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableModal;
