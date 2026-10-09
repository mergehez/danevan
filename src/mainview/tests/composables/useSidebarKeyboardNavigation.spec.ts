import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sidebarTreeRef } from '../../composables/useServerTree';
import { useSidebarKeyboardNavigation } from '../../composables/useSidebarKeyboardNavigation';

const scrollIntoView = vi.fn();

// jsdom ships neither CSS.escape nor scrollIntoView, both plain browser APIs this module calls.
if (!globalThis.CSS?.escape) {
    (globalThis as { CSS?: object }).CSS = { ...(globalThis as { CSS?: object }).CSS, escape: (value: string) => value };
}
Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;

let handleKeydown: (event: KeyboardEvent) => void;

function makeRow(dataset: Record<string, string> = {}) {
    const row = document.createElement('div');
    row.tabIndex = 0;
    Object.assign(row.dataset, { sidebarRow: 'true', ...dataset });
    row.openContextMenu = vi.fn();
    return row;
}

function press(row: HTMLElement, key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    row.dispatchEvent(event);
    return event;
}

function mount(rows: HTMLElement[], extra: HTMLElement[] = []) {
    const container = document.createElement('div');
    container.append(...rows, ...extra);
    document.body.append(container);
    sidebarTreeRef.value = container;
    for (const row of rows) {
        row.addEventListener('keydown', handleKeydown);
    }
    return rows;
}

function makeToggleButton(nodeId: string) {
    const button = document.createElement('button');
    button.dataset.sidebarToggleFor = nodeId;
    return button;
}

beforeEach(() => {
    document.body.innerHTML = '';
    scrollIntoView.mockClear();
    handleKeydown = useSidebarKeyboardNavigation().handleSidebarRowKeydown;
});

afterEach(() => {
    sidebarTreeRef.value = undefined;
    document.body.innerHTML = '';
});

describe('useSidebarKeyboardNavigation arrow keys', () => {
    it('moves focus down and up the visible rows and marks the key handled', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' }), makeRow({ nodeId: 'c' })]);
        rows[0].focus();

        const down = press(rows[0], 'ArrowDown');

        expect(document.activeElement).toBe(rows[1]);
        expect(down.defaultPrevented).toBe(true);

        const up = press(rows[1], 'ArrowUp');

        expect(document.activeElement).toBe(rows[0]);
        expect(up.defaultPrevented).toBe(true);
        expect(scrollIntoView.mock.calls).toEqual([[{ behavior: 'smooth', block: 'nearest' }], [{ behavior: 'smooth', block: 'nearest' }]]);
    });

    it('stays put at the first and last row', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);

        rows[0].focus();
        expect(press(rows[0], 'ArrowUp').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(rows[0]);

        rows[1].focus();
        expect(press(rows[1], 'ArrowDown').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(rows[1]);
    });

    it('ignores keys it does not handle', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);
        rows[0].focus();

        const escape = press(rows[0], 'Escape');
        const tab = press(rows[0], 'Tab');

        expect([escape.defaultPrevented, tab.defaultPrevented]).toEqual([false, false]);
        expect(document.activeElement).toBe(rows[0]);
    });

    it('ignores keys while the sidebar tree is not mounted', () => {
        const row = makeRow({ nodeId: 'a' });
        document.body.append(row);
        row.addEventListener('keydown', handleKeydown);
        row.focus();

        const down = press(row, 'ArrowDown');
        const right = press(row, 'ArrowRight');

        expect([down.defaultPrevented, right.defaultPrevented]).toEqual([false, false]);
        expect(document.activeElement).toBe(row);
    });

    it('ignores a row that is not part of the sidebar tree', () => {
        mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);
        const stray = makeRow({ nodeId: 'stray' });
        document.body.append(stray);
        stray.addEventListener('keydown', handleKeydown);
        stray.focus();

        const down = press(stray, 'ArrowDown');

        expect(down.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(stray);
    });
});

describe('useSidebarKeyboardNavigation ArrowLeft', () => {
    it('collapses an expanded row by clicking its toggle button', () => {
        const rows = mount([makeRow({ nodeId: 'a', sidebarExpandable: 'true', sidebarCollapsed: 'false' }), makeRow({ nodeId: 'a1', parentId: 'a' })]);
        const toggle = makeToggleButton('a');
        const onToggle = vi.fn();
        toggle.addEventListener('click', onToggle);
        sidebarTreeRef.value?.append(toggle);
        rows[0].focus();

        const event = press(rows[0], 'ArrowLeft');

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(rows[0]);
    });

    it('prefers the toggle button over the row self toggle', () => {
        const selfToggle = vi.fn();
        const row = makeRow({ nodeId: 'a', sidebarExpandable: 'true', sidebarCollapsed: 'false', sidebarSelfToggle: 'true' });
        row.addEventListener('click', selfToggle);
        const toggle = makeToggleButton('a');
        const onToggle = vi.fn();
        toggle.addEventListener('click', onToggle);
        mount([row], [toggle]);

        press(row, 'ArrowLeft');

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(selfToggle).not.toHaveBeenCalled();
    });

    it('falls back to clicking the row itself when no toggle button exists', () => {
        const onClick = vi.fn();
        const row = makeRow({ nodeId: 'a', sidebarExpandable: 'true', sidebarCollapsed: 'false', sidebarSelfToggle: 'true' });
        row.addEventListener('click', onClick);
        mount([row]);
        row.focus();

        press(row, 'ArrowLeft');

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(row);
    });

    it('moves focus to the parent row of a collapsed row', () => {
        const rows = mount([makeRow({ nodeId: 'p' }), makeRow({ nodeId: 'c', parentId: 'p', sidebarExpandable: 'true', sidebarCollapsed: 'true' })]);
        rows[1].focus();

        const event = press(rows[1], 'ArrowLeft');

        expect(document.activeElement).toBe(rows[0]);
        expect(event.defaultPrevented).toBe(true);
    });

    it('moves focus to the parent row of a leaf', () => {
        const rows = mount([makeRow({ nodeId: 'p' }), makeRow({ nodeId: 'c', parentId: 'p' })]);
        rows[1].focus();

        press(rows[1], 'ArrowLeft');

        expect(document.activeElement).toBe(rows[0]);
    });

    it('does nothing for a top-level leaf', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);
        rows[0].focus();

        const event = press(rows[0], 'ArrowLeft');

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(rows[0]);
    });
});

describe('useSidebarKeyboardNavigation ArrowRight', () => {
    it('expands a collapsed row by clicking its toggle button', () => {
        const row = makeRow({ nodeId: 'a', sidebarExpandable: 'true', sidebarCollapsed: 'true' });
        const toggle = makeToggleButton('a');
        const onToggle = vi.fn();
        toggle.addEventListener('click', onToggle);
        mount([row], [toggle]);

        const event = press(row, 'ArrowRight');

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('moves focus to the first child of an expanded row', () => {
        const rows = mount([
            makeRow({ nodeId: 'a', sidebarExpandable: 'true', sidebarCollapsed: 'false' }),
            makeRow({ nodeId: 'a1', parentId: 'a' }),
            makeRow({ nodeId: 'a2', parentId: 'a' }),
            makeRow({ nodeId: 'b' }),
        ]);
        rows[0].focus();

        const event = press(rows[0], 'ArrowRight');

        expect(document.activeElement).toBe(rows[1]);
        expect(event.defaultPrevented).toBe(true);
    });

    it('moves focus to the child of a leaf row', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'a1', parentId: 'a' })]);
        rows[0].focus();

        press(rows[0], 'ArrowRight');

        expect(document.activeElement).toBe(rows[1]);
    });

    it('keeps focus when the row has no child', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);
        rows[0].focus();

        const event = press(rows[0], 'ArrowRight');

        expect(document.activeElement).toBe(rows[0]);
        expect(event.defaultPrevented).toBe(true);
    });

    it('keeps focus when a collapsed row has no toggle to click', () => {
        const row = makeRow({ sidebarExpandable: 'true', sidebarCollapsed: 'true' });
        mount([row]);
        row.focus();

        const event = press(row, 'ArrowRight');

        expect(document.activeElement).toBe(row);
        expect(event.defaultPrevented).toBe(true);
    });

    it('keeps focus on an expanded row that has no node id', () => {
        const row = makeRow({ sidebarExpandable: 'true', sidebarCollapsed: 'false' });
        mount([row]);
        row.focus();

        const event = press(row, 'ArrowRight');

        expect(document.activeElement).toBe(row);
        expect(event.defaultPrevented).toBe(true);
    });
});

describe('useSidebarKeyboardNavigation activation keys', () => {
    it('clicks the row on Space', () => {
        const onClick = vi.fn();
        const row = makeRow({ nodeId: 'a' });
        row.addEventListener('click', onClick);
        mount([row]);

        const event = press(row, ' ');

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('dispatches a double click on Enter', () => {
        const onDoubleClick = vi.fn();
        const row = makeRow({ nodeId: 'a' });
        row.addEventListener('dblclick', onDoubleClick);
        mount([row]);

        const event = press(row, 'Enter');

        expect(onDoubleClick).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('opens the context menu on meta+Enter without moving focus', () => {
        const rows = mount([makeRow({ nodeId: 'a' }), makeRow({ nodeId: 'b' })]);
        rows[0].focus();

        const event = press(rows[0], 'Enter', { metaKey: true });

        expect(rows[0].openContextMenu).toHaveBeenCalledTimes(1);
        expect(rows[0].openContextMenu).toHaveBeenCalledWith({ autoFocus: true });
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(rows[0]);
        expect(rows[1].openContextMenu).not.toHaveBeenCalled();
    });

    it('does not open the context menu for a plain Enter', () => {
        const row = makeRow({ nodeId: 'a' });
        mount([row]);

        press(row, 'Enter');

        expect(row.openContextMenu).not.toHaveBeenCalled();
    });
});
