<script setup lang="ts" generic="TData, TRoot = {}">
import { useFileTree } from '@shared/utils/useFileTree';
import Button from '@ui/Button.vue';
import Icon from '@ui/Icon.vue';
import IconButton from '@ui/IconButton.vue';
import { twMerge } from 'tailwind-merge';
import { computed } from 'vue';

const p = defineProps<{
    state: ReturnType<typeof useFileTree<TData, TRoot>>;
}>();

const s = computed(() => p.state);
</script>

<template>
    <section class="min-h-0 min-w-0 w-full" :class="s.scrollable ? 'overflow-auto' : ''">
        <div v-if="s.item.title">
            <slot
                v-if="$slots.header"
                name="header"
                :item="s.item"
                :isCollapsed="s.collapsed"
                :selected="s.headerSelected"
                :rowClass="[
                    s.headerSelected ? 'bg-white/10' : undefined,
                    s.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined,
                    s.headerRowClass,
                ]"
                :nodeId="s.headerNodeId"
                :parentId="s.headerParentId"
                :onClick="s.onHeaderClick"
                :onDoubleClick="s.onHeaderDoubleClick"
                :onContextMenu="s.onHeaderContextMenu"
                :onKeydown="(event: KeyboardEvent) => s.onHeaderKeydown?.(event)"
            />
            <div
                v-else
                class="flex items-center justify-between px-1 py-1 text-xs font-semibold tracking-[0.02em] text-default"
                :class="[s.headerSelected ? 'bg-white/10' : undefined, s.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined, s.headerRowClass]"
                :tabindex="s.headerNodeId ? 0 : undefined"
                :data-sidebar-row="s.headerNodeId ? 'true' : undefined"
                :data-node-id="s.headerNodeId"
                :data-parent-id="s.headerParentId"
                :data-sidebar-expandable="s.headerNodeId ? 'true' : undefined"
                :data-sidebar-collapsed="s.headerNodeId ? String(s.collapsed) : undefined"
                :data-sidebar-self-toggle="s.headerNodeId ? 'true' : undefined"
                @click="s.onHeaderClick"
                @dblclick="s.onHeaderDoubleClick"
                @contextmenu="s.onHeaderContextMenu"
                @keydown="s.onHeaderKeydown?.($event)"
            >
                <div class="flex items-center uppercase gap-1 flex-1">
                    <IconButton
                        severity="raised"
                        v-tooltip.xs.nowrap="s.collapsed ? 'Expand group' : 'Collapse group'"
                        smaller
                        @click.stop="s.onHeaderClick"
                        class="opacity-70"
                        :icon="s.collapsed ? 'icon-[mdi--plus]' : 'icon-[mdi--minus]'"
                    />
                    <p class="cursor-pointer select-none" :class="s.headerTitleClass" @click.stop="s.onHeaderClick">
                        {{ s.item.title }}
                    </p>
                    <template v-if="s.titleActions">
                        <Button
                            v-for="action in s.titleActions"
                            :key="action.title"
                            :severity="action.icon ? 'raised' : 'secondary'"
                            :disabled="action.disabled"
                            class="text-2xs"
                            :class="action.icon ? 'p-0.5' : 'px-1 py-0.5'"
                            smaller
                            @click.stop="action.onClick"
                        >
                            <Icon v-if="action.icon" :icon="action.icon" />
                            <span v-else class="text-2xs">{{ action.title }}</span>
                        </Button>
                    </template>
                </div>
                <div class="flex items-center gap-1">
                    <template v-if="s.headerActions">
                        <Button
                            v-for="action in s.headerActions"
                            :key="action.title"
                            :severity="action.icon ? 'raised' : 'secondary'"
                            :disabled="action.disabled"
                            class="text-2xs"
                            :class="action.icon ? 'p-0.5' : 'px-1 py-0.5'"
                            smaller
                            @click.stop="action.onClick"
                            v-tooltip.xs.nowrap="action.icon ? action.title : undefined"
                        >
                            <Icon v-if="action.icon" :icon="action.icon" />
                            <span v-else class="text-2xs">{{ action.title }}</span>
                        </Button>
                    </template>

                    <span class="bg-white/8 px-1.5 py-px select-none">{{ s.item.count ?? s.item.children.length ?? '' }}</span>
                </div>
            </div>
        </div>

        <div v-if="!s.item.children.length" class="px-5 py-2 text-xs opacity-50">
            {{ s.emptyText }}
        </div>

        <div v-else-if="!s.collapsed" :class="s.scrollable ? 'overflow-auto' : ''">
            <template v-for="entryState in s.visibleChildren" :key="`${entryState.item.id}`">
                <div v-if="$slots.default" class="group relative min-w-0 w-full transition" :style="s.noIndentation ? undefined : s.getRowPaddingStyle(entryState.depth + 1)">
                    <slot
                        name="default"
                        :item="entryState.item"
                        :depth="entryState.depth"
                        :isGroup="entryState.isGroup"
                        :isCollapsed="entryState.isCollapsed"
                        :selected="s.isSelected(entryState.item)"
                        :outlined="s.isOutlined(entryState.item)"
                        :rowClass="s.getRowWrapperClass(entryState.item)"
                        :canDrag="s.canDragItem(entryState.item)"
                        :rowPaddingStyle="s.noIndentation ? undefined : s.getRowPaddingStyle(entryState.depth)"
                        :nodeId="s.getNodeId(entryState.item, entryState.isGroup)"
                        :parentId="s.getParentId(entryState.item, entryState.isGroup)"
                        :onClick="(event: MouseEvent) => s.onEntryClick(event, entryState.item)"
                        :onContextMenu="(event: MouseEvent) => s.onContextMenu(event, entryState.item)"
                        :onDragStart="(event: DragEvent) => s.onDragStart(event, entryState.item)"
                        :onKeydown="(event: KeyboardEvent) => s.onItemKeydown?.(event)"
                    ></slot>
                </div>
                <div v-else class="group relative flex min-h-5 min-w-0 w-full items-center gap-1 px-2 text-left transition" :class="s.getRowWrapperClass(entryState.item)">
                    <button
                        type="button"
                        :data-testid="`file-tree-item-${entryState.item.id}`"
                        :aria-label="entryState.item.title"
                        :aria-expanded="entryState.isGroup ? !entryState.isCollapsed : undefined"
                        :draggable="s.canDragItem(entryState.item)"
                        class="flex min-w-0 w-full flex-1 items-center gap-1.5 text-left overflow-hidden focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/50 focus-visible:bg-white/10"
                        data-sidebar-row="true"
                        :data-node-id="s.getNodeId(entryState.item, entryState.isGroup)"
                        :data-parent-id="s.getParentId(entryState.item, entryState.isGroup)"
                        :data-sidebar-expandable="String(entryState.isGroup)"
                        :data-sidebar-collapsed="entryState.isGroup ? String(entryState.isCollapsed) : undefined"
                        :data-sidebar-self-toggle="entryState.isGroup && !s.selectGroups ? 'true' : undefined"
                        :style="s.noIndentation ? undefined : s.getRowPaddingStyle(entryState.depth)"
                        @click="(event) => s.onEntryClick(event as MouseEvent, entryState.item)"
                        @dblclick="(event) => s.onEntryDoubleClick(event as MouseEvent, entryState.item)"
                        @contextmenu="(e) => s.onContextMenu(e, entryState.item)"
                        @dragstart="(event) => s.onDragStart(event, entryState.item)"
                        @keydown="s.onItemKeydown?.($event)"
                    >
                        <span
                            v-if="entryState.isGroup"
                            class="icon shrink-0 text-sm opacity-60"
                            :class="entryState.isCollapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]'"
                        ></span>
                        <span v-else class="block w-3 shrink-0"></span>
                        <slot name="item-leftIcon" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
                            <span
                                v-if="s.leftIcon && s.leftIcon(entryState.item, entryState.isGroup)"
                                :class="twMerge('icon text-sm', s.leftIcon(entryState.item, entryState.isGroup))"
                            ></span>
                        </slot>
                        <div class="flex min-w-0 flex-1 items-center py-px text-xs select-none">
                            <slot name="item-title" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
                                <p class="truncate text-xs leading-tight tracking-tight">
                                    {{ entryState.item.title }}
                                </p>
                            </slot>
                        </div>
                        <p v-if="entryState.item.rightText" class="hidden min-w-0 flex-1 truncate pl-2 text-right text-2xs opacity-70 xl:block select-none">
                            {{ entryState.item.rightText }}
                        </p>
                    </button>
                    <div class="flex shrink-0 items-center gap-1">
                        <slot name="item-rightIcon" :item="entryState.item" :depth="entryState.depth" :is-group="entryState.isGroup" :is-collapsed="entryState.isCollapsed">
                            <span
                                v-if="s.rightIcon && s.rightIcon(entryState.item, entryState.isGroup)"
                                :class="twMerge('icon text-sm', s.rightIcon(entryState.item, entryState.isGroup))"
                            ></span>
                        </slot>
                    </div>
                </div>
            </template>
        </div>
    </section>
</template>
