<script setup lang="ts">
import { useDbSettings } from '@composables/useDbSettings';
import { useOverlaysState } from '@directives/useOverlaysState';
import { ref, watch } from 'vue';

const settings = useDbSettings();
const overlayState = useOverlaysState();
const modalZIndex = ref(90);

watch(
    () => settings.isSettingsModalOpen,
    (isOpen) => {
        modalZIndex.value = isOpen ? overlayState.claimZIndex() : overlayState.releaseZIndex(modalZIndex.value);
    }
);
</script>

<template>
    <div v-if="settings.isSettingsModalOpen" class="fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" :style="{ zIndex: modalZIndex }">
        <div class="w-full max-w-xl border border-x4 bg-x1 p-6 text-default shadow-2xl">
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <p class="text-2xs uppercase tracking-[0.25em] opacity-60">Preferences</p>
                    <h2 class="text-2xl font-semibold text-reverse">Section1</h2>
                </div>
                <button class="border border-x4 bg-x2 px-3 py-1 text-xs hover:bg-x3" @click="settings.closeSettingsWindow">Close</button>
            </div>

            <div class="space-y-3">Content...</div>
        </div>
    </div>
</template>
