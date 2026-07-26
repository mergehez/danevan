<script setup lang="ts">
import Popover from './Popover.vue';

const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{
    title?: string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    compactHeader?: boolean;
    localStorageKey?: string;
    modalMarginToScreenEdges?: number;
    contentClass?: string;
}>();
</script>

<template>
    <Popover
        :open="open"
        center
        backdrop
        header-data-testid="centered-modal-header"
        data-testid="centered-modal-surface"
        :title="props.title"
        :surface-class="props.contentClass"
        :compact-header="props.compactHeader"
        :local-storage-key="props.localStorageKey"
        :min-width="props.minWidth"
        :max-width="props.maxWidth"
        :min-height="props.minHeight"
        :max-height="props.maxHeight"
        :modal-margin-to-screen-edges="props.modalMarginToScreenEdges"
        :show-header="true"
        :resizable="true"
        :closable="true"
        :on-update-open="(nextOpen) => (open = nextOpen)"
    >
        <template #title>
            <slot name="title">
                <span class="font-semibold text-default">{{ props.title }}</span>
            </slot>
        </template>

        <slot />
    </Popover>
</template>
