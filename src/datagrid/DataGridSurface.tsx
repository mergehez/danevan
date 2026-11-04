import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { DATA_GRID_ROW_HEIGHT, DATA_GRID_TEXT_HORIZONTAL_INSET } from './dataGrid';
import type { DataGridBodyModel, DataGridCellModel, DataGridCheckboxColors, DataGridCheckboxModel, DataGridHeaderModel, DataGridRowGhostModel } from './useDataGridRenderModel';

/** The gutter checkbox: the same 14 px box, border and mark the grid has always drawn. */
const DataGridCheckbox = component(
    (props: { model: DataGridCheckboxModel; colors: DataGridCheckboxColors }) => {
        return () => {
            const { model } = props;
            const isMarked = model.checked || model.indeterminate;

            return (
                <div
                    data-grid-checkbox={model.checked ? 'checked' : model.indeterminate ? 'indeterminate' : 'unchecked'}
                    style={{ position: 'absolute', left: `${model.left}px`, top: `${model.top}px`, width: '14px', height: '14px' }}
                >
                    <div
                        style={{
                            position: 'absolute',
                            inset: '0',
                            boxSizing: 'border-box',
                            border: `1px solid ${isMarked ? props.colors.active : props.colors.border}`,
                            background: isMarked ? props.colors.active : props.colors.background,
                        }}
                    />
                    {model.indeterminate ? <div style={{ position: 'absolute', left: '3px', top: '6px', width: '8px', height: '2px', background: props.colors.mark }} /> : null}
                    {model.checked && !model.indeterminate ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', left: '0', top: '0' }}>
                            <polyline points="3,7 6,10 11,4" fill="none" stroke={props.colors.mark} stroke-width="2" />
                        </svg>
                    ) : null}
                </div>
            );
        };
    },
    { name: 'DataGridCheckbox', props: ensureAllTsxProps<{ model: DataGridCheckboxModel; colors: DataGridCheckboxColors }>()(['model', 'colors']) }
);

/** One cell's text: plain runs, the muted newline marker and the search matches. */
function renderTextSegments(segments: DataGridCellModel['textSegments'], options: { matchColor: string; markerOpacity: number }) {
    return segments.map((segment, index) => {
        if (segment.isMatch) {
            return (
                <span style={{ color: options.matchColor }} key={index}>
                    {segment.text}
                </span>
            );
        }

        if (segment.isMarker) {
            return (
                <span style={{ opacity: options.markerOpacity }} key={index}>
                    {segment.text}
                </span>
            );
        }

        return <span key={index}>{segment.text}</span>;
    });
}

const DataGridCell = component(
    (props: { model: DataGridCellModel; matchColor: string; searchHighlight: string }) => {
        return () => {
            const cell = props.model;

            return (
                <div class="dg-cell" data-grid-cell={cell.columnIndex} style={{ left: `${cell.left}px`, width: `${cell.width}px`, background: cell.background }}>
                    {cell.ringColor ? <div class="dg-cell-ring" style={{ border: `1px solid ${cell.ringColor}` }} /> : null}
                    {cell.highlights.map((highlight, index) => (
                        <div
                            class="dg-search-highlight"
                            key={index}
                            style={{
                                left: `${DATA_GRID_TEXT_HORIZONTAL_INSET + highlight.left - 1}px`,
                                top: '4px',
                                width: `${highlight.width + 2}px`,
                                height: `${DATA_GRID_ROW_HEIGHT - 8}px`,
                                background: props.searchHighlight,
                            }}
                        />
                    ))}
                    <div
                        class="dg-cell-text"
                        style={{
                            left: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`,
                            lineHeight: `${DATA_GRID_ROW_HEIGHT}px`,
                            color: cell.textColor,
                            textDecoration: cell.strikethrough ? 'line-through' : undefined,
                        }}
                    >
                        {renderTextSegments(cell.textSegments, { matchColor: props.matchColor, markerOpacity: cell.markerOpacity })}
                    </div>
                </div>
            );
        };
    },
    { name: 'DataGridCell', props: ensureAllTsxProps<{ model: DataGridCellModel; matchColor: string; searchHighlight: string }>()(['model', 'matchColor', 'searchHighlight']) }
);

const DataGridRowGhost = component(
    (props: { model: DataGridRowGhostModel; gutterWidth: number }) => {
        return () => {
            const ghost = props.model;

            return (
                <div class="dg-ghost-clip" style={{ left: `${props.gutterWidth}px` }}>
                    <div class="dg-ghost" style={{ left: `${ghost.left}px`, width: `${ghost.width}px`, border: `1px solid ${ghost.borderColor}`, background: ghost.background }}>
                        <div class="dg-cell-text" style={{ left: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`, lineHeight: `${DATA_GRID_ROW_HEIGHT}px`, color: ghost.textColor }}>
                            {renderTextSegments(ghost.textSegments, { matchColor: ghost.textColor, markerOpacity: 1 })}
                        </div>
                    </div>
                </div>
            );
        };
    },
    { name: 'DataGridRowGhost', props: ensureAllTsxProps<{ model: DataGridRowGhostModel; gutterWidth: number }>()(['model', 'gutterWidth']) }
);

export type DataGridHeaderSurfaceProps = {
    model: DataGridHeaderModel;
    fontFamily: string;
    cursor?: string;
    elementRef?: (element: HTMLElement | undefined) => void;
    onClick?: (event: MouseEvent) => void;
    onContextMenu?: (event: MouseEvent) => void;
    onDoubleClick?: (event: MouseEvent) => void;
    onPointerDown?: (event: PointerEvent) => void;
    onPointerMove?: (event: PointerEvent) => void;
    onPointerLeave?: () => void;
};

/** The column headers: gutter, one absolutely-positioned cell per visible column, drag overlays. */
export const DataGridHeaderSurface = component(
    (props: DataGridHeaderSurfaceProps) => {
        return () => {
            const model = props.model;

            return (
                <div
                    ref={(element) => props.elementRef?.(element as HTMLElement | undefined)}
                    data-grid-header=""
                    class="dg-header-surface"
                    onClick={props.onClick}
                    onContextmenu={props.onContextMenu}
                    onDblclick={props.onDoubleClick}
                    onPointerdown={props.onPointerDown}
                    onPointermove={props.onPointerMove}
                    onPointerleave={props.onPointerLeave}
                    style={{ width: `${model.width}px`, height: `${model.height}px`, backgroundColor: model.background, fontFamily: props.fontFamily, cursor: props.cursor }}
                >
                    <div class="dg-header-rule" style={{ left: `${model.gutterWidth}px` }} />
                    <div class="dg-header-gutter" style={{ width: `${model.gutterWidth}px`, background: model.gutterBackground }} />
                    {model.checkbox ? <DataGridCheckbox model={model.checkbox} colors={model.checkboxColors} /> : null}
                    <div class="dg-header-clip" style={{ left: `${model.gutterWidth}px` }}>
                        {model.cells.map((cell) => (
                            <div
                                class="dg-header-cell"
                                key={cell.columnIndex}
                                data-grid-header-cell={cell.columnName}
                                style={{ left: `${cell.left - model.scrollLeft}px`, width: `${cell.width}px`, background: cell.background }}
                            >
                                <div class="dg-header-text" style={{ left: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`, lineHeight: `${model.height}px`, color: cell.textColor }}>
                                    {cell.text}
                                </div>
                            </div>
                        ))}
                        {model.insertX != null ? (
                            <div class="dg-insert-line" style={{ left: `${model.insertX - model.scrollLeft - 1}px`, background: model.draggingBorder }} />
                        ) : null}
                        {model.resizeX != null ? (
                            <div class="dg-resize-line" style={{ left: `${model.resizeX - model.scrollLeft - 1}px`, background: model.selectedCell }} />
                        ) : null}
                        {model.dragPreview ? (
                            <div
                                class="dg-drag-preview"
                                style={{
                                    left: `${model.dragPreview.left}px`,
                                    width: `${model.dragPreview.width}px`,
                                    border: `1px solid ${model.dragPreview.borderColor}`,
                                    background: model.dragPreview.background,
                                }}
                            >
                                <div
                                    class="dg-header-text"
                                    style={{ left: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`, lineHeight: `${model.height}px`, color: model.dragPreview.textColor }}
                                >
                                    {model.dragPreview.text}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            );
        };
    },
    {
        name: 'DataGridHeaderSurface',
        props: ensureAllTsxProps<DataGridHeaderSurfaceProps>()([
            'model',
            'fontFamily',
            'cursor',
            'elementRef',
            'onClick',
            'onContextMenu',
            'onDoubleClick',
            'onPointerDown',
            'onPointerMove',
            'onPointerLeave',
        ]),
    }
);

export type DataGridBodySurfaceProps = {
    model: DataGridBodyModel;
    fontFamily: string;
    elementRef?: (element: HTMLElement | undefined) => void;
    onClick?: (event: MouseEvent) => void;
    onContextMenu?: (event: MouseEvent) => void;
    onDoubleClick?: (event: MouseEvent) => void;
    onPointerDown?: (event: PointerEvent) => void;
};

/**
 * The rows: a window of the result set, positioned inside a layer that is translated while
 * scrolling, so a wheel step moves one transform instead of every row's coordinates. Cells live in
 * their own horizontally-translated layer, which keeps the gutter pinned on a sideways scroll.
 */
export const DataGridBodySurface = component(
    (props: DataGridBodySurfaceProps) => {
        return () => {
            const model = props.model;

            return (
                <div
                    ref={(element) => props.elementRef?.(element as HTMLElement | undefined)}
                    data-grid-body=""
                    class="dg-body-surface"
                    onClick={props.onClick}
                    onDblclick={props.onDoubleClick}
                    onPointerdown={props.onPointerDown}
                    onContextmenu={props.onContextMenu}
                    style={{ width: `${model.width}px`, height: `${model.height}px`, backgroundColor: model.background, fontFamily: props.fontFamily }}
                >
                    <div class="dg-rows-layer" style={{ transform: `translateY(${model.translateY}px)` }}>
                        {model.rows.map((row) => (
                            <div class="dg-row" key={row.visualRowIndex} data-grid-row={row.visualRowIndex} style={{ top: `${row.top}px`, height: `${DATA_GRID_ROW_HEIGHT}px` }}>
                                <div class="dg-gutter" style={{ width: `${model.gutterWidth}px`, background: row.gutterBackground }}>
                                    {row.rowNumber ? (
                                        <div
                                            class="dg-row-number"
                                            data-grid-row-number=""
                                            style={{ right: `${DATA_GRID_TEXT_HORIZONTAL_INSET}px`, lineHeight: `${DATA_GRID_ROW_HEIGHT}px`, color: row.rowNumber.textColor }}
                                        >
                                            {row.rowNumber.text}
                                        </div>
                                    ) : null}
                                    {row.checkbox ? <DataGridCheckbox model={row.checkbox} colors={model.checkboxColors} /> : null}
                                </div>
                                <div class="dg-row-background" style={{ left: `${model.gutterWidth}px`, right: '0', background: row.background }} />
                                <div class="dg-cells-clip" style={{ left: `${model.gutterWidth}px` }}>
                                    <div class="dg-cells-layer" style={{ transform: `translateX(${model.translateX}px)` }}>
                                        {row.cells.map((cell) => (
                                            <DataGridCell key={cell.columnIndex} model={cell} matchColor={model.searchHighlightText} searchHighlight={model.searchHighlight} />
                                        ))}
                                    </div>
                                </div>
                                {row.ghost ? <DataGridRowGhost model={row.ghost} gutterWidth={model.gutterWidth} /> : null}
                                <div class="dg-row-rule" />
                            </div>
                        ))}
                    </div>
                    {model.insertX != null ? (
                        <div class="dg-cells-clip" style={{ left: `${model.gutterWidth}px` }}>
                            <div class="dg-insert-line" style={{ left: `${model.insertX - model.scrollLeft - 1}px`, background: model.draggingBorder }} />
                        </div>
                    ) : null}
                </div>
            );
        };
    },
    {
        name: 'DataGridBodySurface',
        props: ensureAllTsxProps<DataGridBodySurfaceProps>()(['model', 'fontFamily', 'elementRef', 'onClick', 'onContextMenu', 'onDoubleClick', 'onPointerDown']),
    }
);
