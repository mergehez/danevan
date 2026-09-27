import { withKeys } from 'vue';
import { Button } from '../shared/components/Button.tsx';
import { CenteredModal } from '../shared/components/CenteredModal.tsx';
import { IconButton } from '../shared/components/IconButton.tsx';
import { DATA_GRID_HEADER_HEIGHT } from './dataGrid';
import type { TDataGridState } from './useDataGrid';
import { useDataGridView } from './useDataGridView';
import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    state: TDataGridState;
    hasToolbar?: boolean;
    withCheckboxes?: boolean;
} & {
    slots?: { title?: () => unknown; middle?: () => unknown; actions?: () => unknown };
};

export const DataGrid = component(
    (props: Props) => {
        const vs = useDataGridView(props.state, props.hasToolbar ?? false, props.withCheckboxes ?? false);

        return () => (
            <div ref={(element) => (vs.containerElement = element as HTMLElement)} class="data-grid-root flex min-h-0 flex-1 flex-col overflow-auto" style={vs.themeCssVars}>
                {/* <CenteredModal :open="state.isColumnListOpen" title="Columns" :theme-style="vs.themeCssVars" @update:open="!$event && state.closeColumnList()"> */}
                <CenteredModal open={props.state.isColumnListOpen} title="Columns" contentClass="max-w-md" onOpenChange={(t) => !t && props.state.closeColumnList()}>
                    <div class="flex max-h-[60vh] flex-col overflow-y-auto px-4 py-4">
                        <div class="mb-3 flex items-center justify-between gap-3 border-b border-x3 pb-3 text-xs opacity-80">
                            <span>Toggle column visibility for this result set.</span>
                            <Button severity="secondary" smaller={true} onClick={props.state.showAllColumns}>
                                Show all
                            </Button>
                        </div>
                        <div class="dg-columns-list">
                            {(props.state.allColumns ?? []).map((columnName) => (
                                <label class="flex cursor-pointer items-center justify-between gap-3 border-b border-x3/60 py-2 text-sm last:border-b-0" key={columnName}>
                                    <span class="truncate">{columnName}</span>
                                    <input
                                        checked={!props.state.hiddenColumns.includes(columnName)}
                                        disabled={props.state.orderedColumns.length <= 1 && !props.state.hiddenColumns.includes(columnName)}
                                        type="checkbox"
                                        onChange={(e) => ((e.target as HTMLInputElement).checked ? props.state.showColumn(columnName) : props.state.hideColumn(columnName))}
                                        class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                    />
                                </label>
                            ))}
                        </div>
                        <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                            <Button severity="secondary" smaller={true} onClick={props.state.closeColumnList}>
                                Close
                            </Button>
                        </div>
                    </div>
                </CenteredModal>
                {/* <CenteredModal
            :open="state.modalEditingCell.open"
            title="Edit cell value"
            width="min(70vw, 1120px)"
            height="min(70vh, 720px)"
            max-width="96vw"
            :theme-style="vs.themeCssVars"
            @update:open="!$event && state.closeModalEditingCell?.({ focusGrid: false })"
        > */}
                <CenteredModal
                    open={props.state.modalEditingCell.open}
                    title="Edit cell value"
                    contentClass="w-[70vw] h-[70vh] max-w-none border-x4"
                    onOpenChange={(t) => !t && props.state.closeModalEditingCell?.({ focusGrid: false })}
                >
                    <div class="flex h-full min-h-0 flex-col px-4 py-4">
                        <div class="mb-3 flex items-center justify-between gap-3 border-b border-x3 pb-3 text-xs opacity-80">
                            <span class="truncate">{vs.getModalEditColumnName() || 'Value'}</span>
                            <Button severity="secondary" smaller={true} onClick={vs.toggleModalEditTextWrap} class={vs.isModalEditTextWrap ? 'bg-blue-500/15 text-blue-200' : ''}>
                                Text wrap
                            </Button>
                        </div>
                        <textarea
                            value={props.state.modalEditingCell.draftValue}
                            placeholder={vs.getModalEditPlaceholder()}
                            wrap={vs.isModalEditTextWrap ? 'soft' : 'off'}
                            spellcheck="false"
                            onInput={(e) => props.state.setModalEditingValue?.((e.target as HTMLTextAreaElement).value)}
                            onKeydown={prevented(withKeys(() => props.state.commitModalEditingCell?.(), ['enter']))}
                            class={[
                                'min-h-0 flex-1 resize-none border border-x4 bg-x1 px-3 py-2 text-sm outline-none',
                                vs.isModalEditTextWrap ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre overflow-auto',
                            ]}
                            style={{ fontFamily: vs.gridFontFamilyCss }}
                        />
                        <div class="mt-3 flex items-center justify-end gap-2 border-t border-x3 pt-3">
                            <Button severity="secondary" smaller={true} onClick={() => props.state.closeModalEditingCell?.()}>
                                Cancel
                            </Button>
                            <Button severity="primary" smaller={true} onClick={() => props.state.commitModalEditingCell?.()}>
                                Save
                            </Button>
                        </div>
                    </div>
                </CenteredModal>
                {props.hasToolbar ? (
                    <div class="flex flex-wrap items-center gap-3 border border-x3 bg-x2 px-3 py-0">
                        {props.slots?.title ? <div class="min-w-0 shrink-0">{props.slots?.title?.()}</div> : null}
                        {props.slots?.middle ? <div class="min-w-0 flex-1">{props.slots?.middle?.()}</div> : null}
                        <div class="ml-auto flex min-w-0 items-center gap-1">
                            {props.state.searchable ? (
                                <div class="flex items-center gap-1 pr-3">
                                    <input
                                        value={props.state.searchQuery}
                                        type="search"
                                        spellcheck="false"
                                        placeholder="Search grid"
                                        onInput={(e) => props.state.setSearchQuery((e.target as HTMLInputElement).value)}
                                        class="h-7 w-32 border border-x4 bg-x1 px-2.5 text-xs outline-none placeholder:opacity-60"
                                    />
                                    <span class="shrink-0 text-right text-2xs opacity-70">
                                        {props.state.searchMatchCount ? `${props.state.activeSearchMatchIndex + 1}/${props.state.searchMatchCount}` : '0/0'}
                                    </span>
                                    <IconButton
                                        icon="icon-[mdi--chevron-up]"
                                        v-tooltip={'Previous match'}
                                        smaller={true}
                                        disabled={!props.state.searchMatchCount}
                                        onClick={prevented(() => props.state.goToPreviousSearchMatch())}
                                    />
                                    <IconButton
                                        icon="icon-[mdi--chevron-down]"
                                        v-tooltip={'Next match'}
                                        smaller={true}
                                        disabled={!props.state.searchMatchCount}
                                        onClick={prevented(() => props.state.goToNextSearchMatch())}
                                    />
                                </div>
                            ) : null}
                            {props.withCheckboxes ? (
                                <>
                                    <Button severity="secondary" smaller={true} disabled={!vs.canAddCheckboxRow} onClick={() => props.state.addRow?.()}>
                                        Add
                                    </Button>
                                    <Button severity="secondary" smaller={true} disabled={!vs.canDeleteCheckboxSelection} onClick={() => props.state.deleteSelectedRows?.()}>
                                        {' '}
                                        Delete selection{' '}
                                    </Button>
                                </>
                            ) : null}
                            {props.slots?.actions?.()}
                            <IconButton icon="icon-[mdi--dots-horizontal]" v-tooltip={'Grid actions'} smaller={true} v-menu={vs.toolbarMenuItems} />
                            {props.state.toggleTranspose ? (
                                <IconButton
                                    icon="icon-[mdi--swap-horizontal-bold]"
                                    v-tooltip={props.state.transposeTooltip || 'Transpose grid'}
                                    smaller={true}
                                    onClick={prevented(() => props.state.toggleTranspose!())}
                                    class={props.state.isTransposed ? 'bg-blue-500/15 text-blue-200' : ''}
                                />
                            ) : null}
                        </div>
                    </div>
                ) : null}
                {vs.rowCount ? (
                    <div
                        ref={(element) => (vs.viewportElement = element as HTMLElement)}
                        tabindex="0"
                        onScroll={vs.viewportHelpers.handleViewportScroll}
                        onKeydown={vs.pointerHandlers.handleViewportKeydown}
                        class="relative min-h-0 flex-1 overflow-auto border border-x4 bg-x0 outline-none scrollbar-large"
                    >
                        <div class="sticky left-0 top-0 z-10 h-0 overflow-visible">
                            <canvas
                                ref={(element) => (vs.headerCanvasElement = element as HTMLCanvasElement)}
                                onClick={vs.pointerHandlers.handleHeaderClick}
                                onContextmenu={vs.pointerHandlers.handleHeaderContextMenu}
                                onDblclick={vs.pointerHandlers.handleHeaderDoubleClick}
                                onPointerdown={vs.pointerHandlers.handleHeaderPointerDown}
                                onPointermove={vs.pointerHandlers.handleHeaderPointerMove}
                                onPointerleave={vs.pointerHandlers.handleHeaderPointerLeave}
                                class="block"
                                style={{
                                    width: `${vs.viewportWidth}px`,
                                    height: `${DATA_GRID_HEADER_HEIGHT}px`,
                                    cursor: vs.headerCursor,
                                    backgroundColor: vs.canvasColors.headerBackground,
                                }}
                            />
                            <canvas
                                ref={(element) => (vs.bodyCanvasElement = element as HTMLCanvasElement)}
                                onClick={vs.pointerHandlers.handleBodyClick}
                                onDblclick={vs.pointerHandlers.handleBodyDoubleClick}
                                onPointerdown={vs.pointerHandlers.handleBodyPointerDown}
                                onContextmenu={prevented(vs.pointerHandlers.handleBodyContextMenu)}
                                class="block"
                                style={{ width: `${vs.viewportWidth}px`, height: `${vs.bodyCanvasHeight}px`, backgroundColor: vs.canvasColors.bodyBackground }}
                            />
                            {props.state.editingCell.rowIndex >= 0 && props.state.editingCell.columnIndex >= 0 && vs.editingVisualRowIndex >= 0 ? (
                                <textarea
                                    ref={(element) => (vs.editingTextareaElement = element as HTMLTextAreaElement)}
                                    rows={vs.getEditingInputRows()}
                                    data-editor-key={`${props.state.editingCell.rowIndex}:${props.state.editingCell.columnIndex}`}
                                    data-select-all-on-focus={vs.shouldSelectEditingInputText(props.state.editingCell.columnIndex) ? 'true' : 'false'}
                                    value={props.state.editingCell.draftValue}
                                    placeholder={vs.getEditPlaceholder()}
                                    onInput={vs.onInput}
                                    onWheel={vs.handleEditingInputWheel}
                                    onBlur={() => props.state.commitEditingCell()}
                                    onKeydown={prevented(withKeys(() => {}, ['left']))}
                                    class="absolute bg-x1 outline-none ring-1 ring-blue-300"
                                    style={vs.editingInputStyle}
                                />
                            ) : null}
                        </div>
                        <div style={{ width: `${vs.gutterColumnWidth + vs.totalMeasuredWidth}px`, height: `${vs.totalScrollHeight}px` }} />
                    </div>
                ) : (
                    <div class="flex h-full items-center justify-center border border-x4 bg-x0 p-6 text-sm opacity-60">
                        {props.state.emptyText || 'Select a table to preview rows.'}
                    </div>
                )}
            </div>
        );
    },
    { name: 'DataGrid', props: ensureAllTsxProps<Props>()(['state', 'hasToolbar', 'withCheckboxes', 'slots']) }
);

export default DataGrid;
