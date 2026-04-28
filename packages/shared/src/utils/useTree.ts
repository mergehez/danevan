import { computed, reactive } from 'vue';
import { useCache } from '@utils/useCache';

type TId = string;
type TreeNodeBase = {
    id: TId;
    title: string;
    rightText?: string;
    count?: number;
    expandable?: boolean;
    children: TreeNode<any, {}>[];
};
export type TreeNode<TData = {}, TChildData = {}> = Omit<TreeNodeBase, 'children'> &
    TData & {
        children: TreeNode<TChildData, {}>[];
    };

type PersistedCollapseState = {
    collapsed?: boolean;
    groups?: Record<string, boolean>;
};

type Props<TData, TChildData> = {
    item: TreeNode<TData, TChildData>;
    localStorageKey?: string;
    selection?: TId | TId[];
    outlineSelection?: TId | TId[];
    headerOutlined?: boolean;
    emptyText?: string;
    itemClass?: string;
    noActions?: boolean;
    selectGroups?: boolean;
    defaultGroupCollapsed?: boolean;
    leftIcon?: (item: TreeNode<TData, TChildData>) => `icon-\[${string}`;
    rightIcon?: (item: TreeNode<TData, TChildData>) => `icon-\[${string}` | '' | undefined;
    onSelect: (item: TreeNode<TData, TChildData>, event?: MouseEvent) => void;
    onToggleGroup?: (item: TreeNode<TData, TChildData>, expanded: boolean, event?: MouseEvent) => void;
    onContextMenu?: (item: TreeNode<TData, TChildData>, event?: MouseEvent) => void;
    onHeaderContextMenu?: (item: TreeNode<TData, TChildData>, event?: MouseEvent) => void;
};

export function useTree<TData = {}, TChildData = {}>(props: Props<TData, TChildData>) {
    type Item = TreeNode<TData, TChildData>;
    // type Child = TreeNode<TChildData, {}>;

    const item = reactive(props.item);

    const { state: collapseState } = useCache<PersistedCollapseState>({
        key: computed(() => props.localStorageKey),
        initialValue: () => ({
            collapsed: false,
            groups: {},
        }),
    });

    function onHeaderContextMenu(event: MouseEvent) {
        if (!props.onHeaderContextMenu) {
            return;
        }

        event.preventDefault();
        // props.onHeaderContextMenu(item, event);
    }

    function onContextMenu(event: MouseEvent, item: Item) {
        if (!props.onContextMenu) {
            return;
        }
        event.preventDefault();
        props.onContextMenu(item, event);
    }

    function isSelected(entry: Item) {
        return Array.isArray(props.selection) ? props.selection.includes(entry.id) : props.selection === entry.id;
    }

    function isOutlined(entry: Item) {
        return Array.isArray(props.outlineSelection) ? props.outlineSelection.includes(entry.id) : props.outlineSelection === entry.id;
    }

    const collapsed = computed({
        get: () => !!collapseState.value.collapsed,
        set: (value: boolean) => {
            collapseState.value.collapsed = value;
        },
    });

    function hasChildren(entry: TreeNodeBase) {
        return Array.isArray(entry.children) && entry.children.length > 0;
    }

    function collapseKey(entry: TreeNodeBase) {
        return String(entry.id ?? entry.title);
    }

    function isCollapsedGroup(entry: TreeNodeBase) {
        return collapseState.value.groups?.[collapseKey(entry)] ?? !!props.defaultGroupCollapsed;
    }

    function toggleGroup(entry: TreeNodeBase) {
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

    function toggleRoot() {
        collapsed.value = !collapsed.value;
    }

    type FlattenedItem = {
        item: TreeNodeBase;
        depth: number;
        isGroup: boolean;
        isCollapsed: boolean;
    };
    function flattenEntries(entries: TreeNodeBase[], depth = 0): FlattenedItem[] {
        return entries.flatMap((entry) => {
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

            return [currentEntry, ...flattenEntries(entry.children, depth + 1)];
        });
    }

    const visibleChildren = computed(() => flattenEntries(item.children));

    function onEntryClick(event: MouseEvent, entry: Item) {
        if (hasChildren(entry) && !props.selectGroups) {
            const expanded = toggleGroup(entry);
            props.onToggleGroup?.(entry, expanded, event);
            return;
        }

        props.onSelect(entry, event);
    }
    return reactive({
        item,
        collapseState,
        onHeaderContextMenu,
        onContextMenu,
        isSelected,
        isOutlined,
        collapsed,
        hasChildren,
        isCollapsedGroup,
        toggleGroup,
        toggleRoot,
        visibleChildren,
        onEntryClick,
    });
}
