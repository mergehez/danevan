import { computed, MaybeRefOrGetter, reactive, toValue } from 'vue';
import { useCache } from './useCache';

export type FileTreeChild<TData = any> = {
    id: any;
    title: string;
    path?: string;
    subtitle?: string;
    rightText?: string;
    tooltip?: string;
    expandable?: boolean;
    children?: (FileTreeChild<TData> & TData)[];
};

export type FileTreeItem<TData = any, TRoot = {}> = {
    id?: any;
    title: string;
    subtitle?: string;
    rightText?: string;
    count?: number;
    children: (FileTreeChild<TData> & TData)[];
} & TRoot;
export type FileTreeAction = {
    title: string;
    icon?: `icon-\[${string}`;
    onClick: (event: MouseEvent) => void;
    disabled?: boolean;
};

type THeader<TData, TRoot> = FileTreeItem<TData, TRoot>;
type TChild<TData> = FileTreeChild<TData> & TData;

type Action = FileTreeAction;

type FileTreeOptions<TData, TRoot, TSelection = any> = {
    tree: MaybeRefOrGetter<THeader<TData, TRoot>>;
    selection?: MaybeRefOrGetter<TSelection | TSelection[]>;
    outlineSelection?: MaybeRefOrGetter<TSelection | TSelection[]>;
    localStorageKey: Readonly<string>;
    emptyText?: Readonly<string>;
    selectGroups?: Readonly<boolean>;

    defaultGroupCollapsed?: Readonly<boolean>;
    onHeaderToggle?: (item: THeader<TData, TRoot>, expanded: boolean, event?: MouseEvent) => void;
    onContextMenu?: (item: TChild<TData>, event?: MouseEvent) => void;
    onHeaderContextMenu?: (item: THeader<TData, TRoot>, event?: MouseEvent) => void;
    onHeaderDoubleClick?: (item: THeader<TData, TRoot>, event?: MouseEvent) => void;

    delayHeaderToggleOnDoubleClick?: Readonly<boolean>;
    headerOutlined?: MaybeRefOrGetter<boolean>;
    headerSelected?: MaybeRefOrGetter<boolean>;
    headerActions?: MaybeRefOrGetter<Action[]>;
    headerNodeId?: MaybeRefOrGetter<string>;
    headerParentId?: MaybeRefOrGetter<string>;
    getActions?: (item: TChild<TData>) => Action[];

    onSelect?: (item: TChild<TData>, event?: MouseEvent) => void;

    itemClass?: MaybeRefOrGetter<string>;
    headerRowClass?: MaybeRefOrGetter<string>;
    headerTitleClass?: MaybeRefOrGetter<string>;
    noActions?: MaybeRefOrGetter<boolean>;
    noIndentation?: MaybeRefOrGetter<boolean>;
    scrollable?: MaybeRefOrGetter<boolean>;
    titleActions?: MaybeRefOrGetter<Action[]>;
    leftIcon?: (item: TChild<TData>, isGroup: boolean) => `icon-\[${string}` | undefined;
    rightIcon?: (item: TChild<TData>, isGroup: boolean) => `icon-\[${string}` | '' | undefined;
    onToggleGroup?: (item: TChild<TData>, expanded: boolean, event?: MouseEvent) => void;
    canDragItem?: (item: TChild<TData>) => boolean;
    getDragData?: (item: TChild<TData>) => { mimeType: string; value: string } | undefined;
    activateOnDoubleClick?: (item: TChild<TData>, isGroup: boolean) => boolean;
    nodeId?: (item: TChild<TData>, isGroup: boolean) => string | undefined;
    parentId?: (item: TChild<TData>, isGroup: boolean) => string | undefined;
    onItemKeydown?: (event: KeyboardEvent) => void;
    onHeaderKeydown?: (event: KeyboardEvent) => void;
};

export function useFileTree<TData, TRoot = {}, TSelection = any>(props: FileTreeOptions<TData, TRoot, TSelection>) {
    type Item = FileTreeChild<TData> & TData;
    type FlattenedItem = {
        item: Item;
        depth: number;
        isGroup: boolean;
        isCollapsed: boolean;
    };

    const tree = computed(() => toValue(props.tree));
    const selection = computed(() => toValue(props.selection));
    const outlineSelection = computed(() => toValue(props.outlineSelection));
    const headerNodeId = computed(() => toValue(props.headerNodeId));
    const itemClass = computed(() => toValue(props.itemClass));

    const { state: collapseState } = useCache({
        key: computed(() => props.localStorageKey),
        initialValue: () => ({
            collapsed: false as boolean | undefined,
            groups: {} as Record<string, boolean> | undefined,
        }),
    });

    const collapsed = computed({
        get: () => !!collapseState.value.collapsed,
        set: (value: boolean) => {
            collapseState.value.collapsed = value;
        },
    });
    let pendingHeaderToggleTimer: number | undefined;

    function hasChildren(entry: Item) {
        return !!entry.expandable || (Array.isArray(entry.children) && entry.children.length > 0);
    }

    function collapseKey(entry: Item) {
        return String(entry.path ?? entry.id ?? entry.title);
    }

    function isCollapsedGroup(entry: Item) {
        return collapseState.value.groups?.[collapseKey(entry)] ?? !!props.defaultGroupCollapsed;
    }

    function toggleGroup(entry: Item) {
        if (!hasChildren(entry)) {
            return false;
        }

        const key = collapseKey(entry);
        const nextCollapsed = !isCollapsedGroup(entry);
        if (!collapseState.value.groups) {
            collapseState.value.groups = {};
        }
        collapseState.value.groups[key] = nextCollapsed;
        return !nextCollapsed;
    }

    function clearPendingHeaderToggle() {
        if (pendingHeaderToggleTimer === undefined) {
            return;
        }

        window.clearTimeout(pendingHeaderToggleTimer);
        pendingHeaderToggleTimer = undefined;
    }

    function toggleRoot(event?: MouseEvent) {
        collapsed.value = !collapsed.value;
        props.onHeaderToggle?.(tree.value, !collapsed.value, event);
    }

    function onHeaderContextMenu(event: MouseEvent) {
        if (!props.onHeaderContextMenu) {
            return;
        }

        event.preventDefault();
        props.onHeaderContextMenu(tree.value, event);
    }
    function onContextMenu(event: MouseEvent, item: Item) {
        if (!props.onContextMenu) {
            return;
        }
        event.preventDefault();
        props.onContextMenu(item, event);
    }

    function focusHeaderTarget(event: MouseEvent) {
        if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true });
        }
    }

    function onHeaderClick(event: MouseEvent) {
        if (!headerNodeId.value) {
            return;
        }

        focusHeaderTarget(event);

        if (!props.delayHeaderToggleOnDoubleClick || event.detail === 0) {
            toggleRoot(event);
            return;
        }

        clearPendingHeaderToggle();
        pendingHeaderToggleTimer = window.setTimeout(() => {
            pendingHeaderToggleTimer = undefined;
            toggleRoot(event);
        }, 220);
    }

    function onHeaderDoubleClick(event: MouseEvent) {
        focusHeaderTarget(event);
        clearPendingHeaderToggle();
        props.onHeaderDoubleClick?.(tree.value, event);
    }

    function isSelected(entry: Item) {
        return Array.isArray(selection.value) ? selection.value.includes(entry.id) : selection.value === entry.id;
    }

    function isOutlined(entry: Item) {
        return Array.isArray(outlineSelection.value) ? outlineSelection.value.includes(entry.id) : outlineSelection.value === entry.id;
    }

    function flattenEntries(entries: Item[] | undefined, depth = 0): FlattenedItem[] {
        return (entries ?? []).flatMap((entry) => {
            const isGroup = hasChildren(entry);
            const isCollapsed = isGroup ? isCollapsedGroup(entry) : false;
            const currentEntry: FlattenedItem = {
                item: entry,
                depth,
                isGroup,
                isCollapsed,
            };

            if (!isGroup || isCollapsed) {
                return [currentEntry];
            }

            return [currentEntry, ...flattenEntries(entry.children as Item[] | undefined, depth + 1)];
        });
    }

    function onEntryClick(event: MouseEvent, entry: Item) {
        if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true });
        }

        if (hasChildren(entry) && !props.selectGroups) {
            const expanded = toggleGroup(entry);
            props.onToggleGroup?.(entry, expanded, event);
            return;
        }

        if (props.activateOnDoubleClick?.(entry, hasChildren(entry))) {
            return;
        }

        props.onSelect?.(entry, event);
    }

    function onEntryDoubleClick(event: MouseEvent, entry: Item) {
        if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true });
        }

        if (!props.activateOnDoubleClick?.(entry, hasChildren(entry))) {
            return;
        }

        props.onSelect?.(entry, event);
    }

    function canDragItem(entry: Item) {
        return props.canDragItem?.(entry) ?? false;
    }

    function onDragStart(event: DragEvent, entry: Item) {
        const dragData = props.getDragData?.(entry);

        if (!dragData || !event.dataTransfer) {
            event.preventDefault();
            return;
        }

        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(dragData.mimeType, dragData.value);
        event.dataTransfer.setData('text/plain', entry.title);
    }

    function getRowWrapperClass(entry: Item) {
        return [isSelected(entry) ? 'bg-white/10' : 'hover:bg-white/6', isOutlined(entry) ? 'outline-1 -outline-offset-1 outline-white/35' : undefined, itemClass.value];
    }

    function getRowPaddingStyle(depth: number) {
        return {
            paddingLeft: `${depth * 0.6}rem`,
        };
    }

    function getNodeId(entry: Item, isGroup: boolean) {
        return props.nodeId?.(entry, isGroup);
    }

    function getParentId(entry: Item, isGroup: boolean) {
        return props.parentId?.(entry, isGroup);
    }

    return reactive({
        collapsed: collapsed,
        visibleChildren: computed(() => flattenEntries(tree.value.children as Item[] | undefined)),
        onHeaderClick: onHeaderClick,
        onHeaderDoubleClick: onHeaderDoubleClick,
        onHeaderContextMenu: onHeaderContextMenu,
        onContextMenu: onContextMenu,
        toggleRoot: toggleRoot,
        isCollapsedGroup: isCollapsedGroup,
        toggleGroup: toggleGroup,
        canDragItem: canDragItem,
        onDragStart: onDragStart,
        onEntryClick: onEntryClick,
        getNodeId: getNodeId,
        getParentId: getParentId,
        getRowPaddingStyle: getRowPaddingStyle,
        getRowWrapperClass: getRowWrapperClass,
        isSelected: isSelected,
        isOutlined: isOutlined,
        onEntryDoubleClick: onEntryDoubleClick,

        // from props but used in the composable
        item: tree,
        headerNodeId: headerNodeId,

        // directly from props
        selectGroups: props.selectGroups,
        emptyText: computed(() => props.emptyText ?? 'No items'),
        headerActions: computed(() => toValue(props.headerActions)),
        headerParentId: computed(() => toValue(props.headerParentId)),
        headerOutlined: computed(() => toValue(props.headerOutlined)),
        headerSelected: computed(() => toValue(props.headerSelected)),
        headerRowClass: computed(() => toValue(props.headerRowClass)),
        headerTitleClass: computed(() => toValue(props.headerTitleClass)),
        noActions: computed(() => toValue(props.noActions)),
        noIndentation: computed(() => toValue(props.noIndentation)),
        scrollable: computed(() => toValue(props.scrollable)),
        titleActions: computed(() => toValue(props.titleActions)),
        onHeaderKeydown: props.onHeaderKeydown,
        onItemKeydown: props.onItemKeydown,
        leftIcon: props.leftIcon,
        rightIcon: props.rightIcon,
    });
}
