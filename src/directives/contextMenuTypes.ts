export type ContextMenuSeparator = {
    type: 'separator';
    id?: string;
};
export type ContextMenuTitle = {
    type: 'title';
    id?: string;
    title: string;
};

export type ContextMenuItem = {
    id: string;
    label: string;
    iconClass?: string;
    checked?: boolean;
    disabled?: boolean;
    danger?: boolean;
    /** Shortcut hint shown on the right (the key handling itself belongs to the caller). */
    shortcut?: string;
    children?: ContextMenuEntry[];
    action?: () => void | Promise<void>;
};
export type ContextMenuCheckbox = Omit<ContextMenuItem, 'type' | 'children' | 'icon'> & {
    type: 'checkbox';
};

export type ContextMenuEntry = ContextMenuSeparator | ContextMenuTitle | ContextMenuItem | ContextMenuCheckbox;
