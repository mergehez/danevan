export const DATA_GRID_FONT_OPTIONS = [
    { id: 'system-sans', label: 'System Sans' },
    { id: 'system-serif', label: 'System Serif' },
    { id: 'system-mono', label: 'System Mono' },
    { id: 'roboto', label: 'Roboto' },
    { id: 'roboto-condensed', label: 'Roboto Condensed' },
    { id: 'jetbrains-mono', label: 'JetBrains Mono' },
] as const;

export type DataGridFontFamily = (typeof DATA_GRID_FONT_OPTIONS)[number]['id'];

export type DataGridTheme = {
    text: string;
    mutedText: string;
    bodyBackground: string;
    headerBackground: string;
    border: string;
    dirtyRow: string;
    savedRow: string;
    dirtyCell: string;
    savedCell: string;
    insertedRow: string;
    deletedRow: string;
    deletedText: string;
    selectedCell: string;
    activeRow: string;
    rowNumberBackground: string;
    activeRowNumber: string;
    activeText: string;
    activeCell: string;
    sortedColumn: string;
    searchHighlight: string;
    searchHighlightText: string;
    draggingBorder: string;
    draggedColumn: string;
    checkboxBorder: string;
    checkboxBackground: string;
    checkboxMark: string;
    toolbarBackground: string;
    panelBackground: string;
    panelBackgroundAlt: string;
    panelBorder: string;
    inputBackground: string;
    buttonBackground: string;
    buttonHoverBackground: string;
    buttonText: string;
    secondaryButtonBackground: string;
    secondaryButtonHoverBackground: string;
    overlayBackground: string;
    menuBackground: string;
    menuBorder: string;
    menuText: string;
    menuItemHoverBackground: string;
    menuSeparator: string;
    menuDangerText: string;
    menuDangerHoverBackground: string;
    emptyStateBackground: string;
    emptyStateText: string;
    focusRing: string;
};

export const DEFAULT_DATA_GRID_FONT_FAMILY: DataGridFontFamily = 'system-sans';
export const DEFAULT_DATA_GRID_SHOW_ROW_NUMBERS = true;
export const DEFAULT_DATA_GRID_THEME: DataGridTheme = {
    text: '#d1d5db',
    mutedText: 'rgba(209, 213, 219, 0.6)',
    bodyBackground: '#151f27',
    headerBackground: '#1b2530',
    border: '#2b3642',
    dirtyRow: 'rgba(251, 191, 36, 0.08)',
    savedRow: 'rgba(52, 211, 153, 0.08)',
    dirtyCell: 'rgba(251, 191, 36, 0.15)',
    savedCell: 'rgba(52, 211, 153, 0.14)',
    insertedRow: 'rgba(59, 130, 246, 0.12)',
    deletedRow: 'rgba(239, 68, 68, 0.12)',
    deletedText: 'rgba(255, 255, 255, 0.7)',
    selectedCell: '#214283',
    activeRow: '#2b3642',
    rowNumberBackground: '#1b2530',
    activeRowNumber: 'rgba(59, 130, 246, 0.2)',
    activeText: '#8cc7ff',
    activeCell: 'rgba(59, 130, 246, 0.18)',
    sortedColumn: 'rgba(52, 211, 153, 0.95)',
    searchHighlight: '#f9bf47',
    searchHighlightText: '#111827',
    draggingBorder: '#8cc7ff',
    draggedColumn: 'rgba(255, 255, 255, 0.08)',
    checkboxBorder: 'rgba(209, 213, 219, 0.45)',
    checkboxBackground: 'rgba(255, 255, 255, 0.03)',
    checkboxMark: '#0f1728',
    toolbarBackground: '#182028',
    panelBackground: '#182028',
    panelBackgroundAlt: '#1b2530',
    panelBorder: 'rgba(255, 255, 255, 0.12)',
    inputBackground: '#111923',
    buttonBackground: '#2d4f89',
    buttonHoverBackground: '#3b66ac',
    buttonText: '#eff6ff',
    secondaryButtonBackground: '#24303c',
    secondaryButtonHoverBackground: '#31404e',
    overlayBackground: 'rgba(3, 7, 18, 0.72)',
    menuBackground: '#1b232b',
    menuBorder: 'rgba(255, 255, 255, 0.12)',
    menuText: '#f3f4f6',
    menuItemHoverBackground: 'rgba(255, 255, 255, 0.08)',
    menuSeparator: 'rgba(255, 255, 255, 0.1)',
    menuDangerText: '#fecaca',
    menuDangerHoverBackground: 'rgba(239, 68, 68, 0.16)',
    emptyStateBackground: '#151f27',
    emptyStateText: 'rgba(209, 213, 219, 0.6)',
    focusRing: '#8cc7ff',
};

const DATA_GRID_FONT_FAMILY_CSS: Record<DataGridFontFamily, string> = {
    'system-sans': 'ui-sans-serif, system-ui, sans-serif',
    'system-serif': 'ui-serif, Georgia, serif',
    'system-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    roboto: '"Roboto", ui-sans-serif, system-ui, sans-serif',
    'roboto-condensed': '"Roboto Condensed", "Roboto", ui-sans-serif, system-ui, sans-serif',
    'jetbrains-mono': '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

export function isDataGridFontFamily(value: unknown): value is DataGridFontFamily {
    return typeof value === 'string' && value in DATA_GRID_FONT_FAMILY_CSS;
}

export function getDataGridFontFamilyCss(fontFamily: DataGridFontFamily | undefined) {
    return DATA_GRID_FONT_FAMILY_CSS[fontFamily ?? DEFAULT_DATA_GRID_FONT_FAMILY];
}

export function getDataGridCanvasFont(isHeader: boolean, fontFamily: DataGridFontFamily | undefined) {
    return `${isHeader ? 500 : 400} 12px ${getDataGridFontFamilyCss(fontFamily)}`;
}

export function resolveDataGridTheme(theme: Partial<DataGridTheme> | undefined): DataGridTheme {
    return {
        ...DEFAULT_DATA_GRID_THEME,
        ...theme,
    };
}

export function getDataGridThemeCssVariables(theme: DataGridTheme) {
    return {
        '--dg-text': theme.text,
        '--dg-muted-text': theme.mutedText,
        '--dg-body-background': theme.bodyBackground,
        '--dg-header-background': theme.headerBackground,
        '--dg-border': theme.border,
        '--dg-selected-cell': theme.selectedCell,
        '--dg-active-text': theme.activeText,
        '--dg-focus-ring': theme.focusRing,
        '--dg-toolbar-background': theme.toolbarBackground,
        '--dg-panel-background': theme.panelBackground,
        '--dg-panel-background-alt': theme.panelBackgroundAlt,
        '--dg-panel-border': theme.panelBorder,
        '--dg-input-background': theme.inputBackground,
        '--dg-button-background': theme.buttonBackground,
        '--dg-button-hover-background': theme.buttonHoverBackground,
        '--dg-button-text': theme.buttonText,
        '--dg-secondary-button-background': theme.secondaryButtonBackground,
        '--dg-secondary-button-hover-background': theme.secondaryButtonHoverBackground,
        '--dg-modal-overlay': theme.overlayBackground,
        '--dg-menu-background': theme.menuBackground,
        '--dg-menu-border': theme.menuBorder,
        '--dg-menu-text': theme.menuText,
        '--dg-menu-item-hover': theme.menuItemHoverBackground,
        '--dg-menu-separator': theme.menuSeparator,
        '--dg-menu-danger-text': theme.menuDangerText,
        '--dg-menu-danger-hover': theme.menuDangerHoverBackground,
        '--dg-empty-background': theme.emptyStateBackground,
        '--dg-empty-text': theme.emptyStateText,
    };
}
