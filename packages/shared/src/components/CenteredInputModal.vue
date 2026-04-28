<script setup lang="ts">
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import { nextTick, ref, watch } from 'vue';

const open = defineModel<boolean>('open', { required: true });
const value = defineModel<string>('value', { required: true });

const props = defineProps<{
    title: string;
    inputLabel: string;
    canSubmit: boolean;
    isLoading: boolean;
    submit: () => void;
    close?: () => void;
    submitLabel?: string;
}>();

const inputRef = ref<HTMLInputElement>();

watch(open, async (isOpen) => {
    if (!isOpen) {
        return;
    }

    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
});

function onClose() {
    if (props.close) {
        props.close();
    } else {
        open.value = false;
    }
}
</script>

<template>
    <CenteredModal v-model:open="open" :title="title" content-class="max-w-lg">
        <div class="space-y-4 px-4 py-3">
            <div class="space-y-2">
                <label class="text-sm font-medium text-white" for="centered-input-modal-field">{{ inputLabel }}</label>
                <input
                    ref="inputRef"
                    id="centered-input-modal-field"
                    v-model="value"
                    type="text"
                    :placeholder="inputLabel"
                    class="w-full rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                    @keydown.enter="submit"
                />
            </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-white/10 px-4 py-3">
            <Button severity="light" @click="onClose"> Cancel </Button>
            <Button severity="primary" :disabled="!canSubmit" v-loading="isLoading" @click="submit">
                {{ submitLabel ?? 'Submit' }}
            </Button>
        </div>
    </CenteredModal>
</template>
