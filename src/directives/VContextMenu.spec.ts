// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { ContextMenu } from './ContextMenu.tsx';
import type { ContextMenuEntry } from './contextMenuTypes';
import { useContextMenu } from './useContextMenu';
import { type ContextMenuBindingValue, type ContextMenuHostElement, vContextMenu } from './VContextMenu';

const mountedWrappers: VueWrapper[] = [];

function items(): ContextMenuEntry[] {
    return [
        { id: 'rename', label: 'Rename' },
        { id: 'delete', label: 'Delete', danger: true },
    ];
}

function mountMenu(bindingExpression: string, initial: ContextMenuBindingValue) {
    const value = ref<ContextMenuBindingValue>(initial);
    const wrapper = mount(
        defineComponent({
            components: { ContextMenu },
            setup: () => {
                const state = useContextMenu();

                return { state, value };
            },
            template: `<div><button class="host" v-menu${bindingExpression}="value">host</button><ContextMenu :state="state" /></div>`,
        }),
        { attachTo: document.body, global: { directives: { menu: vContextMenu } } }
    );

    mountedWrappers.push(wrapper);

    return { wrapper, value, host: wrapper.get('.host').element as ContextMenuHostElement };
}

function menuPanel() {
    return document.querySelector<HTMLElement>('.v-menu-panel');
}

function menuWrapper() {
    return document.querySelector<HTMLElement>('.v-menu-wrapper');
}

// Top-level items of the open panel only: nested submenu panels also contain labels.
function menuLabels() {
    const panel = menuPanel();

    return panel ? Array.from(panel.querySelectorAll<HTMLElement>(':scope > .v-menu-group > .v-menu-item > .v-menu-item-label')).map((label) => label.textContent) : [];
}

function dispatchContextMenu(host: HTMLElement, clientX = 25, clientY = 40) {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY });
    host.dispatchEvent(event);

    return event;
}

function dispatchClick(host: HTMLElement) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    host.dispatchEvent(event);

    return event;
}

function dispatchKeydown(target: EventTarget, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);

    return event;
}

function clickItem(label: string) {
    const panel = menuPanel();
    const button = Array.from(panel?.querySelectorAll<HTMLElement>(':scope > .v-menu-group > button.v-menu-item') ?? []).find((item) => item.textContent === label);

    if (!button) {
        throw new Error(`Menu item "${label}" is not rendered`);
    }

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
    useContextMenu().closeMenu();
});

afterEach(() => {
    while (mountedWrappers.length > 0) {
        mountedWrappers.pop()!.unmount();
    }

    useContextMenu().closeMenu();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('vContextMenu', () => {
    it('opens the bound items at the pointer position on right click and cancels the browser menu', async () => {
        const { host } = mountMenu('', items());

        const event = dispatchContextMenu(host, 25, 40);

        expect(event.defaultPrevented).toBe(true);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);
        await expect.poll(() => menuWrapper()?.style.left).toBe('25px');
        expect(menuWrapper()!.style.top).toBe('40px');
    });

    it('ignores a plain left click without the button modifier', async () => {
        const { host } = mountMenu('', items());

        const event = dispatchClick(host);

        expect(event.defaultPrevented).toBe(false);
        await nextTick();
        expect(menuPanel()).toBeNull();
    });

    it('opens on left click with the button modifier', async () => {
        const { host } = mountMenu('.button', items());

        const event = dispatchClick(host);

        expect(event.defaultPrevented).toBe(true);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);
    });

    it('opens from the ContextMenu key and from Shift+F10 but not from other keys', async () => {
        const { host } = mountMenu('', items());

        const other = dispatchKeydown(host, { key: 'a' });
        expect(other.defaultPrevented).toBe(false);
        await nextTick();
        expect(menuPanel()).toBeNull();

        const menuKey = dispatchKeydown(host, { key: 'ContextMenu' });
        expect(menuKey.defaultPrevented).toBe(true);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);

        dispatchKeydown(window, { key: 'Escape' });
        await expect.poll(menuPanel).toBeNull();

        const shiftF10 = dispatchKeydown(host, { key: 'F10', shiftKey: true });
        expect(shiftF10.defaultPrevented).toBe(true);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);
    });

    it('closes the open menu on Escape and on an outside mousedown', async () => {
        const { host } = mountMenu('', items());

        dispatchContextMenu(host);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);

        dispatchKeydown(window, { key: 'Escape' });
        await expect.poll(menuPanel).toBeNull();

        dispatchContextMenu(host);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);

        document.querySelector<HTMLElement>('.v-menu-root')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await expect.poll(menuPanel).toBeNull();
    });

    it('refreshes the open menu when the bound items change', async () => {
        const { host, value } = mountMenu('', items());

        dispatchContextMenu(host);
        await expect.poll(menuLabels).toEqual(['Rename', 'Delete']);

        value.value = [{ id: 'archive', label: 'Archive' }];
        await nextTick();

        await expect.poll(menuLabels).toEqual(['Archive']);
    });

    it('does not open a disabled menu but still cancels the browser menu', async () => {
        const { host } = mountMenu('', { items: items(), disabled: true });

        const event = dispatchContextMenu(host);

        expect(event.defaultPrevented).toBe(true);
        await nextTick();
        expect(menuPanel()).toBeNull();
    });

    it('does not open an empty item list', async () => {
        const { host } = mountMenu('', []);

        const event = dispatchContextMenu(host);

        expect(event.defaultPrevented).toBe(true);
        await nextTick();
        expect(menuPanel()).toBeNull();
    });

    it('exposes the binding key to the shared menu state', async () => {
        const { host } = mountMenu('', { items: items(), key: 'row-7' });

        dispatchContextMenu(host);

        await expect.poll(() => useContextMenu().isKeyOpen('row-7')).toBe(true);
        expect(useContextMenu().isKeyOpen('row-8')).toBe(false);
    });

    it('focuses the leading focus target by default and the first item with autoFocus', async () => {
        const plain = mountMenu('', items());

        dispatchContextMenu(plain.host);
        await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Context menu');

        dispatchKeydown(window, { key: 'Escape' });
        await expect.poll(menuPanel).toBeNull();

        const autoFocused = mountMenu('', { items: items(), autoFocus: true });

        dispatchContextMenu(autoFocused.host);
        await expect.poll(() => document.activeElement?.textContent).toBe('Rename');
    });

    it('renders titles, separators, checkboxes and submenus', async () => {
        const entries: ContextMenuEntry[] = [
            { type: 'title', id: 'title', title: 'Actions' },
            { type: 'separator', id: 'sep' },
            { type: 'checkbox', id: 'star', label: 'Starred', checked: false },
            { id: 'more', label: 'More', children: [{ id: 'duplicate', label: 'Duplicate' }] },
            { id: 'unavailable', label: 'Unavailable', disabled: true },
        ];

        const { host } = mountMenu('', entries);

        dispatchContextMenu(host);
        await expect.poll(menuLabels).toEqual(['Starred', 'More', 'Unavailable']);

        expect(document.querySelector<HTMLElement>('.v-menu-title')!.textContent).toBe('Actions');
        expect(document.querySelectorAll('.v-menu-separator').length).toBe(1);
        expect(document.querySelector<HTMLElement>('.v-menu-children .v-menu-item-label')!.textContent).toBe('Duplicate');
        expect(document.querySelector<HTMLElement>('button.v-menu-item:disabled')!.textContent).toBe('Unavailable');

        // A submenu parent opens its children instead of running an action or closing.
        clickItem('More');
        expect(menuPanel()).not.toBeNull();
        expect(menuLabels()).toEqual(['Starred', 'More', 'Unavailable']);
    });

    it('toggles a checkbox item without closing, then runs an item action and closes', async () => {
        const toggleStar = vi.fn();
        const rename = vi.fn();
        const entries: ContextMenuEntry[] = [
            { type: 'checkbox', id: 'star', label: 'Starred', checked: false, action: toggleStar },
            { id: 'rename', label: 'Rename', action: rename },
        ];

        const { host } = mountMenu('', entries);

        dispatchContextMenu(host);
        await expect.poll(menuLabels).toEqual(['Starred', 'Rename']);

        clickItem('Starred');
        await expect.poll(() => document.querySelector<HTMLElement>('.v-menu-item-check')?.textContent).toBe('✓');
        expect(toggleStar).toHaveBeenCalledTimes(1);
        expect(menuPanel()).not.toBeNull();

        clickItem('Rename');
        expect(rename).toHaveBeenCalledTimes(1);
        await expect.poll(menuPanel).toBeNull();
    });
});

describe('ContextMenuPanel keyboard navigation', () => {
    it('moves focus through the items with the arrow, Home and End keys', async () => {
        const { host } = mountMenu('', items());

        dispatchContextMenu(host);
        await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Context menu');

        dispatchKeydown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('Rename');

        dispatchKeydown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('Delete');

        dispatchKeydown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('Rename');

        dispatchKeydown(document.activeElement!, { key: 'End' });
        expect(document.activeElement?.textContent).toBe('Delete');

        dispatchKeydown(document.activeElement!, { key: 'ArrowUp' });
        expect(document.activeElement?.textContent).toBe('Rename');

        dispatchKeydown(document.activeElement!, { key: 'Home' });
        expect(document.activeElement?.textContent).toBe('Rename');
    });

    it('enters a submenu with ArrowRight and returns to its trigger with ArrowLeft', async () => {
        const entries: ContextMenuEntry[] = [
            { id: 'more', label: 'More', children: [{ id: 'duplicate', label: 'Duplicate' }] },
            { id: 'rename', label: 'Rename' },
        ];
        const { host } = mountMenu('', entries);

        dispatchContextMenu(host);
        await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Context menu');

        dispatchKeydown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement?.textContent).toBe('More');

        dispatchKeydown(document.activeElement!, { key: 'ArrowRight' });
        await nextTick();
        expect(document.activeElement?.textContent).toBe('Duplicate');

        dispatchKeydown(document.activeElement!, { key: 'ArrowLeft' });
        await nextTick();
        expect(document.activeElement?.textContent).toBe('More');
    });
});

// jsdom has no layout, so the host rect is stubbed to tell the placements apart.
const placementCases: [string, string, string][] = [
    ['', '100px', '86px'],
    ['.bottom', '100px', '86px'],
    ['.top', '100px', '44px'],
    ['.right', '206px', '50px'],
    ['.left', '94px', '50px'],
    ['.end', '200px', '86px'],
    ['.top.end', '200px', '44px'],
];

describe('vContextMenu placement', () => {
    for (const [modifier, expectedLeft, expectedTop] of placementCases) {
        it(`places the menu with the "${modifier || 'default'}" modifier`, async () => {
            const { host } = mountMenu(modifier, items());

            vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
                left: 100,
                top: 50,
                right: 200,
                bottom: 80,
                width: 100,
                height: 30,
                x: 100,
                y: 50,
                toJSON: () => ({}),
            } as DOMRect);

            host.openContextMenu();

            await expect.poll(() => menuWrapper()?.style.left).toBe(expectedLeft);
            expect(menuWrapper()!.style.top).toBe(expectedTop);
        });
    }
});
