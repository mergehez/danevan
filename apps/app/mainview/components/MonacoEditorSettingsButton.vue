<script setup lang="ts">
import { useSettings } from '@composables/useSettings';
import { useOverlaysState } from '@directives/useOverlaysState';
import IconButton from '@ui/IconButton.vue';
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{
    hideDiffOptions?: boolean;
}>();
const settings = useSettings();

const overlayState = useOverlaysState();
const dropdownZIndex = ref(90);
const diffSettingsRef = ref<HTMLElement>();
const isDiffSettingsOpen = ref(false);

watch(isDiffSettingsOpen, (isOpen) => {
    dropdownZIndex.value = isOpen ? overlayState.claimZIndex() : overlayState.releaseZIndex(dropdownZIndex.value);
});

function toggleDiffSettings() {
    isDiffSettingsOpen.value = !isDiffSettingsOpen.value;
}

function closeDiffSettings() {
    isDiffSettingsOpen.value = false;
}

function onDocumentPointerDown(event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof Node) || !diffSettingsRef.value?.contains(target)) {
        closeDiffSettings();
    }
}

function onDocumentKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        closeDiffSettings();
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', onDocumentKeyDown);
    document.removeEventListener('mousedown', onDocumentPointerDown);
});
</script>

<template>
    <div ref="diffSettingsRef" class="relative flex items-center gap-1">
        <IconButton icon="icon-[mdi--tune-variant]" v-tooltip="'Diff settings'" smaller aria-haspopup="dialog" @click.stop="toggleDiffSettings">
            <span class="icon icon-[mdi--tune-variant]"></span>
        </IconButton>
        <div
            v-if="isDiffSettingsOpen"
            class="absolute right-0 top-[calc(100%+0.5rem)] w-max rounded-md border border-white/10 bg-[#101114] p-3 shadow-[0_14px_40px_rgba(0,0,0,0.45)]"
            :style="{ zIndex: dropdownZIndex }"
            role="dialog"
            aria-label="Diff settings"
            @click.stop
        >
            <div class="space-y-3 text-xs text-white/80">
                <div>
                    <div class="mb-1.5 flex items-center justify-between">
                        <span class="font-semibold uppercase tracking-tight opacity-50">Font Size</span>
                        <!-- <span class="rounded border border-white/10 px-1.5 py-0.5 text-xs text-white/70">{{ diffFontSize }}</span> -->
                    </div>
                    <div class="flex items-center gap-2">
                        <input
                            :value="settings.diffFontSize"
                            type="range"
                            min="10"
                            max="24"
                            step="1"
                            class="w-full accent-white"
                            @input="settings.setDiffFontSize(Number(($event.target as HTMLInputElement).value))"
                        />
                        <input
                            :value="settings.diffFontSize"
                            type="number"
                            min="10"
                            max="24"
                            class="w-14 rounded border border-white/10 bg-black/20 px-2 py-1 text-center text-xs text-white outline-none focus:border-white/30"
                            @change="settings.setDiffFontSize(Number(($event.target as HTMLInputElement).value))"
                        />
                    </div>
                </div>

                <!-- <template v-if="!hideDiffOptions">
                    <div class="pt-3">
                        <label class="flex cursor-pointer items-center gap-2 text-white/80 transition hover:border-white/20 hover:text-white">
                            <input
                                :checked="settings.state.diffViewMode === 'changes'"
                                type="checkbox"
                                class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                @change="settings.setDiffViewMode(($event.target as HTMLInputElement).checked ? 'changes' : 'full-file')"
                            />
                            <span>Show changes only</span>
                        </label>
                    </div>

                    <div>
                        <label class="flex cursor-pointer items-center gap-2 text-white/80 transition hover:border-white/20 hover:text-white">
                            <input
                                :checked="!settings.state.showWhitespaceChanges"
                                @change="settings.setShowWhitespaceChanges(!($event.target as HTMLInputElement).checked)"
                                type="checkbox"
                                class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                            />
                            <span>Hide whitespace changes</span>
                        </label>
                    </div>
                </template> -->
            </div>
        </div>
    </div>
</template>
