<script setup lang="ts">
import type { TDataGridState } from '@datagrid/useDataGrid';
import IconButton from '@ui/IconButton.vue';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
    gridState: TDataGridState;
    title: string;
    isLoading?: boolean;
    showPageNav?: boolean;
    pageRangeStart?: number;
    pageRangeEnd?: number;
    totalRowCount?: number;
    canGoToPreviousPage?: boolean;
    canGoToNextPage?: boolean;
    onGoToPreviousPage?: () => void;
    onGoToNextPage?: () => void;
    pageSizeMenuOptions?: { value: number; label: string; isDefault: boolean }[];
    selectedDataLimit?: number;
    onSelectPageSize?: (limit: number) => void;
    onReload?: () => void;
}>();

const emit = defineEmits<{
    toggleColumn: [columnName: string];
}>();

const columnMenuElement = ref<HTMLElement>();
const columnButtonElement = ref<HTMLElement>();
const isColumnMenuOpen = ref(false);
const pageSizeMenuElement = ref<HTMLElement>();
const pageSizeButtonElement = ref<HTMLElement>();
const isPageSizeMenuOpen = ref(false);

const visibleColumnCount = computed(() => {
    const hidden = new Set(props.gridState.hiddenColumns as string[]);
    return props.gridState.allColumns.filter((c: string) => !hidden.has(c)).length;
});

const totalColumnCount = computed(() => props.gridState.allColumns.length);

function toggleColumnMenu() {
    isColumnMenuOpen.value = !isColumnMenuOpen.value;
}

function closeColumnMenu() {
    isColumnMenuOpen.value = false;
}

function togglePageSizeMenu() {
    isPageSizeMenuOpen.value = !isPageSizeMenuOpen.value;
}

function closePageSizeMenu() {
    isPageSizeMenuOpen.value = false;
}

function handlePointerDown(event: PointerEvent) {
    const target = event.target as Node | null;

    if (!target) {
        return;
    }

    if (columnMenuElement.value?.contains(target) || columnButtonElement.value?.contains(target)) {
        return;
    }

    if (pageSizeMenuElement.value?.contains(target) || pageSizeButtonElement.value?.contains(target)) {
        return;
    }

    closeColumnMenu();
    closePageSizeMenu();
}

watch(isColumnMenuOpen, () => {
    window.removeEventListener('pointerdown', handlePointerDown);

    if (isColumnMenuOpen.value || isPageSizeMenuOpen.value) {
        window.addEventListener('pointerdown', handlePointerDown);
    }
});

watch(isPageSizeMenuOpen, () => {
    window.removeEventListener('pointerdown', handlePointerDown);

    if (isColumnMenuOpen.value || isPageSizeMenuOpen.value) {
        window.addEventListener('pointerdown', handlePointerDown);
    }
});
</script>

<template>
    <div class="flex min-w-0 flex-1 items-center gap-3">
        <!-- Title -->
        <h2 class="shrink-0 text-sm font-semibold text-reverse">
            {{ title }}
            <span class="relative" ref="columnButtonElement">
                <button type="button" class="border border-x7 bg-x2 px-1 rounded-md text-2xs opacity-60 hover:opacity-100 transition" @click="toggleColumnMenu">
                    {{ visibleColumnCount }} of {{ totalColumnCount }} columns
                </button>
                <div v-if="isColumnMenuOpen" ref="columnMenuElement" class="absolute left-0 top-full z-20 mt-1 min-w-40 border border-x4 bg-x1 py-1">
                    <div class="px-3 py-1 text-2xs opacity-60">Visible Columns</div>
                    <label v-for="columnName in gridState.allColumns" :key="columnName" class="flex items-center gap-2 px-3 py-1 text-xs hover:bg-white/8">
                        <input
                            type="checkbox"
                            class="h-3 w-3 rounded border-white/20 bg-transparent accent-white"
                            :checked="!gridState.hiddenColumns.includes(columnName)"
                            @change="emit('toggleColumn', columnName)"
                        />
                        <span class="truncate">{{ columnName }}</span>
                    </label>
                </div>
            </span>
        </h2>

        <!-- Page navigation -->
        <div v-if="showPageNav" class="relative flex items-center text-2xs text-white">
            <IconButton
                icon="icon-[mdi--chevron-left]"
                v-tooltip.xs.nowrap="'Previous page'"
                severity="secondary"
                small
                :disabled="!canGoToPreviousPage"
                @click="onGoToPreviousPage?.()"
                class="rounded-r-none"
            />
            <div class="relative">
                <button
                    ref="pageSizeButtonElement"
                    type="button"
                    class="inline-flex h-7 items-center gap-1 border border-x4 bg-x2 px-2 text-2xs opacity-80 transition hover:bg-x3 hover:opacity-100"
                    :disabled="isLoading"
                    @click="togglePageSizeMenu"
                >
                    <span>{{ pageRangeStart }}-{{ pageRangeEnd }}</span>
                    <span class="opacity-60">of {{ totalRowCount }}</span>
                    <span class="iconify icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-70"></span>
                </button>
                <div v-if="isPageSizeMenuOpen" ref="pageSizeMenuElement" class="absolute left-0 right-0 top-full z-20 border-y border-x4 bg-x1 py-1">
                    <div class="px-3 py-1 text-2xs opacity-60">Page Size</div>
                    <button
                        v-for="option in pageSizeMenuOptions ?? []"
                        :key="option.value"
                        type="button"
                        class="flex w-full items-center justify-between gap-3 px-3.5 py-1 text-left text-xs transition hover:bg-white/8"
                        @click="
                            onSelectPageSize?.(option.value);
                            closePageSizeMenu();
                        "
                    >
                        <span class="inline-flex min-w-0 items-center gap-2">
                            <span>{{ option.label }}</span>
                            <span class="h-4 w-4 text-center text-xs opacity-80">{{ selectedDataLimit === option.value ? '✓' : '' }}</span>
                        </span>
                    </button>
                </div>
            </div>
            <IconButton
                icon="icon-[mdi--chevron-right]"
                v-tooltip.xs.nowrap="'Next page'"
                small
                :disabled="!canGoToNextPage"
                @click="onGoToNextPage?.()"
                class="rounded-l-none"
                severity="secondary"
            />
        </div>

        <!-- Row count info when no page nav -->
        <div v-else class="flex-1">
            <slot />
        </div>

        <!-- Reload button -->
        <IconButton
            v-if="onReload"
            class="ml-auto"
            :icon="isLoading ? 'icon-[mdi--loading] animate-spin' : 'icon-[mdi--reload]'"
            v-tooltip.xs.nowrap="'Reload'"
            smaller
            :disabled="isLoading"
            @click="onReload"
        />
    </div>
</template>
