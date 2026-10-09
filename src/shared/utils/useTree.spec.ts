import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useTree, type TreeNode } from './useTree';

type Item = TreeNode;

let keyCounter = 0;
function nextKey() {
    keyCounter += 1;
    return `useTree-spec-key-${keyCounter}`;
}

function node(id: string, title: string, children: Item[] = []): Item {
    return { id, title, children };
}

function readCache(key: string) {
    return JSON.parse(localStorage.getItem(key) as string) as {
        collapsed?: boolean;
        groups?: Record<string, boolean>;
    };
}

function createTree(options: {
    item: Item;
    localStorageKey?: string;
    selection?: string | string[];
    outlineSelection?: string | string[];
    selectGroups?: boolean;
    defaultGroupCollapsed?: boolean;
    onSelect?: (item: Item, event?: MouseEvent) => void;
    onToggleGroup?: (item: Item, expanded: boolean, event?: MouseEvent) => void;
    onContextMenu?: (item: Item, event?: MouseEvent) => void;
    onHeaderContextMenu?: (item: Item, event?: MouseEvent) => void;
}) {
    const { localStorageKey, ...rest } = options;
    return useTree<{}, {}>({
        ...rest,
        localStorageKey: localStorageKey ?? nextKey(),
        onSelect: options.onSelect ?? (() => {}),
    });
}

// a (a1, a2) + b
function sampleItem() {
    return node('root', 'Root', [node('a', 'A', [node('a1', 'A1'), node('a2', 'A2')]), node('b', 'B')]);
}

beforeEach(() => {
    localStorage.clear();
});

describe('useTree visible children', () => {
    it('flattens expanded groups with their depth', () => {
        const tree = createTree({ item: sampleItem() });

        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.depth, entry.isGroup, entry.isCollapsed])).toEqual([
            ['a', 0, true, false],
            ['a1', 1, false, false],
            ['a2', 1, false, false],
            ['b', 0, false, false],
        ]);
    });

    it('hides the children of a collapsed group and shows them again after expanding', () => {
        const item = sampleItem();
        const tree = createTree({ item });
        const groupA = item.children[0];

        expect(tree.toggleGroup(groupA)).toBe(false);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
        expect(tree.isCollapsedGroup(groupA)).toBe(true);
        expect(tree.visibleChildren[0].isCollapsed).toBe(true);

        expect(tree.toggleGroup(groupA)).toBe(true);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'a1', 'a2', 'b']);
        expect(tree.visibleChildren[0].isCollapsed).toBe(false);
    });

    it('starts groups collapsed when defaultGroupCollapsed is set', () => {
        const tree = createTree({ item: sampleItem(), defaultGroupCollapsed: true });

        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.isCollapsed])).toEqual([
            ['a', true],
            ['b', false],
        ]);
    });

    it('reports hasChildren for groups only', () => {
        const item = sampleItem();
        const tree = createTree({ item });

        expect(tree.hasChildren(item.children[0])).toBe(true);
        expect(tree.hasChildren(item.children[1])).toBe(false);
        expect(tree.hasChildren(node('empty', 'Empty', []))).toBe(false);
    });

    it('returns false from toggleGroup for a leaf without touching the collapsed groups', () => {
        const item = sampleItem();
        const tree = createTree({ item });

        expect(tree.toggleGroup(item.children[1])).toBe(false);
        expect(tree.collapseState.groups).toEqual({});
    });
});

describe('useTree collapse persistence', () => {
    it('persists a collapsed group under the localStorage key and restores it', async () => {
        const key = nextKey();
        const item = sampleItem();
        const tree = createTree({ item, localStorageKey: key });

        tree.toggleGroup(item.children[0]);
        await nextTick();

        expect(readCache(key)).toEqual({ collapsed: false, groups: { a: true } });

        const reopened = createTree({ item: sampleItem(), localStorageKey: key });

        expect(reopened.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
        expect(reopened.collapsed).toBe(false);
    });

    it('toggles and persists the root collapse', async () => {
        const key = nextKey();
        const tree = createTree({ item: sampleItem(), localStorageKey: key });

        expect(tree.collapsed).toBe(false);
        tree.toggleRoot();
        expect(tree.collapsed).toBe(true);

        await nextTick();
        expect(readCache(key)).toEqual({ collapsed: true, groups: {} });

        tree.toggleRoot();
        expect(tree.collapsed).toBe(false);
        await nextTick();
        expect(readCache(key)).toEqual({ collapsed: false, groups: {} });
    });

    it('rebuilds the collapsed-groups map for an older cache entry that has none', async () => {
        const key = nextKey();
        localStorage.setItem(key, JSON.stringify({ collapsed: true }));
        const item = sampleItem();
        const tree = createTree({ item, localStorageKey: key });

        expect(tree.collapsed).toBe(true);

        tree.toggleGroup(item.children[0]);
        await nextTick();

        expect(readCache(key)).toEqual({ collapsed: true, groups: { a: true } });
    });

    it('falls back to the title as group key when an entry has no id', () => {
        const item = node('root', 'Root', [node('a', 'A', [node('a1', 'A1')])]);
        // Entries coming from native menus may not carry an id at all.
        delete (item.children[0] as { id?: string }).id;
        const tree = createTree({ item });

        tree.toggleGroup(item.children[0]);

        expect(tree.collapseState.groups).toEqual({ A: true });
    });
});

describe('useTree selection', () => {
    it('matches a single selected and outlined id', () => {
        const item = sampleItem();
        const tree = createTree({ item, selection: 'a', outlineSelection: 'b' });

        expect(tree.isSelected(item.children[0])).toBe(true);
        expect(tree.isSelected(item.children[1])).toBe(false);
        expect(tree.isOutlined(item.children[1])).toBe(true);
        expect(tree.isOutlined(item.children[0])).toBe(false);
    });

    it('matches every id of an array selection', () => {
        const item = sampleItem();
        const tree = createTree({ item, selection: ['a', 'b'], outlineSelection: ['a1'] });

        expect([tree.isSelected(item.children[0]), tree.isSelected(item.children[1]), tree.isSelected(item.children[0].children[0])]).toEqual([true, true, false]);
        expect(tree.isOutlined(item.children[0].children[0])).toBe(true);
        expect(tree.isOutlined(item.children[0])).toBe(false);
    });
});

describe('useTree entry clicks', () => {
    it('toggles a group and calls onToggleGroup instead of onSelect', () => {
        const item = sampleItem();
        const onSelect = vi.fn();
        const onToggleGroup = vi.fn();
        const tree = createTree({ item, onSelect, onToggleGroup });
        const event = new MouseEvent('click');

        tree.onEntryClick(event, item.children[0]);

        expect(onSelect).not.toHaveBeenCalled();
        expect(onToggleGroup).toHaveBeenCalledTimes(1);
        expect(onToggleGroup.mock.calls[0][0]).toBe(item.children[0]);
        expect(onToggleGroup.mock.calls[0][1]).toBe(false);
        expect(onToggleGroup.mock.calls[0][2]).toBe(event);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
    });

    it('calls onSelect for a leaf', () => {
        const item = sampleItem();
        const onSelect = vi.fn();
        const onToggleGroup = vi.fn();
        const tree = createTree({ item, onSelect, onToggleGroup });
        const event = new MouseEvent('click');

        tree.onEntryClick(event, item.children[1]);

        expect(onToggleGroup).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toBe(item.children[1]);
        expect(onSelect.mock.calls[0][1]).toBe(event);
    });

    it('selects a group when selectGroups is enabled', () => {
        const item = sampleItem();
        const onSelect = vi.fn();
        const onToggleGroup = vi.fn();
        const tree = createTree({ item, selectGroups: true, onSelect, onToggleGroup });

        tree.onEntryClick(new MouseEvent('click'), item.children[0]);

        expect(onToggleGroup).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toBe(item.children[0]);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'a1', 'a2', 'b']);
    });
});

describe('useTree context menus', () => {
    it('prevents the default menu and forwards the entry that was right-clicked', () => {
        const item = sampleItem();
        const onContextMenu = vi.fn();
        const tree = createTree({ item, onContextMenu });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onContextMenu(event, item.children[1]);

        expect(event.defaultPrevented).toBe(true);
        expect(onContextMenu).toHaveBeenCalledTimes(1);
        expect(onContextMenu.mock.calls[0][0]).toBe(item.children[1]);
        expect(onContextMenu.mock.calls[0][1]).toBe(event);
    });

    it('leaves the event untouched when no context-menu handler is given', () => {
        const item = sampleItem();
        const tree = createTree({ item });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onContextMenu(event, item.children[1]);

        expect(event.defaultPrevented).toBe(false);
    });

    it('prevents the default menu on the header but does not call the unwired header handler', () => {
        const onHeaderContextMenu = vi.fn();
        const tree = createTree({ item: sampleItem(), onHeaderContextMenu });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onHeaderContextMenu(event);

        expect(event.defaultPrevented).toBe(true);
        expect(onHeaderContextMenu).not.toHaveBeenCalled();
    });

    it('leaves the header event untouched when no header handler is given', () => {
        const tree = createTree({ item: sampleItem() });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onHeaderContextMenu(event);

        expect(event.defaultPrevented).toBe(false);
    });
});
