<script setup lang="ts">
import type { ContextMenuCheckbox, ContextMenuEntry, ContextMenuItem, ContextMenuSeparator, ContextMenuTitle } from './contextMenuTypes';

const props = defineProps<{
    items: ContextMenuEntry[];
    leadingFocusTarget?: boolean;
    zIndex?: number;
    onClose?: () => void;
}>();

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
    return 'type' in entry && entry.type === 'separator';
}

function isTitle(entry: ContextMenuEntry): entry is ContextMenuTitle {
    return 'type' in entry && entry.type === 'title';
}

function isCheckbox(entry: ContextMenuEntry): entry is ContextMenuCheckbox {
    return 'type' in entry && entry.type === 'checkbox';
}

function hasChildren(entry: ContextMenuEntry): entry is ContextMenuItem {
    return !isSeparator(entry) && !isTitle(entry) && !isCheckbox(entry) && Array.isArray(entry.children) && entry.children.length > 0;
}

function entryKey(entry: ContextMenuEntry) {
    return isSeparator(entry) ? (entry.id ?? 'separator') : entry.id;
}

function childEntries(entry: ContextMenuItem) {
    return entry.children ?? [];
}

function getPanel(element: EventTarget | null) {
    return element instanceof HTMLElement ? (element.closest('.v-menu-panel') as HTMLElement | null) : null;
}

function getFocusableItems(panel: HTMLElement | null) {
    if (!panel) {
        return [];
    }

    return Array.from(panel.querySelectorAll<HTMLElement>(':scope > .v-menu-group > button.v-menu-item:not(:disabled)'));
}

function focusFirstItem(panel: HTMLElement | null) {
    getFocusableItems(panel)[0]?.focus();
}

function focusLastItem(panel: HTMLElement | null) {
    const items = getFocusableItems(panel);
    items.at(-1)?.focus();
}

function focusRelativeItem(panel: HTMLElement | null, currentItem: HTMLElement, offset: number) {
    const items = getFocusableItems(panel);
    const currentIndex = items.findIndex((item) => item === currentItem);

    if (currentIndex < 0) {
        return;
    }

    const nextIndex = (currentIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
}

function updateChildPanelPosition(currentItem: HTMLElement) {
    const group = currentItem.closest('.v-menu-group') as HTMLElement | null;
    const childContainer = group?.querySelector<HTMLElement>(':scope > .v-menu-children');
    const childPanel = childContainer?.querySelector<HTMLElement>(':scope > .v-menu-panel');

    if (!group || !childContainer || !childPanel) {
        return;
    }

    const viewportMargin = 8;
    const submenuGap = 4;
    const triggerRect = currentItem.getBoundingClientRect();
    const groupRect = group.getBoundingClientRect();
    const childRect = childPanel.getBoundingClientRect();
    const canOpenRight = triggerRect.right + submenuGap + childRect.width <= window.innerWidth - viewportMargin;
    const canOpenLeft = triggerRect.left - submenuGap - childRect.width >= viewportMargin;
    const shouldOpenRight = canOpenRight || !canOpenLeft;

    let topOffset = 0;
    const maxTop = window.innerHeight - viewportMargin - childRect.height;
    const desiredTop = groupRect.top;

    if (desiredTop > maxTop) {
        topOffset = maxTop - groupRect.top;
    }

    if (groupRect.top + topOffset < viewportMargin) {
        topOffset = viewportMargin - groupRect.top;
    }

    childContainer.style.left = shouldOpenRight ? '100%' : 'auto';
    childContainer.style.right = shouldOpenRight ? 'auto' : '100%';
    childContainer.style.top = `${topOffset}px`;
    childContainer.style.paddingLeft = shouldOpenRight ? `${submenuGap}px` : '0px';
    childContainer.style.paddingRight = shouldOpenRight ? '0px' : `${submenuGap}px`;
}

function focusChildPanelFirstItem(currentItem: HTMLElement) {
    updateChildPanelPosition(currentItem);
    const childPanel = currentItem.closest('.v-menu-group')?.querySelector<HTMLElement>('.v-menu-panel');

    if (!childPanel) {
        return;
    }

    focusFirstItem(childPanel);
}

function focusParentTrigger(panel: HTMLElement | null) {
    const parentTrigger = panel?.parentElement?.closest('.v-menu-group')?.querySelector<HTMLElement>('button.v-menu-item');

    parentTrigger?.focus();
}

function onLeadingFocusKeydown(event: KeyboardEvent) {
    const panel = getPanel(event.currentTarget);

    if (event.key === 'ArrowDown' || event.key === 'Home') {
        event.preventDefault();
        focusFirstItem(panel);
        return;
    }

    if (event.key === 'ArrowUp' || event.key === 'End') {
        event.preventDefault();
        focusLastItem(panel);
    }
}

function onItemKeydown(event: KeyboardEvent, entry: ContextMenuEntry) {
    if (!(event.currentTarget instanceof HTMLElement)) {
        return;
    }

    const currentItem = event.currentTarget;
    const panel = getPanel(currentItem);

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusRelativeItem(panel, currentItem, 1);
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusRelativeItem(panel, currentItem, -1);
        return;
    }

    if (event.key === 'Home') {
        event.preventDefault();
        focusFirstItem(panel);
        return;
    }

    if (event.key === 'End') {
        event.preventDefault();
        focusLastItem(panel);
        return;
    }

    if (event.key === 'ArrowRight' && hasChildren(entry)) {
        event.preventDefault();
        focusChildPanelFirstItem(currentItem);
        return;
    }

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusParentTrigger(panel);
    }
}

async function onSelect(entry: ContextMenuEntry) {
    if (isSeparator(entry) || isTitle(entry)) {
        return;
    }

    if (isCheckbox(entry)) {
        entry.checked = !entry.checked;
        await entry.action?.();
        return;
    }

    const item = entry;
    if (item.disabled || hasChildren(item)) {
        return;
    }

    props.onClose?.();
    await entry.action?.();
}

const hasAnyIcon = props.items.some((entry) => !isSeparator(entry) && !isTitle(entry) && (isCheckbox(entry) || entry.iconClass || entry.checked));
</script>

<template>
    <div class="v-menu-panel">
        <button v-if="props.leadingFocusTarget" type="button" class="v-menu-leading-focus" aria-label="Context menu" @keydown="onLeadingFocusKeydown" />
        <template v-for="entry in props.items" :key="entryKey(entry)">
            <div v-if="isSeparator(entry)" class="v-menu-separator"></div>
            <div v-else-if="isTitle(entry)" class="v-menu-title">
                {{ entry.title }}
            </div>
            <div v-else class="v-menu-group">
                <button
                    type="button"
                    class="v-menu-item"
                    :class="{
                        'v-menu-item--danger': entry.danger,
                        'v-menu-item--has-icon': hasAnyIcon,
                        'v-menu-item--no-icon': !hasAnyIcon,
                    }"
                    role="menuitem"
                    :disabled="entry.disabled"
                    :style="{
                        cursor: entry.disabled ? 'not-allowed' : 'pointer',
                        color: entry.danger ? 'var(--v-menu-text-danger)' : 'var(--v-menu-text)',
                        opacity: entry.disabled ? 0.4 : 1,
                    }"
                    @click.stop="onSelect(entry)"
                    @keydown="onItemKeydown($event, entry)"
                    @mouseenter="hasChildren(entry) ? updateChildPanelPosition($event.currentTarget as HTMLElement) : undefined"
                    @focus="hasChildren(entry) ? updateChildPanelPosition($event.currentTarget as HTMLElement) : undefined"
                >
                    <span v-if="hasAnyIcon" class="v-menu-item-icon">
                        <span v-if="!isCheckbox(entry) && entry.iconClass" :class="`${entry.iconClass} v-arg-icon`"></span>
                        <span v-else-if="entry.checked" class="v-menu-item-check">✓</span>
                    </span>
                    <span class="v-menu-item-label">
                        {{ entry.label }}
                    </span>
                    <span v-if="hasChildren(entry)" class="v-arg-icon v-menu-item-chevron"></span>
                </button>

                <div v-if="hasChildren(entry)" class="v-menu-children" :style="{ zIndex: props.zIndex }">
                    <ContextMenuPanel :items="childEntries(entry)" :on-close="props.onClose" :z-index="props.zIndex" />
                </div>
            </div>
        </template>
    </div>
</template>
