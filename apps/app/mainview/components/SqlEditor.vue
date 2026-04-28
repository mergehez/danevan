<script setup lang="ts">
import MonacoEditor from '@components/MonacoEditor.vue';
import MonacoEditorSettingsButton from '@components/MonacoEditorSettingsButton.vue';
import type { MonacoEditorActionZone } from '@components/monacoEditorTypes';
import Button from '@ui/Button.vue';
import { appClientRpc } from '@lib/appClient';
import type { MonacoDiagnosticMarker } from '@lib/monaco';
import type { DbType, SqlDiagnosticMarker, SqlDiagnosticsResult } from '@utils/appClient';
import { toast } from '@utils/useToast';
import { computed, ref } from 'vue';

const modelValue = defineModel<string>({ required: true });
const emit = defineEmits<{
    tableDrop: [payload: { connectionId: number; tableName: string }];
}>();
const props = defineProps<{
    title: string;
    connectionId?: number;
    sqlDialect?: DbType;
    focusLine?: number;
    readonly?: boolean;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: 'always' | 'hover';
    extraMarkers?: MonacoDiagnosticMarker[];
    noHead?: boolean;
    onDiagnosticsChanged?: (result: SqlDiagnosticsResult) => void;
}>();

const isFormatting = ref(false);
const latestDiagnostics = ref<SqlDiagnosticsResult>({ markers: [], problemMarkers: [] });

const hasBlockingErrors = computed(() => latestDiagnostics.value.markers.some((marker) => marker.severity === 'error'));

const canFormat = computed(() => {
    return !props.readonly && !isFormatting.value && !hasBlockingErrors.value && Boolean(modelValue.value.trim()) && props.sqlDialect !== 'msaccess';
});

function handleDiagnosticsChanged(result: SqlDiagnosticsResult) {
    latestDiagnostics.value = result;
    props.onDiagnosticsChanged?.(result);
}

function getBlockingErrorMessage(markers: SqlDiagnosticMarker[]) {
    return markers.find((marker) => marker.severity === 'error')?.message || 'Formatting is disabled while SQL has parser or database errors.';
}

async function formatSql() {
    if (!modelValue.value.trim() || props.readonly || props.sqlDialect === 'msaccess' || isFormatting.value) {
        return;
    }

    const diagnostics = await appClientRpc.request.getSqlDiagnostics({
        sql: modelValue.value,
        dialect: props.sqlDialect,
        connectionId: props.connectionId,
    });

    handleDiagnosticsChanged(diagnostics);

    if (diagnostics.markers.some((marker) => marker.severity === 'error')) {
        toast.showToast(getBlockingErrorMessage(diagnostics.markers), 'warning');
        return;
    }

    isFormatting.value = true;

    try {
        modelValue.value = await appClientRpc.request.formatSql({
            sql: modelValue.value,
            dialect: props.sqlDialect,
        });
    } catch (error) {
        toast.showToast(error instanceof Error ? error.message : String(error), 'danger');
    } finally {
        isFormatting.value = false;
    }
}
</script>

<template>
    <div class="relative flex h-full flex-col">
        <div v-if="!props.noHead" class="flex items-center gap-1 border-b border-x5 px-2 py-1.5 text-xs font-medium">
            <div class="truncate flex-1 text-white">{{ title }}</div>
            <slot name="before-header-actions"></slot>
            <!-- <div v-if="state?.metaItems?.length" class="flex flex-wrap items-center gap-1 text-xs text-white/65">
                <Alert severity="secondary" v-for="item in state.metaItems" :key="item.id" class="rounded px-2 py-px tracking-tight" v-html="item.text"> </Alert>
            </div> -->
            <Button severity="secondary" smaller :disabled="!canFormat" @click="formatSql">Format</Button>
            <MonacoEditorSettingsButton :hide-diff-options="true" />
        </div>

        <slot name="after-header"></slot>

        <MonacoEditor
            no-head
            v-model:model-value="modelValue"
            :extra-markers="props.extraMarkers"
            language="sql"
            :readonly="props.readonly"
            :sql-autocomplete-connection-id="props.connectionId"
            :sql-autocomplete-dialect="props.sqlDialect"
            :on-diagnostics-changed="handleDiagnosticsChanged"
            class="overflow-y-auto text-xs leading-6 text-white/85"
            @tableDrop="(payload) => emit('tableDrop', payload)"
        />
    </div>
</template>
