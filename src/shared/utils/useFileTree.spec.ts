import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useFileTree, type FileTreeChild, type FileTreeItem } from './useFileTree';

type ChildData = { tag?: string };
type ChildItem = FileTreeChild<ChildData> & ChildData;
type RootItem = FileTreeItem<ChildData, {}>;

let keyCounter = 0;
function nextKey() {
    keyCounter += 1;
    return `useFileTree-spec-key-${keyCounter}`;
}

function child(id: string, title: string, extra: Partial<ChildItem> = {}): ChildItem {
    return { id, title, children: [], ...extra };
}

function root(title: string, children: ChildItem[]): RootItem {
    return { id: 'root', title, children };
}

function readCache(key: string) {
    return JSON.parse(localStorage.getItem(key) as string) as {
        collapsed?: boolean;
        groups?: Record<string, boolean>;
    };
}

// a (a1, a2, path /dir/a) + b
function sampleRoot() {
    return root('Root', [child('a', 'A', { path: '/dir/a', children: [child('a1', 'A1'), child('a2', 'A2')] }), child('b', 'B', { children: [] })]);
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useFileTree visible children', () => {
    it('flattens expanded children with depth and group flags', () => {
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: nextKey(), onSelect: vi.fn() });

        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.depth, entry.isGroup, entry.isCollapsed])).toEqual([
            ['a', 0, true, false],
            ['a1', 1, false, false],
            ['a2', 1, false, false],
            ['b', 0, false, false],
        ]);
    });

    it('treats expandable entries without loaded children as groups', () => {
        const tree = useFileTree<ChildData>({
            tree: root('Root', [child('lazy', 'Lazy', { expandable: true })]),
            localStorageKey: nextKey(),
            onSelect: vi.fn(),
        });

        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.isGroup, entry.isCollapsed])).toEqual([['lazy', true, false]]);

        expect(tree.toggleGroup(tree.visibleChildren[0].item)).toBe(false);
        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.isCollapsed])).toEqual([['lazy', true]]);

        // An expandable node that has not loaded its children yet has no `children` array at all.
        const withoutChildren: ChildItem = { id: 'unloaded', title: 'Unloaded', expandable: true };
        const unloadedTree = useFileTree<ChildData>({ tree: root('Root', [withoutChildren]), localStorageKey: nextKey(), onSelect: vi.fn() });

        expect(unloadedTree.visibleChildren.map((entry) => [entry.item.id, entry.depth, entry.isGroup])).toEqual([['unloaded', 0, true]]);
    });

    it('collapses and expands a group through toggleGroup', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn() });
        const groupA = tree.visibleChildren[0].item;

        expect(tree.toggleGroup(groupA)).toBe(false);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
        expect(tree.isCollapsedGroup(groupA)).toBe(true);

        expect(tree.toggleGroup(groupA)).toBe(true);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'a1', 'a2', 'b']);
    });

    it('returns false from toggleGroup for a leaf', () => {
        const key = nextKey();
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: key, onSelect: vi.fn() });

        expect(tree.toggleGroup(item.children[1])).toBe(false);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('starts groups collapsed when defaultGroupCollapsed is set', () => {
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: nextKey(), defaultGroupCollapsed: true, onSelect: vi.fn() });

        expect(tree.visibleChildren.map((entry) => [entry.item.id, entry.isCollapsed])).toEqual([
            ['a', true],
            ['b', false],
        ]);
    });

    it('follows a reactive tree getter', () => {
        const source = ref(sampleRoot());
        const tree = useFileTree<ChildData>({ tree: source, localStorageKey: nextKey(), onSelect: vi.fn() });

        expect(tree.item.title).toBe('Root');

        source.value = root('Other', [child('z', 'Z')]);

        expect(tree.item.title).toBe('Other');
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['z']);
    });
});

describe('useFileTree collapse persistence', () => {
    it('persists a collapsed group under the path key and restores it', async () => {
        const key = nextKey();
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: key, onSelect: vi.fn() });

        tree.toggleGroup(tree.visibleChildren[0].item);
        await nextTick();

        // path wins over id, so two same-named tables in different schemas stay apart
        expect(readCache(key)).toEqual({ collapsed: false, groups: { '/dir/a': true } });

        const reopened = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: key, onSelect: vi.fn() });

        expect(reopened.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
    });

    it('rebuilds the collapsed-groups map for an older cache entry that has none', async () => {
        const key = nextKey();
        localStorage.setItem(key, JSON.stringify({ collapsed: true }));
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: key, onSelect: vi.fn() });

        expect(tree.collapsed).toBe(true);

        tree.toggleGroup(item.children[0]);
        await nextTick();

        expect(readCache(key)).toEqual({ collapsed: true, groups: { '/dir/a': true } });
    });

    it('falls back to the title as collapse key when an entry has no path or id', async () => {
        const key = nextKey();
        const nameless: ChildItem = { id: undefined, title: 'No identity', expandable: true, children: [] };
        const tree = useFileTree<ChildData>({ tree: root('Root', [nameless]), localStorageKey: key, onSelect: vi.fn() });

        tree.toggleGroup(nameless);
        await nextTick();

        expect(tree.isCollapsedGroup(nameless)).toBe(true);
        expect(readCache(key).groups).toEqual({ 'No identity': true });
    });

    it('persists the root collapse and restores it', async () => {
        const key = nextKey();
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: key, onSelect: vi.fn() });

        expect(tree.collapsed).toBe(false);
        tree.toggleRoot();
        expect(tree.collapsed).toBe(true);

        await nextTick();
        expect(readCache(key)).toEqual({ collapsed: true, groups: {} });

        const reopened = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: key, onSelect: vi.fn() });

        expect(reopened.collapsed).toBe(true);
    });
});

describe('useFileTree selection', () => {
    it('matches a single selected and outlined id', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), selection: 'a', outlineSelection: 'b', onSelect: vi.fn() });

        expect(tree.isSelected(item.children[0])).toBe(true);
        expect(tree.isSelected(item.children[1])).toBe(false);
        expect(tree.isOutlined(item.children[1])).toBe(true);
        expect(tree.isOutlined(item.children[0])).toBe(false);
    });

    it('matches an array selection and follows the reactive source', () => {
        const selection = ref<string[]>(['b']);
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), selection, outlineSelection: ['a1'], onSelect: vi.fn() });

        expect([tree.isSelected(item.children[0]), tree.isSelected(item.children[1])]).toEqual([false, true]);
        expect(tree.isOutlined(item.children[0]!.children![0]!)).toBe(true);

        selection.value = ['a'];

        expect([tree.isSelected(item.children[0]), tree.isSelected(item.children[1])]).toEqual([true, false]);
    });
});

describe('useFileTree entry clicks', () => {
    it('toggles a group and calls onToggleGroup instead of onSelect', () => {
        const item = sampleRoot();
        const onSelect = vi.fn();
        const onToggleGroup = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect, onToggleGroup });
        const event = new MouseEvent('click');

        tree.onEntryClick(event, item.children[0]);

        expect(onSelect).not.toHaveBeenCalled();
        expect(onToggleGroup).toHaveBeenCalledTimes(1);
        expect(onToggleGroup.mock.calls[0][0]).toBe(item.children[0]);
        expect(onToggleGroup.mock.calls[0][1]).toBe(false);
        expect(onToggleGroup.mock.calls[0][2]).toBe(event);
        expect(tree.visibleChildren.map((entry) => entry.item.id)).toEqual(['a', 'b']);
    });

    it('selects a group when selectGroups is enabled', () => {
        const item = sampleRoot();
        const onSelect = vi.fn();
        const onToggleGroup = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), selectGroups: true, onSelect, onToggleGroup });

        tree.onEntryClick(new MouseEvent('click'), item.children[0]);

        expect(onToggleGroup).not.toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toBe(item.children[0]);
    });

    it('selects a leaf on click', () => {
        const item = sampleRoot();
        const onSelect = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect });
        const event = new MouseEvent('click');

        tree.onEntryClick(event, item.children[1]);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toBe(item.children[1]);
        expect(onSelect.mock.calls[0][1]).toBe(event);
    });

    it('waits for the double click when activateOnDoubleClick claims the entry', () => {
        const item = sampleRoot();
        const onSelect = vi.fn();
        const activateOnDoubleClick = vi.fn(() => true);
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect, activateOnDoubleClick });

        tree.onEntryClick(new MouseEvent('click'), item.children[1]);
        expect(onSelect).not.toHaveBeenCalled();
        expect(activateOnDoubleClick.mock.calls[0]).toEqual([item.children[1], false]);

        tree.onEntryDoubleClick(new MouseEvent('dblclick'), item.children[1]);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toBe(item.children[1]);
    });

    it('ignores a double click when activateOnDoubleClick declines the entry', () => {
        const item = sampleRoot();
        const onSelect = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect, activateOnDoubleClick: () => false });

        tree.onEntryClick(new MouseEvent('click'), item.children[1]);
        expect(onSelect).toHaveBeenCalledTimes(1);

        tree.onEntryDoubleClick(new MouseEvent('dblclick'), item.children[1]);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});

describe('useFileTree header', () => {
    it('ignores a header click until the root has a node id', () => {
        const onHeaderToggle = vi.fn();
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: nextKey(), onSelect: vi.fn(), onHeaderToggle });

        tree.onHeaderClick(new MouseEvent('click'));

        expect(tree.collapsed).toBe(false);
        expect(onHeaderToggle).not.toHaveBeenCalled();
    });

    it('toggles the root and reports the expanded state on each header click', () => {
        const item = sampleRoot();
        const onHeaderToggle = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), headerNodeId: 'root', onSelect: vi.fn(), onHeaderToggle });

        tree.onHeaderClick(new MouseEvent('click'));

        expect(tree.collapsed).toBe(true);
        expect(onHeaderToggle.mock.calls[0][0]).toBe(item);
        expect(onHeaderToggle.mock.calls[0][1]).toBe(false);

        tree.onHeaderClick(new MouseEvent('click'));

        expect(tree.collapsed).toBe(false);
        expect(onHeaderToggle.mock.calls[1][1]).toBe(true);
    });

    it('delays the header toggle when a double click is expected', () => {
        vi.useFakeTimers();
        const onHeaderToggle = vi.fn();
        const tree = useFileTree<ChildData>({
            tree: sampleRoot(),
            localStorageKey: nextKey(),
            headerNodeId: 'root',
            delayHeaderToggleOnDoubleClick: true,
            onSelect: vi.fn(),
            onHeaderToggle,
        });

        tree.onHeaderClick(new MouseEvent('click', { detail: 1 }));

        expect(tree.collapsed).toBe(false);
        expect(onHeaderToggle).not.toHaveBeenCalled();

        vi.advanceTimersByTime(220);

        expect(tree.collapsed).toBe(true);
        expect(onHeaderToggle.mock.calls[0][1]).toBe(false);
    });

    it('cancels a pending header toggle when the double click arrives', () => {
        vi.useFakeTimers();
        const onHeaderDoubleClick = vi.fn();
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({
            tree: item,
            localStorageKey: nextKey(),
            headerNodeId: 'root',
            delayHeaderToggleOnDoubleClick: true,
            onSelect: vi.fn(),
            onHeaderDoubleClick,
        });

        tree.onHeaderClick(new MouseEvent('click', { detail: 1 }));
        tree.onHeaderDoubleClick(new MouseEvent('dblclick', { detail: 2 }));
        vi.advanceTimersByTime(220);

        expect(tree.collapsed).toBe(false);
        expect(onHeaderDoubleClick).toHaveBeenCalledTimes(1);
        expect(onHeaderDoubleClick.mock.calls[0][0]).toBe(item);
    });

    it('toggles straight away for a keyboard-style click with no detail', () => {
        vi.useFakeTimers();
        const tree = useFileTree<ChildData>({
            tree: sampleRoot(),
            localStorageKey: nextKey(),
            headerNodeId: 'root',
            delayHeaderToggleOnDoubleClick: true,
            onSelect: vi.fn(),
        });

        tree.onHeaderClick(new MouseEvent('click'));

        expect(tree.collapsed).toBe(true);
    });

    it('prevents the default header menu and forwards the root', () => {
        const item = sampleRoot();
        const onHeaderContextMenu = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn(), onHeaderContextMenu });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onHeaderContextMenu(event);

        expect(event.defaultPrevented).toBe(true);
        expect(onHeaderContextMenu).toHaveBeenCalledTimes(1);
        expect(onHeaderContextMenu.mock.calls[0][0]).toBe(item);
    });

    it('prevents the default entry menu and forwards the entry', () => {
        const item = sampleRoot();
        const onContextMenu = vi.fn();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn(), onContextMenu });
        const event = new MouseEvent('contextmenu', { cancelable: true });

        tree.onContextMenu(event, item.children[1]);

        expect(event.defaultPrevented).toBe(true);
        expect(onContextMenu.mock.calls[0][0]).toBe(item.children[1]);
        expect(onContextMenu.mock.calls[0][1]).toBe(event);
    });

    it('leaves both menus untouched when no handler is given', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn() });
        const headerEvent = new MouseEvent('contextmenu', { cancelable: true });
        const entryEvent = new MouseEvent('contextmenu', { cancelable: true });

        tree.onHeaderContextMenu(headerEvent);
        tree.onContextMenu(entryEvent, item.children[1]);

        expect([headerEvent.defaultPrevented, entryEvent.defaultPrevented]).toEqual([false, false]);
    });
});

describe('useFileTree rows', () => {
    it('builds the row class from selection, outline and itemClass', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({
            tree: item,
            localStorageKey: nextKey(),
            selection: 'a',
            outlineSelection: ['b'],
            itemClass: 'custom-row',
            onSelect: vi.fn(),
        });

        expect(tree.getRowWrapperClass(item.children[0])).toEqual(['bg-white/10', undefined, 'custom-row']);
        expect(tree.getRowWrapperClass(item.children[1])).toEqual(['hover:bg-white/6', 'outline-1 -outline-offset-1 outline-white/35', 'custom-row']);
        expect(tree.getRowWrapperClass(item.children[0]!.children![0]!)).toEqual(['hover:bg-white/6', undefined, 'custom-row']);
    });

    it('indents each depth by 0.6rem', () => {
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: nextKey(), onSelect: vi.fn() });

        expect([tree.getRowPaddingStyle(0), tree.getRowPaddingStyle(2)]).toEqual([{ paddingLeft: '0rem' }, { paddingLeft: '1.2rem' }]);
    });

    it('focuses the row that was clicked and the row that was double clicked', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn() });
        const row = document.createElement('div');
        row.tabIndex = 0;
        row.addEventListener('click', (event) => tree.onEntryClick(event, item.children[1]));
        row.addEventListener('dblclick', (event) => tree.onEntryDoubleClick(event, item.children[1]));
        document.body.append(row);

        row.click();
        expect(document.activeElement).toBe(row);

        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(document.activeElement).toBe(row);

        row.remove();
    });

    it('focuses the header element that was clicked', () => {
        const tree = useFileTree<ChildData>({ tree: sampleRoot(), localStorageKey: nextKey(), headerNodeId: 'root', onSelect: vi.fn() });
        const header = document.createElement('div');
        header.tabIndex = 0;
        header.addEventListener('click', (event) => tree.onHeaderClick(event));
        document.body.append(header);

        header.click();

        expect(document.activeElement).toBe(header);
        expect(tree.collapsed).toBe(true);

        header.remove();
    });

    it('delegates node and parent ids to the props', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({
            tree: item,
            localStorageKey: nextKey(),
            onSelect: vi.fn(),
            nodeId: (entry, isGroup) => `${isGroup ? 'group' : 'leaf'}:${entry.id}`,
            parentId: (entry) => `parent-of-${entry.id}`,
        });

        expect(tree.getNodeId(item.children[0], true)).toBe('group:a');
        expect(tree.getNodeId(item.children[1], false)).toBe('leaf:b');
        expect(tree.getParentId(item.children[0]!.children![0]!, false)).toBe('parent-of-a1');
    });
});

describe('useFileTree drag and props passthrough', () => {
    it('writes the drag payload and the title on drag start', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({
            tree: item,
            localStorageKey: nextKey(),
            onSelect: vi.fn(),
            getDragData: (entry) => ({ mimeType: 'application/x-danegeh-node', value: `/dir/${entry.id}` }),
        });
        const raw = { dataTransfer: { setData: vi.fn(), effectAllowed: '' }, preventDefault: vi.fn() };

        tree.onDragStart(raw as unknown as DragEvent, item.children[0]);

        expect(raw.dataTransfer.setData.mock.calls).toEqual([
            ['application/x-danegeh-node', '/dir/a'],
            ['text/plain', 'A'],
        ]);
        expect(raw.dataTransfer.effectAllowed).toBe('copy');
        expect(raw.preventDefault).not.toHaveBeenCalled();
    });

    it('cancels a drag start without payload and reports canDragItem', () => {
        const item = sampleRoot();
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn(), canDragItem: (entry) => entry.id === 'a' });
        const raw = { dataTransfer: { setData: vi.fn(), effectAllowed: '' }, preventDefault: vi.fn() };

        tree.onDragStart(raw as unknown as DragEvent, item.children[1]);

        expect(raw.preventDefault).toHaveBeenCalledTimes(1);
        expect(raw.dataTransfer.setData).not.toHaveBeenCalled();
        expect(tree.canDragItem(item.children[0])).toBe(true);
        expect(tree.canDragItem(item.children[1])).toBe(false);

        const withoutDragProps = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn() });

        expect(withoutDragProps.canDragItem(item.children[0])).toBe(false);
    });

    it('exposes props defaults and passthrough values', () => {
        const item = sampleRoot();
        const headerActions = [{ title: 'Refresh', onClick: vi.fn() }];
        const titleActions = [{ title: 'New', onClick: vi.fn() }];
        const tree = useFileTree<ChildData>({ tree: item, localStorageKey: nextKey(), onSelect: vi.fn() });

        expect(tree.emptyText).toBe('No items');
        expect(tree.headerActions).toBeUndefined();

        const withProps = useFileTree<ChildData>({
            tree: item,
            localStorageKey: nextKey(),
            onSelect: vi.fn(),
            emptyText: 'No tables',
            headerActions,
            titleActions,
            headerOutlined: true,
            headerSelected: true,
            headerParentId: 'connection:1',
            headerRowClass: 'header-row',
            headerTitleClass: 'header-title',
            noActions: true,
            noIndentation: true,
            scrollable: true,
            selectGroups: true,
        });

        expect(withProps.emptyText).toBe('No tables');
        expect(withProps.headerActions).toEqual(headerActions);
        expect(withProps.titleActions).toEqual(titleActions);
        expect([withProps.headerParentId, withProps.headerRowClass, withProps.headerTitleClass]).toEqual(['connection:1', 'header-row', 'header-title']);
        expect([withProps.headerOutlined, withProps.headerSelected, withProps.noActions, withProps.noIndentation, withProps.scrollable]).toEqual([true, true, true, true, true]);
        expect(withProps.selectGroups).toBe(true);
    });
});
