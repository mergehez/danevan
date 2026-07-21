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

async function addEditor() {
    const editor = await settings.pickEditorApplication();
    if (editor) {
        await settings.addEditor(editor);
    }
}
</script>

<template>
    <div v-if="settings.isSettingsModalOpen" class="fixed inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" :style="{ zIndex: modalZIndex }">
        <div class="w-full max-w-xl border border-x4 bg-x1 p-6 text-default shadow-2xl">
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <p class="text-2xs uppercase tracking-[0.25em] opacity-60">Preferences</p>
                    <h2 class="text-2xl font-semibold text-reverse">Editor routing</h2>
                </div>
                <button class="border border-x4 bg-x2 px-3 py-1 text-xs hover:bg-x3" @click="settings.closeSettingsWindow">Close</button>
            </div>

            <div class="space-y-3">
                <button class="bg-x7 px-4 py-2 text-sm font-medium text-x0 hover:bg-x8" @click="addEditor">Add editor</button>
                <div v-for="editor in settings.state.editors" :key="editor.path" class="flex items-center justify-between border border-x4 bg-x2 px-4 py-3">
                    <div>
                        <div class="font-medium">{{ editor.label }}</div>
                        <div class="text-xs opacity-60">{{ editor.path }}</div>
                    </div>
                    <button
                        class="border px-3 py-1 text-xs uppercase tracking-[0.2em]"
                        :class="settings.state.defaultEditorPath === editor.path ? 'border-x7 bg-x7/15 text-reverse' : 'border-x4 opacity-70 hover:bg-x3 hover:opacity-100'"
                        @click="settings.setDefaultEditor(editor.path)"
                    >
                        {{ settings.state.defaultEditorPath === editor.path ? 'Default' : 'Set default' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
