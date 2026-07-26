<script setup lang="ts">
import Button from '@ui/Button.vue';
import IconButton from '@ui/IconButton.vue';
import { computed } from 'vue';

const props = defineProps<{
    pendingChangeCount: number;
    canUndo: boolean;
    canRedo: boolean;
    isSavingChanges?: boolean;
    saveButtonLabel?: string;
    supportsForeignKeyCheckToggle?: boolean;
    disableForeignKeyChecks?: boolean;
    onClearChanges?: () => void;
    onUndoChanges?: () => void;
    onRedoChanges?: () => void;
    onPreviewChanges?: () => void;
    onSaveChanges?: () => void;
    onSetDisableForeignKeyChecks?: (value: boolean) => void;
}>();

const showSaveBar = computed(() => props.pendingChangeCount > 0 || props.canUndo || props.canRedo);
const changeLabel = computed(() => (props.pendingChangeCount === 1 ? 'change' : 'changes'));
const resolvedSaveLabel = computed(() => props.saveButtonLabel || `Save ${props.pendingChangeCount} ${changeLabel.value}`);
</script>

<template>
    <div v-if="showSaveBar" class="mb-3 flex items-center justify-between gap-3 border border-amber-300/25 bg-amber-300/8 px-3 py-2 text-2xs">
        <span class="flex items-center gap-2">
            <IconButton icon="icon-[mdi--close]" smaller severity="secondary" @click="onClearChanges?.()" />
            <span>{{ pendingChangeCount }} pending {{ changeLabel }}</span>
        </span>
        <div class="flex items-center gap-3">
            <label v-if="supportsForeignKeyCheckToggle" class="flex cursor-pointer items-center gap-2 opacity-80 transition hover:opacity-100">
                <input
                    :checked="disableForeignKeyChecks"
                    type="checkbox"
                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                    @change="onSetDisableForeignKeyChecks?.(($event.target as HTMLInputElement).checked)"
                />
                <span>Disable FK checks</span>
            </label>
            <div class="flex items-center gap-2">
                <Button severity="secondary" smaller :disabled="!canUndo" @click="onUndoChanges?.()"> Undo </Button>
                <Button severity="secondary" smaller :disabled="!canRedo" @click="onRedoChanges?.()"> Redo </Button>
                <Button severity="secondary" smaller :disabled="!pendingChangeCount" @click="onPreviewChanges?.()"> Preview </Button>
                <Button severity="primary" smaller :disabled="!pendingChangeCount || isSavingChanges" @click="onSaveChanges?.()">
                    {{ resolvedSaveLabel }}
                </Button>
            </div>
        </div>
    </div>
</template>
