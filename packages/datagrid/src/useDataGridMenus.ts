import { DataGridInternalState, DataGridTransposedState, getCellKey } from '@datagrid/useDataGrid';
import { createDataGridClipboard } from '@datagrid/useDataGridClipboard';
import { formatDefaultEditingValue } from '@datagrid/useDataGridCoreUtils';
import { DataGridUpdateLayoutState } from '@datagrid/useDataGridHelperTypes';
import { createDataGridNavigation } from '@datagrid/useDataGridNavigation';
import type { DataGridCellValue, DataGridPendingChange, UseDataGridFinalOptions } from '@datagrid/useDataGridTypes';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { writeClipboardText } from '@utils/clipboard';

export interface DataGridMenusArgs {
    options: UseDataGridFinalOptions;
    internalState: DataGridInternalState;
    transposedState: DataGridTransposedState;
    navigation: ReturnType<typeof createDataGridNavigation>;
    clipboard: ReturnType<typeof createDataGridClipboard>;

    contextMenu: { openAtEvent: (event: MouseEvent, items: ContextMenuEntry[]) => void };
    redoChanges: () => void;
    undoChanges: () => void;
    updateLayoutState: DataGridUpdateLayoutState;
}
export function createDataGridMenus(args: DataGridMenusArgs) {
    const { internalState, navigation: nav, clipboard, transposedState: trState, options } = args;
    function setCellValueFromMenu(rowIndex: number, columnIndex: number, nextValue: DataGridCellValue) {
        nav.setActiveCell(rowIndex, columnIndex);
        internalState.editingCell.rowIndex = rowIndex;
        internalState.editingCell.columnIndex = columnIndex;
        internalState.editingCell.draftValue = nextValue === null ? '__NULL__' : formatDefaultEditingValue(nextValue);
        nav.commitEditingCell();
    }

    function shouldPreserveNativeTextUndoRedo(event: KeyboardEvent) {
        const target = event.target;
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    }

    function toggleSort(columnName: string) {
        const currentSort = trState.sortState;

        if (!currentSort || currentSort.columnName !== columnName) {
            args.updateLayoutState({ sort: { columnName, direction: 'desc' } });
            return;
        }

        if (currentSort.direction === 'desc') {
            args.updateLayoutState({ sort: { columnName, direction: 'asc' } });
            return;
        }

        args.updateLayoutState({ sort: null });
    }

    function toggleTranspose() {
        if (!options.enableTranspose) {
            return;
        }

        nav.cancelEditingCell();
        internalState.isTransposed = !internalState.isTransposed;
        nav.clearSelectedRows();
        nav.clearSelectedColumn();
        nav.clearSelectedCellRange();

        if (trState.rows.length && trState.orderedColumns.length) {
            nav.setActiveCell(0, 0);
        }
    }

    function handleGridCommandKeydown(event: KeyboardEvent) {
        if (!event.metaKey && !event.ctrlKey) {
            return false;
        }

        const commandContext = {
            commitEditingCell: nav.commitEditingCell,
            copySelection: (fallbackRowIndex?: number, fallbackColumnIndex?: number) => clipboard.copySelection(fallbackRowIndex, fallbackColumnIndex),
            isTextInputTarget: shouldPreserveNativeTextUndoRedo(event),
        };

        if (options.handleGridCommandKeydown?.(event, commandContext)) {
            return true;
        }

        if (commandContext.isTextInputTarget) {
            return false;
        }

        const key = event.key.toLowerCase();

        if (key === 'z' && event.shiftKey && internalState.redoStack.length) {
            event.preventDefault();
            args.redoChanges();
            return true;
        }

        if (key === 'z' && internalState.undoStack.length) {
            event.preventDefault();
            args.undoChanges();
            return true;
        }

        if (key === 'y' && internalState.redoStack.length) {
            event.preventDefault();
            args.redoChanges();
            return true;
        }

        if (key === 'c') {
            event.preventDefault();
            void commandContext.copySelection();
            return true;
        }

        return false;
    }

    function handleGridKeydown(event: KeyboardEvent) {
        if (handleGridCommandKeydown(event)) {
            return;
        }

        if (!trState.rows.length || !trState.orderedColumns.length) {
            return;
        }

        if (nav.keyboardNavigation.tryNavigate(event)) {
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            nav.startEditingCell();
        }
    }

    function openCellContextMenu(rowIndex: number, columnIndex: number, event: MouseEvent) {
        const columnName = trState.getColumnName(columnIndex);
        const row = trState.rows[rowIndex];

        if (!columnName || !row) {
            return;
        }

        if (!clipboard.selectionContainsCell(rowIndex, columnIndex)) {
            nav.clearSelectedColumn();
            nav.clearSelectedRows();
            nav.clearSelectedCellRange();
            nav.setActiveCell(rowIndex, columnIndex);
        }

        const cellContext = {
            rowIndex,
            columnIndex,
            columnName,
            row,
            value: trState.getDisplayedCellValue(rowIndex, columnName),
            event,
        };
        const resolvedCell = trState.resolveCell(rowIndex, columnName);
        const customItems = options.cellContextMenuCustomItems?.(cellContext) ?? [];
        const selection = clipboard.getSelectionBounds(rowIndex, columnIndex);
        const canCopyAsCsv = selection.columnIndexes.length > 1;
        const canGenerateSqlStatements = !internalState.isTransposed && !!internalState.sqlInsertTableName && selection.rowIndexes.length > 0 && selection.columnIndexes.length > 0;
        const items: ContextMenuEntry[] = [
            {
                id: 'copy',
                label: 'Copy',
                action: async () => clipboard.copySelection(rowIndex, columnIndex),
            },
            {
                id: 'copy-as',
                label: 'Copy As',
                children: [
                    {
                        id: 'copy-as-json',
                        label: 'As JSON',
                        action: async () => clipboard.copySelectionAsJson(rowIndex, columnIndex),
                    },
                    {
                        id: 'copy-as-sql',
                        label: 'As SQL Literal',
                        action: async () => clipboard.copySelectionAsSql(rowIndex, columnIndex),
                    },
                    ...(canCopyAsCsv
                        ? [
                              {
                                  id: 'copy-as-csv',
                                  label: 'As CSV',
                                  action: async () => clipboard.copySelectionAsCsv(rowIndex, columnIndex),
                              } satisfies ContextMenuEntry,
                          ]
                        : []),
                    ...(canGenerateSqlStatements
                        ? [
                              {
                                  id: 'copy-as-sql-insert',
                                  label: 'As SQL INSERT Statement',
                                  action: async () => clipboard.copySelectionAsSqlInsert(rowIndex, columnIndex),
                              } satisfies ContextMenuEntry,
                              {
                                  id: 'copy-as-sql-select',
                                  label: 'As SQL SELECT Statement',
                                  action: async () => clipboard.copySelectionAsSqlSelect(rowIndex, columnIndex),
                              } satisfies ContextMenuEntry,
                          ]
                        : []),
                ],
            },
            ...(customItems.length ? customItems : []),
            {
                id: 'select-all',
                label: 'Select All',
                action: () => nav.selectAllRows({ focus: true }),
            },
            ...(resolvedCell.editable
                ? [
                      {
                          id: 'set-value-edit',
                          label: 'Edit inline',
                          action: () => nav.startEditingCell(rowIndex, columnIndex),
                      },
                      {
                          id: 'set-value-edit-modal',
                          label: 'Edit in modal',
                          action: () => nav.openModalEditingCell(rowIndex, columnIndex),
                      },
                      {
                          id: 'set-value',
                          label: 'Set Value',
                          children: [
                              {
                                  id: 'set-value-uuid',
                                  label: 'UUID',
                                  action: () => setCellValueFromMenu(rowIndex, columnIndex, crypto.randomUUID()),
                              },
                              {
                                  id: 'set-value-empty-string',
                                  label: 'Empty String',
                                  action: () => setCellValueFromMenu(rowIndex, columnIndex, ''),
                              },
                              {
                                  id: 'set-value-null',
                                  label: '(null)',
                                  action: () => setCellValueFromMenu(rowIndex, columnIndex, null),
                              },
                          ],
                      } satisfies ContextMenuEntry,
                  ]
                : []),
        ];

        args.contextMenu.openAtEvent(event, items);
    }

    function openHeaderContextMenu(columnIndex: number, event: MouseEvent) {
        const columnName = trState.getSourceColumnNameForColumn(columnIndex);

        if (!columnName) {
            return;
        }

        const visibleColumnCount = trState.orderedColumns.length;
        const canUseTimestampDisplayTypes = options.canUseTimestampDisplayTypes?.(columnName) ?? false;
        const currentDisplayType = options.getColumnDisplayType?.(columnName) ?? 'number';
        const customDisplayItems = options.headerContextMenuCustomItems?.({ columnIndex, columnName, event }) ?? [];
        const displayTypeItems: ContextMenuEntry[] = [];

        if (canUseTimestampDisplayTypes && options.setColumnDisplayType) {
            displayTypeItems.push(
                {
                    id: 'display-type-number',
                    label: 'Number',
                    checked: currentDisplayType === 'number',
                    action: () => options.setColumnDisplayType?.(columnName, 'number'),
                },
                {
                    id: 'display-type-seconds',
                    label: 'Timestamp (Seconds)',
                    checked: currentDisplayType === 'timestamp-seconds',
                    action: () => options.setColumnDisplayType?.(columnName, 'timestamp-seconds'),
                },
                {
                    id: 'display-type-milliseconds',
                    label: 'Timestamp (Milliseconds)',
                    checked: currentDisplayType === 'timestamp-milliseconds',
                    action: () => options.setColumnDisplayType?.(columnName, 'timestamp-milliseconds'),
                },
                {
                    id: 'display-type-microseconds',
                    label: 'Timestamp (Microseconds)',
                    checked: currentDisplayType === 'timestamp-microseconds',
                    action: () => options.setColumnDisplayType?.(columnName, 'timestamp-microseconds'),
                }
            );
        }

        if (customDisplayItems.length) {
            if (displayTypeItems.length) {
                displayTypeItems.push({ type: 'separator' }, { id: 'custom-formatters', type: 'title', title: 'Custom Formatters' });
            }

            displayTypeItems.push(...customDisplayItems);
        }

        const items: ContextMenuEntry[] = [
            {
                id: 'copy-column-name',
                label: 'Copy Column Name',
                action: async () => writeClipboardText(columnName),
            },
            {
                id: 'select-column',
                label: 'Select Column',
                action: () => nav.selectColumn(columnName, { focus: true }),
            },
            { type: 'separator' },
            {
                id: 'hide-column',
                label: 'Hide Column',
                disabled: visibleColumnCount <= 1,
                action: () => nav.hideColumn(columnName),
            },
            {
                id: 'show-column-list',
                label: 'Show Column List',
                action: () => nav.openColumnList(),
            },
            { type: 'separator' },
            {
                id: 'sort-asc',
                label: 'Order By Asc',
                checked: trState.sortState?.columnName === columnName && trState.sortState?.direction === 'asc',
                action: () => args.updateLayoutState({ sort: { columnName, direction: 'asc' } }),
            },
            {
                id: 'sort-desc',
                label: 'Order By Desc',
                checked: trState.sortState?.columnName === columnName && trState.sortState?.direction === 'desc',
                action: () => args.updateLayoutState({ sort: { columnName, direction: 'desc' } }),
            },
        ];

        if (displayTypeItems.length) {
            items.push({ type: 'separator' }, { id: 'change-display-type', label: 'Change Display Type', children: displayTypeItems });
        }

        args.contextMenu.openAtEvent(event, items);
    }

    function setGridElement(target: unknown) {
        internalState.gridElement = target instanceof HTMLElement ? target : undefined;
    }

    function setTableElement(target: unknown) {
        internalState.tableElement = target instanceof HTMLElement ? target : undefined;
    }

    function isDirtyCell(rowIndex: number, columnName: string) {
        const resolvedCell = trState.resolveCell(rowIndex, columnName);
        return !!(resolvedCell.editable && resolvedCell.sourceColumnName && internalState.pendingChanges[getCellKey(resolvedCell.sourceRowIndex, resolvedCell.sourceColumnName)]);
    }

    function isDirtyRow(rowIndex: number) {
        const sourceColumnName = trState.getSourceColumnNameForRow(rowIndex);
        return sourceColumnName
            ? internalState.dirtyChanges.some((change: DataGridPendingChange) => change.columnName === sourceColumnName)
            : internalState.dirtyChanges.some((change: DataGridPendingChange) => change.rowIndex === rowIndex);
    }

    function isSavedCell(rowIndex: number, columnName: string) {
        const resolvedCell = trState.resolveCell(rowIndex, columnName);
        return !!(
            resolvedCell.editable &&
            resolvedCell.sourceColumnName &&
            internalState.savedCellKeys.includes(getCellKey(resolvedCell.sourceRowIndex, resolvedCell.sourceColumnName))
        );
    }

    function isSavedRow(rowIndex: number) {
        const sourceColumnName = trState.getSourceColumnNameForRow(rowIndex);
        return sourceColumnName
            ? internalState.savedCellKeys.some((cellKey: string) => cellKey.endsWith(`:${sourceColumnName}`))
            : internalState.savedRowIndexes.includes(rowIndex);
    }

    return {
        toggleSort,
        toggleTranspose,
        handleGridKeydown,
        openCellContextMenu,
        openHeaderContextMenu,
        setGridElement,
        setTableElement,
        isDirtyCell,
        isDirtyRow,
        isSavedCell,
        isSavedRow,
    };
}
