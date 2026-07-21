<script setup lang="ts" generic="TValue extends string | number, T extends SelectOption<TValue>">
import { useOverlaysState } from '@directives/useOverlaysState';
import Input from '@ui/Input.vue';
import { uniqueId } from '@utils/utils';
import { twMerge } from 'tailwind-merge';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

export type SelectOption<TValue = string | number> = {
    label: string;
    value: TValue;
    appliedText?: string;
    selectionStart?: number;
    selectionEnd?: number;
};
export type _BaseListBoxProps<TValue extends string | number, T extends SelectOption<TValue>> = {
    items: T[];
    invalid?: boolean;
    placeholder?: string;
    loading?: boolean;
    small?: boolean;
    smaller?: boolean;
    class?: string;
    style?: string;
    id?: string;
    inputId?: string;
    inputClass?: string;
    disabled?: boolean;
    emptyMessage?: string;
    clearable?: boolean;
    freeEdit?: boolean;
};

const props = defineProps<
    _BaseListBoxProps<TValue, T> & {
        selection: TValue | undefined | null;
        onSelect: (item: T | undefined | null, q: string) => void;
    }
>();

const sortedItems = computed(() => props.items);

const hoveredId = ref<TValue | null>();

const searchQuery = ref('');
const noInputAfterSelection = ref(true);

function normalizeSearchText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isSubsequenceMatch(query: string, target: string) {
    if (!query) {
        return true;
    }

    let queryIndex = 0;

    for (const char of target) {
        if (char === query[queryIndex]) {
            queryIndex += 1;

            if (queryIndex === query.length) {
                return true;
            }
        }
    }

    return false;
}

function matchesSearch(item: T, rawQuery: string) {
    const normalizedQuery = normalizeSearchText(rawQuery);
    const rawNeedle = rawQuery.toLowerCase();
    const haystacks = [item.label, `${item.value}`];

    return haystacks.some((haystack) => {
        const rawHaystack = haystack.toLowerCase();

        if (rawHaystack.includes(rawNeedle)) {
            return true;
        }

        const normalizedHaystack = normalizeSearchText(haystack);

        return normalizedHaystack.includes(normalizedQuery) || isSubsequenceMatch(normalizedQuery, normalizedHaystack);
    });
}

const filteredItems = computed(() => {
    if (noInputAfterSelection.value || !searchQuery.value) {
        return sortedItems.value;
    }

    return sortedItems.value.filter((item) => matchesSearch(item, searchQuery.value));
});

const finalSearchQuery = computed(() => {
    if (searchQuery.value) {
        return searchQuery.value;
    }
    if (noInputAfterSelection.value) {
        return props.items.find((t) => t.value === props.selection)?.label ?? '';
    }

    return '';
});

watch(
    () => filteredItems.value,
    (nv) => {
        if (nv.length === 0) {
            hoveredId.value = undefined;
        } else if (nv.length === 1 || (hoveredId.value && !nv.find((i) => i.value == hoveredId.value))) {
            hoveredId.value = nv[0].value;
        }
    }
);

function select(item: T, q: string) {
    if (!item) {
        return;
    }

    const appliedText = item.appliedText ?? item.label ?? '';

    searchQuery.value = appliedText;

    if (item.value !== props.selection) {
        props.onSelect(item, q);
    }

    if (refInput.value) {
        noInputAfterSelection.value = true;
        isDropdownOpen.value = false;

        const selectionStart = item.selectionStart;
        const selectionEnd = item.selectionEnd ?? selectionStart;

        void nextTick().then(() => {
            if (!refInput.value) {
                return;
            }

            const nextInputValue = item.appliedText ?? getSelectionTextByValue(item.value) ?? appliedText;
            refInput.value.value = nextInputValue;
            refInput.value.focus();

            if (selectionStart !== undefined) {
                refInput.value.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
            }
        });
    }
}

function commitFreeEdit(rawValue: string) {
    const nextValue = rawValue.trim();

    if (!props.freeEdit) {
        return false;
    }

    props.onSelect(undefined, nextValue);

    noInputAfterSelection.value = true;
    isDropdownOpen.value = false;

    return true;
}

function navigate(e: Event, dir: 'up' | 'down') {
    e.preventDefault();
    e.stopPropagation();

    if (filteredItems.value.length === 0) {
        hoveredId.value = undefined;
        return;
    }

    const activeId = hoveredId.value ?? props.selection;
    let idx = filteredItems.value.findIndex((i) => i.value == activeId);

    if (idx < 0) {
        idx = dir === 'up' ? 0 : -1;
    }

    if (dir === 'up') {
        idx--;
    } else {
        idx++;
    }

    idx = (filteredItems.value.length + idx) % filteredItems.value.length;
    hoveredId.value = filteredItems.value[idx].value;

    scrollToItem(hoveredId.value);
}

function scrollToItem(id?: TValue | null, block?: ScrollLogicalPosition) {
    if (id === undefined || id === null) {
        return;
    }
    const container = document.getElementById(ulId);
    if (!container) {
        return;
    }
    const scrollTo = container.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
    if (scrollTo) {
        scrollTo.scrollIntoView({
            behavior: 'instant',
            block: block ?? 'nearest',
        });
    }
}
const reserveInputId = 'input-' + uniqueId();
const finalInputId = computed(() => props.inputId || reserveInputId);
const ulId = 'ul-' + uniqueId();
const rootRef = ref<HTMLElement>();
const dropdownPanelRef = ref<HTMLElement>();
const refInput = ref<HTMLInputElement>();
const isDropdownOpen = ref(false);
const isSelectingItem = ref(false);
const dropdownStyle = ref<Record<string, string>>({});

function updateDropdownPosition() {
    if (!refInput.value) {
        return;
    }

    const rect = refInput.value.getBoundingClientRect();
    let maxHeight = 300;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (maxHeight + rect.bottom > viewportHeight) {
        maxHeight = viewportHeight - rect.bottom - 5;
    }

    dropdownStyle.value = {
        top: `${rect.bottom + 0}px`,
        left: `${rect.left}px`,
        minWidth: `${rect.width}px`,
        maxHeight: `${maxHeight}px`,
    };
}

function onInput(e: Event) {
    noInputAfterSelection.value = false;
    searchQuery.value = (e.target as HTMLInputElement).value;
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
        closeDropdown();
        return;
    }

    const prevent = ['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key);
    if (!prevent) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (e.key == 'ArrowDown') {
        navigate(e, 'down');
    }
    if (e.key == 'ArrowUp') {
        navigate(e, 'up');
    }
}

function onBlur(e: FocusEvent) {
    const inputValue = (e.target as HTMLInputElement | null)?.value ?? searchQuery.value;
    const touchedInput = !noInputAfterSelection.value;

    if (touchedInput && searchQuery.value.length === 0) {
        props.onSelect(undefined, '');
    } else if (!isSelectingItem.value && !commitFreeEdit(inputValue)) {
        setSelectionFromProps(props.selection);
    }

    closeDropdown();
}

function onKeyup(e: KeyboardEvent) {
    const prevent = ['Escape', 'Enter'].includes(e.key);
    if (!prevent) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.key == 'Enter') {
        if (!isDropdownOpen.value) {
            if (document.activeElement === refInput.value) {
                showDropdown();
            }
            return;
        }

        if (hoveredId.value === undefined || hoveredId.value === null) {
            commitFreeEdit(searchQuery.value);
            return;
        }

        const selectedItem = filteredItems.value.find((i) => i.value == hoveredId.value);
        if (selectedItem) {
            select(selectedItem, searchQuery.value);
        } else {
            commitFreeEdit(searchQuery.value);
        }
        return;
    }

    closeDropdown();
}

function onFocus(e: Event) {
    listWidth.value = refInput.value?.offsetWidth ? refInput.value.offsetWidth + 'px' : 'auto';
    if (e instanceof FocusEvent) {
        setTimeout(() => {
            if (refInput.value) {
                refInput.value.select();
            }
        }, 100);
    }
    showDropdown();
}
function showDropdown() {
    listWidth.value = refInput.value?.offsetWidth ? refInput.value.offsetWidth + 'px' : 'auto';
    updateDropdownPosition();
    isDropdownOpen.value = true;
    setTimeout(() => {
        scrollToItem(props.selection);
    }, 0);
}

function clear() {
    searchQuery.value = '';
    noInputAfterSelection.value = true;
    hoveredId.value = undefined;
    props.onSelect(undefined, '');
    // actualValue.value = '';
    if (refInput.value) {
        refInput.value.value = '';
    }
}

function closeDropdown() {
    isDropdownOpen.value = false;
    if (refInput.value) {
        noInputAfterSelection.value = true;
        if (!props.freeEdit || !searchQuery.value.trim()) {
            setSelectionFromProps(props.selection);
        }
    }
}

function onItemPointerDown(item: T) {
    isSelectingItem.value = true;
    select(item, searchQuery.value);
    queueMicrotask(() => {
        isSelectingItem.value = false;
    });
}

function onDocumentMouseDown(e: MouseEvent) {
    if (!isDropdownOpen.value) {
        return;
    }

    if (isSelectingItem.value) {
        return;
    }

    const target = e.target as Node | null;
    if (!target) {
        return;
    }

    const path = e.composedPath();
    if (path.includes(rootRef.value as EventTarget) || path.includes(dropdownPanelRef.value as EventTarget)) {
        return;
    }

    if (rootRef.value?.contains(target) || dropdownPanelRef.value?.contains(target)) {
        return;
    }

    closeDropdown();
}

function setSelectionFromProps(id: TValue | undefined | null) {
    scrollToItem(id, 'start');
    if (refInput.value) {
        const nextInputValue = id != undefined && id !== null ? getSelectionTextByValue(id) : undefined;
        refInput.value.value = nextInputValue ?? (props.freeEdit && typeof id === 'string' ? id : '');
    }
}

function getSelectionTextByValue(id: TValue) {
    const selectedItem = props.items.find((item) => item.value == id);

    if (!selectedItem) {
        return undefined;
    }

    return selectedItem.appliedText ?? selectedItem.label ?? '';
}
const overlayState = useOverlaysState();

const dropdownZIndex = ref(90);

watch(() => props.selection, setSelectionFromProps);
watch(isDropdownOpen, (nv) => {
    dropdownZIndex.value = nv ? overlayState.claimZIndex() : overlayState.releaseZIndex(dropdownZIndex.value);
});

const listWidth = ref('auto');
onMounted(() => {
    refInput.value = document.getElementById(finalInputId.value) as HTMLInputElement;
    listWidth.value = refInput.value?.offsetWidth ? refInput.value.offsetWidth + 'px' : 'auto';

    setSelectionFromProps(props.selection);

    window.addEventListener('mousedown', onDocumentMouseDown, true);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
});

onUnmounted(() => {
    window.removeEventListener('mousedown', onDocumentMouseDown, true);
    window.removeEventListener('resize', updateDropdownPosition);
    window.removeEventListener('scroll', updateDropdownPosition, true);
});
</script>

<template>
    <div ref="rootRef" :class="twMerge('flex flex-col', props.class)">
        <div :class="twMerge('relative', disabled ? 'pointer-events-none select-none' : '', props.class)" :style="props.style">
            <Input
                type="text"
                :disabled="disabled"
                :id="finalInputId"
                :model-value="finalSearchQuery"
                @update:model-value="(v) => (searchQuery = v ?? '')"
                @input="onInput"
                :placeholder="placeholder ?? 'Search'"
                :aria-label="placeholder ?? 'Search'"
                :small="props.small"
                :smaller="props.smaller"
                :invalid="props.invalid"
                :class="twMerge(clearable ? 'pr-16!' : 'pr-7!', disabled ? 'cursor-not-allowed border-x6 bg-x4' : (inputClass ?? 'w-full'))"
                @keydown="onKeydown"
                @keyup="onKeyup"
                @focus="onFocus"
                @blur="onBlur"
            />
            <i class="icon icon-[mingcute--down-fill] text-lg absolute top-1/2 -translate-y-1/2 right-3 text-gray-400 pointer-events-none select-none"></i>
            <div v-if="loading" class="absolute inset-px flex items-center justify-center bg-x1 dark:bg-x3/70">
                <i class="icon icon-[mingcute--loading-fill] text-2xl animate-spin"></i>
            </div>
            <div
                v-if="clearable"
                @click="clear"
                class="text-lg flex items-center justify-center absolute top-1/2 -translate-y-1/2 right-9 text-gray-400 cursor-pointer transition-colors hover:bg-x6 rounded-md p-1"
            >
                <i class="icon icon-[mdi--close]"></i>
            </div>
        </div>
        <Teleport to="body">
            <div
                v-show="isDropdownOpen"
                ref="dropdownPanelRef"
                class="fixed overflow-y-auto thin-scrollbar rounded-b-md border border-x4 bg-x1 shadow dark:border-x6 dark:bg-x3 dark:shadow-x7"
                :style="{ ...dropdownStyle, zIndex: dropdownZIndex }"
            >
                <div class="h-full flex flex-col rounded overflow-hidden" :id="ulId">
                    <template v-for="item in filteredItems" :key="item.value">
                        <div
                            @pointerdown.prevent.stop="onItemPointerDown(item)"
                            class="py-1.5 px-2 rounded-sm cursor-pointer transition-colors text-xs"
                            :class="{
                                'bg-primary-700/50': item.value === selection,
                                'hover:bg-x6 hover:dark:bg-x7': item.value !== selection,
                                'bg-x6 dark:bg-x7': item.value === hoveredId,
                            }"
                            :data-id="item.value"
                        >
                            {{ item.label }}
                        </div>
                    </template>
                    <div v-if="filteredItems.length == 0">{{ emptyMessage || 'No options available' }}</div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
