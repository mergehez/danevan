export const DATA_GRID_ROW_HEIGHT = 25;
export const DATA_GRID_HEADER_HEIGHT = 33;
export const DATA_GRID_COLUMN_MIN_WIDTH = 72;
export const DATA_GRID_COLUMN_MAX_WIDTH = 520;
export const DATA_GRID_CELL_HORIZONTAL_PADDING = 24;
export const DATA_GRID_OVERSCAN_ROWS = 16;

export const DATA_GRID_TEXT_HORIZONTAL_INSET = 8;
export const DATA_GRID_TEXT_BASELINE_OFFSET = 1;
export const DATA_GRID_CHECKBOX_SIZE = 14;
export const DATA_GRID_EDITING_TEXTAREA_ROWS = 10;
export const DATA_GRID_EDITING_TEXTAREA_MAX_GRID_WIDTH_RATIO = 0.5;
export const DATA_GRID_EDITING_TEXTAREA_MAX_GRID_HEIGHT_RATIO = 0.6;

export const DATA_GRID_ROW_NUMBER_MIN_WIDTH = 42;
export const DATA_GRID_ROW_HEADER_COMPACT_WIDTH = 18;

export const DATA_GRID_NEWLINE_SYMBOL = '⏎';
export const DATA_GRID_NEWLINE_TOKEN = ` ${DATA_GRID_NEWLINE_SYMBOL} `;

/** Maximum length of a cell's displayed text before truncation. Prevents
 *  performance degradation from canvas measureText() on multi-MB strings. */
export const DATA_GRID_MAX_DISPLAY_TEXT_LENGTH = 10_000;
