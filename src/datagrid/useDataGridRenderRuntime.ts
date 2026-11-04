import { ref } from 'vue';
import { DATA_GRID_CHECKBOX_SIZE } from './dataGrid';
import type { DataGridRenderRuntimeArgs } from './useDataGridView';

/**
 * The grid's imperative surface. The grid itself is DOM and re-renders from reactive state, so
 * this module owns only what the render model cannot observe by itself: the handles the pointer
 * layer keeps outside reactivity (an active resize, a drag) and the geometry helpers they need.
 *
 * `scheduleDraw` is kept as the name every interaction already used; it now marks the grid for the
 * next Vue flush instead of scheduling an animation frame.
 */
export function useDataGridRenderRuntime(args: DataGridRenderRuntimeArgs) {
    const { internals, gridState: _gridState } = args;
    const paintTick = ref(0);

    /** Where a checkbox sits inside a gutter-sized area, in the coordinates the grid has always used. */
    function getCheckboxMetrics(containerWidth: number, rowTop: number, rowHeight: number) {
        return {
            left: Math.floor((containerWidth - DATA_GRID_CHECKBOX_SIZE) / 2),
            top: rowTop + Math.floor((rowHeight - DATA_GRID_CHECKBOX_SIZE) / 2),
        };
    }

    function isCheckboxHit(localX: number, localY: number, options: { containerWidth: number; rowTop: number; rowHeight: number }) {
        const metrics = getCheckboxMetrics(options.containerWidth, options.rowTop, options.rowHeight);

        return localX >= metrics.left && localX <= metrics.left + DATA_GRID_CHECKBOX_SIZE && localY >= metrics.top && localY <= metrics.top + DATA_GRID_CHECKBOX_SIZE;
    }

    function getNormalizedSelectedCellRange() {
        const range = _gridState.value.selectedCellRange;

        if (!range) {
            return undefined;
        }

        return {
            topRowIndex: Math.min(range.startRowIndex, range.endRowIndex),
            bottomRowIndex: Math.max(range.startRowIndex, range.endRowIndex),
            leftColumnIndex: Math.min(range.startColumnIndex, range.endColumnIndex),
            rightColumnIndex: Math.max(range.startColumnIndex, range.endColumnIndex),
        };
    }

    function scheduleDraw() {
        paintTick.value += 1;
    }

    function drawGrid() {
        paintTick.value += 1;
    }

    function stopDragAutoScroll() {
        if (internals.dragAutoScrollFrame) {
            cancelAnimationFrame(internals.dragAutoScrollFrame);
            internals.dragAutoScrollFrame = 0;
        }

        internals.dragAutoScrollVelocity = 0;
    }

    return {
        drawGrid,
        getNormalizedSelectedCellRange,
        isCheckboxHit,
        paintTick,
        scheduleDraw,
        stopDragAutoScroll,
    };
}
