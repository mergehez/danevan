<script setup lang="ts">
import { DATA_GRID_HEADER_HEIGHT } from '@datagrid/dataGrid';
import type { TDataGridState } from '@datagrid/useDataGrid';
import { useDataGridView } from '@datagrid/useDataGridView';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import IconButton from '@ui/IconButton.vue';

const props = defineProps<{
    state: TDataGridState;
    hasToolbar?: boolean;
    withCheckboxes?: boolean;
}>();

const vs = useDataGridView(props.state, props.hasToolbar ?? false, props.withCheckboxes ?? false);
</script>

<template>
    <div :ref="(element) => (vs.containerElement = element as HTMLElement)" class="data-grid-root flex min-h-0 flex-1 flex-col overflow-auto" :style="vs.themeCssVars">
        <!-- <CenteredModal :open="state.isColumnListOpen" title="Columns" :theme-style="vs.themeCssVars" @update:open="!$event && state.closeColumnList()"> -->
        <CenteredModal :open="state.isColumnListOpen" title="Columns" contentClass="max-w-md" @update:open="!$event && state.closeColumnList()">
            <div class="flex max-h-[60vh] flex-col overflow-y-auto px-4 py-4">
                <div class="mb-3 flex items-center justify-between gap-3 border-b border-x3 pb-3 text-xs opacity-80">
                    <span>Toggle column visibility for this result set.</span>
                    <Button severity="secondary" smaller @click="state.showAllColumns">Show all</Button>
                </div>

                <div class="dg-columns-list">
                    <label
                        v-for="columnName in state.allColumns"
                        :key="columnName"
                        class="flex cursor-pointer items-center justify-between gap-3 border-b border-x3/60 py-2 text-sm last:border-b-0"
                    >
                        <span class="truncate">{{ columnName }}</span>
                        <input
                            :checked="!state.hiddenColumns.includes(columnName)"
                            :disabled="state.orderedColumns.length <= 1 && !state.hiddenColumns.includes(columnName)"
                            type="checkbox"
                            class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                            @change="($event.target as HTMLInputElement).checked ? state.showColumn(columnName) : state.hideColumn(columnName)"
                        />
                    </label>
                </div>

                <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                    <Button severity="secondary" smaller @click="state.closeColumnList">Close</Button>
                </div>
            </div>
        </CenteredModal>

        <!-- <CenteredModal
            :open="state.modalEditingCell.open"
            title="Edit cell value"
            width="min(70vw, 1120px)"
            height="min(70vh, 720px)"
            max-width="96vw"
            :theme-style="vs.themeCssVars"
            @update:open="!$event && state.closeModalEditingCell?.({ focusGrid: false })"
        > -->
        <CenteredModal
            :open="state.modalEditingCell.open"
            title="Edit cell value"
            contentClass="w-[70vw] h-[70vh] max-w-none border-x4"
            @update:open="!$event && state.closeModalEditingCell?.({ focusGrid: false })"
        >
            <div class="flex h-full min-h-0 flex-col px-4 py-4">
                <div class="mb-3 flex items-center justify-between gap-3 border-b border-x3 pb-3 text-xs opacity-80">
                    <span class="truncate">{{ vs.getModalEditColumnName() || 'Value' }}</span>
                    <Button severity="secondary" smaller :class="vs.isModalEditTextWrap ? 'bg-blue-500/15 text-blue-200' : ''" @click="vs.toggleModalEditTextWrap">
                        Text wrap
                    </Button>
                </div>

                <textarea
                    :value="state.modalEditingCell.draftValue"
                    :placeholder="vs.getModalEditPlaceholder()"
                    :wrap="vs.isModalEditTextWrap ? 'soft' : 'off'"
                    spellcheck="false"
                    :style="{ fontFamily: vs.gridFontFamilyCss }"
                    :class="[
                        'min-h-0 flex-1 resize-none border border-x4 bg-x1 px-3 py-2 text-sm outline-none',
                        vs.isModalEditTextWrap ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre overflow-auto',
                    ]"
                    @input="state.setModalEditingValue?.(($event.target as HTMLTextAreaElement).value)"
                    @keydown.meta.enter.prevent.stop="state.commitModalEditingCell?.()"
                    @keydown.ctrl.enter.prevent.stop="state.commitModalEditingCell?.()"
                    @keydown.esc.prevent.stop="state.closeModalEditingCell?.()"
                ></textarea>

                <div class="mt-3 flex items-center justify-end gap-2 border-t border-x3 pt-3">
                    <Button severity="secondary" smaller @click="state.closeModalEditingCell?.()">Cancel</Button>
                    <Button severity="primary" smaller @click="state.commitModalEditingCell?.()">Save</Button>
                </div>
            </div>
        </CenteredModal>

        <div v-if="props.hasToolbar" class="flex flex-wrap items-center gap-3 border border-x3 bg-x2 px-3 py-0">
            <div v-if="$slots.title" class="min-w-0 shrink-0">
                <slot name="title"></slot>
            </div>
            <div v-if="$slots.middle" class="min-w-0 flex-1">
                <slot name="middle"></slot>
            </div>
            <div class="ml-auto flex min-w-0 items-center gap-1">
                <div v-if="state.searchable" class="flex items-center gap-1 pr-3">
                    <input
                        :value="state.searchQuery"
                        type="search"
                        spellcheck="false"
                        class="h-7 w-32 border border-x4 bg-x1 px-2.5 text-xs outline-none placeholder:opacity-60"
                        placeholder="Search grid"
                        @input="state.setSearchQuery(($event.target as HTMLInputElement).value)"
                    />
                    <span class="shrink-0 text-right text-2xs opacity-70">
                        {{ state.searchMatchCount ? `${state.activeSearchMatchIndex + 1}/${state.searchMatchCount}` : '0/0' }}
                    </span>
                    <IconButton
                        icon="icon-[mdi--chevron-up]"
                        v-tooltip.xs.nowrap="'Previous match'"
                        smaller
                        :disabled="!state.searchMatchCount"
                        @click.stop="state.goToPreviousSearchMatch()"
                    />
                    <IconButton
                        icon="icon-[mdi--chevron-down]"
                        v-tooltip.xs.nowrap="'Next match'"
                        smaller
                        :disabled="!state.searchMatchCount"
                        @click.stop="state.goToNextSearchMatch()"
                    />
                </div>

                <template v-if="withCheckboxes">
                    <Button severity="secondary" smaller :disabled="!vs.canAddCheckboxRow" @click="state.addRow?.()">Add</Button>
                    <Button severity="secondary" smaller :disabled="!vs.canDeleteCheckboxSelection" @click="state.deleteSelectedRows?.()"> Delete selection </Button>
                </template>

                <slot name="actions"></slot>

                <IconButton icon="icon-[mdi--dots-horizontal]" v-tooltip.xs.nowrap="'Grid actions'" smaller v-menu.button="vs.toolbarMenuItems" />

                <IconButton
                    v-if="state.toggleTranspose"
                    icon="icon-[mdi--swap-horizontal-bold]"
                    :class="state.isTransposed ? 'bg-blue-500/15 text-blue-200' : ''"
                    v-tooltip.xs.nowrap="state.transposeTooltip || 'Transpose grid'"
                    smaller
                    @click.stop="state.toggleTranspose()"
                />
            </div>
        </div>

        <div
            v-if="vs.rowCount"
            :ref="(element) => (vs.viewportElement = element as HTMLElement)"
            class="relative min-h-0 flex-1 overflow-auto border border-x4 bg-x0 outline-none scrollbar-large"
            tabindex="0"
            @scroll="vs.viewportHelpers.handleViewportScroll"
            @keydown="vs.pointerHandlers.handleViewportKeydown"
        >
            <div class="sticky left-0 top-0 z-10 h-0 overflow-visible">
                <canvas
                    :ref="(element) => (vs.headerCanvasElement = element as HTMLCanvasElement)"
                    class="block"
                    :style="{
                        width: `${vs.viewportWidth}px`,
                        height: `${DATA_GRID_HEADER_HEIGHT}px`,
                        cursor: vs.headerCursor,
                        backgroundColor: vs.canvasColors.headerBackground,
                    }"
                    @click="vs.pointerHandlers.handleHeaderClick"
                    @contextmenu="vs.pointerHandlers.handleHeaderContextMenu"
                    @dblclick="vs.pointerHandlers.handleHeaderDoubleClick"
                    @pointerdown="vs.pointerHandlers.handleHeaderPointerDown"
                    @pointermove="vs.pointerHandlers.handleHeaderPointerMove"
                    @pointerleave="vs.pointerHandlers.handleHeaderPointerLeave"
                />

                <canvas
                    :ref="(element) => (vs.bodyCanvasElement = element as HTMLCanvasElement)"
                    class="block"
                    :style="{ width: `${vs.viewportWidth}px`, height: `${vs.bodyCanvasHeight}px`, backgroundColor: vs.canvasColors.bodyBackground }"
                    @click="vs.pointerHandlers.handleBodyClick"
                    @dblclick="vs.pointerHandlers.handleBodyDoubleClick"
                    @pointerdown="vs.pointerHandlers.handleBodyPointerDown"
                    @contextmenu.prevent="vs.pointerHandlers.handleBodyContextMenu"
                />

                <textarea
                    v-if="state.editingCell.rowIndex >= 0 && state.editingCell.columnIndex >= 0 && vs.editingVisualRowIndex >= 0"
                    :ref="(element) => (vs.editingTextareaElement = element as HTMLTextAreaElement)"
                    :rows="vs.getEditingInputRows()"
                    :data-editor-key="`${state.editingCell.rowIndex}:${state.editingCell.columnIndex}`"
                    :data-select-all-on-focus="vs.shouldSelectEditingInputText(state.editingCell.columnIndex) ? 'true' : 'false'"
                    :value="state.editingCell.draftValue"
                    :placeholder="vs.getEditPlaceholder()"
                    class="absolute bg-x1 outline-none ring-1 ring-blue-300"
                    :style="vs.editingInputStyle"
                    @input="vs.onInput"
                    @wheel="vs.handleEditingInputWheel"
                    @blur="state.commitEditingCell()"
                    @keydown.left.stop
                    @keydown.right.stop
                    @keydown.up.stop
                    @keydown.down.stop
                    @keydown.enter.exact.prevent.stop="state.commitEditingCell()"
                    @keydown.enter.shift.stop
                    @keydown.tab.prevent.stop="state.commitEditingCellAndContinue($event.shiftKey ? -1 : 1)"
                    @keydown.esc.prevent.stop="state.cancelEditingCell()"
                ></textarea>
            </div>

            <div :style="{ width: `${vs.gutterColumnWidth + vs.totalMeasuredWidth}px`, height: `${vs.totalScrollHeight}px` }"></div>
        </div>

        <div v-else class="flex h-full items-center justify-center border border-x4 bg-x0 p-6 text-sm opacity-60">
            {{ state.emptyText || 'Select a table to preview rows.' }}
        </div>
    </div>
</template>
