<script setup lang="ts">
import MonacoEditor from '@components/MonacoEditor.vue';
import { useGridFormatters } from '@composables/useGridFormatters';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';

const state = useGridFormatters();

// watch(
//     () => state.formatterDraft.templateType,
//     (newType) => {
//         if (newType === 'javascript' && state.formatterDraft.template === '{{value}}') {
//             state.formatterDraft.template = 'value';
//         } else if (newType === 'handlebars' && state.formatterDraft.template === 'value') {
//             state.formatterDraft.template = '{{value}}';
//         }
//     }
// );
</script>

<template>
    <CenteredModal :open="state.isModalOpen" :title="state.modalTitle" contentClass="max-w-4xl" @update:open="!$event && state.closeModal()">
        <div class="grid gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div class="border-b border-x3 px-4 py-4 md:border-b-0 md:border-r">
                <div class="mb-3 flex items-center justify-between gap-3">
                    <div>
                        <p class="text-sm font-medium text-default">Available formatters</p>
                        <p class="text-xs opacity-70">
                            Templates use <span class="font-mono" v-pre>{{ value }}</span> to inject the rendered cell text.
                        </p>
                    </div>
                    <Button severity="secondary" smaller @click="() => state.createNewDraft()">New</Button>
                </div>

                <div class="max-h-[50vh] overflow-y-auto border border-x4 bg-x0">
                    <label v-for="formatter in state.customFormatters" :key="formatter.id" class="flex items-start gap-3 border-b border-x3 px-3 py-3 text-sm last:border-b-0">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-3">
                                <span class="truncate font-medium">{{ formatter.name }}</span>
                                <div class="flex items-center gap-2">
                                    <Button severity="secondary" smaller @click.stop="() => state.startEditingFormatter(formatter.id)">Edit</Button>
                                    <Button severity="danger" smaller @click.stop="() => state.deleteFormatter(formatter.id)">Delete</Button>
                                </div>
                            </div>
                            <pre class="mt-2 whitespace-pre-wrap wrap-break-word border border-x3 bg-x1 px-2 py-2 text-xs opacity-80">{{ formatter.template }}</pre>
                        </div>
                    </label>
                    <div v-if="!state.customFormatters.length" class="px-3 py-4 text-sm opacity-60">No custom formatters saved yet.</div>
                </div>
            </div>

            <div class="px-4 py-4">
                <div class="space-y-3">
                    <div>
                        <label class="mb-1 block text-xs uppercase tracking-wide opacity-70">Name</label>
                        <input v-model="state.formatterDraft.name" class="w-full border border-x4 bg-x0 px-3 py-2 text-sm outline-none focus:border-white/30" />
                    </div>

                    <!-- <div>
                        <label class="mb-1 block text-xs uppercase tracking-wide opacity-70">Template type</label>
                        <div class="flex items-center gap-4">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    value="handlebars"
                                    v-model="state.formatterDraft.templateType"
                                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                />
                                <span>Handlebars</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    value="javascript"
                                    v-model="state.formatterDraft.templateType"
                                    class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                />
                                <span>JavaScript</span>
                            </label>
                        </div>
                    </div> -->

                    <div>
                        <label class="mb-1 block text-xs uppercase tracking-wide opacity-70">Template</label>
                        <!-- <textarea
                            v-if="state.formatterDraft.templateType === 'handlebars'"
                            v-model="state.formatterDraft.template"
                            rows="8"
                            class="w-full resize-y border border-x4 bg-x0 px-3 py-2 font-mono text-xs outline-none focus:border-white/30"
                        ></textarea> -->
                        <MonacoEditor
                            v-model="state.formatterDraft.template"
                            language="javascript"
                            :options="{
                                minimap: { enabled: false },
                                lineNumbers: 'off',
                                folding: false,
                                lineDecorationsWidth: 0,
                                lineNumbersMinChars: 0,
                                fontSize: 13,
                                scrollBeyondLastLine: false,
                            }"
                        />
                    </div>

                    <div class="border border-x3 bg-x0 px-3 py-3 text-xs opacity-80">
                        Preview:
                        <span class="font-mono">{{ state.formatterDraft.template || state.defaultTemplate }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
            <Button severity="secondary" smaller @click="() => state.closeModal()">Close</Button>
            <Button severity="secondary" smaller :disabled="!state.formatterDraft.name.trim() || !state.formatterDraft.template.trim()" @click="() => state.saveFormatter()">
                {{ state.formatterDraft.id ? 'Update Formatter' : 'Save Formatter' }}
            </Button>
        </div>
    </CenteredModal>
</template>
