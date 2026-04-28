<script setup lang="ts">
import MonacoEditorSettingsButton from '@components/MonacoEditorSettingsButton.vue';
import { useConnections } from '@composables/useConnections';
import { useSettings } from '@composables/useSettings';
import { appClientRpc } from '@lib/appClient';
import type { SqlAutocompleteSchema } from '@lib/monaco';
import {
    APP_MONACO_THEME,
    configureMonaco,
    configureMonacoEnvironment,
    createMonacoOptions,
    getMonacoLanguage,
    getMonacoModule as loadMonacoModule,
    type MonacoDiagnosticMarker,
    registerSqlAutocompleteContext,
} from '@lib/monaco';
import { parseSqlEditorTableDropPayload, SQL_EDITOR_TABLE_DRAG_MIME } from '@lib/sqlEditorDnd';
import type { DbType, SqlDiagnosticMarker, SqlDiagnosticsResult, TableInfo } from '@utils/appClient';
import { hasSuspiciousSqlWhitespace, normalizeSqlInputWhitespace } from '@utils/sqlTextNormalization';
import type * as MonacoEditorModule from 'monaco-editor';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

type MonacoModule = typeof import('monaco-editor');

configureMonacoEnvironment();

const modelValue = defineModel<string>();
const emit = defineEmits<{
    tableDrop: [payload: { connectionId: number; tableName: string }];
}>();
const props = defineProps<{
    title?: string;
    noHead?: boolean;
    readonly?: boolean;
    class?: string;
    language?: string;
    sqlAutocompleteConnectionId?: number;
    sqlAutocompleteDialect?: DbType;
    pathForLanguage?: string;
    extraMarkers?: MonacoDiagnosticMarker[];
    onDiagnosticsChanged?: (result: SqlDiagnosticsResult) => void;
}>();
const settings = useSettings();
const connections = useConnections();

const editorContainerRef = ref<HTMLDivElement>();
const monacoModuleRef = shallowRef<MonacoModule>();
const editorRef = shallowRef<MonacoEditorModule.editor.IStandaloneCodeEditor>();
const modelRef = shallowRef<MonacoEditorModule.editor.ITextModel>();
const disposeSqlAutocompleteContextRef = shallowRef<(() => void) | undefined>();
const internalMarkersRef = ref<SqlDiagnosticMarker[]>([]);
let applyingExternalValue = false;
let diagnosticsSyncTimer: ReturnType<typeof setTimeout> | undefined;
let diagnosticsRequestVersion = 0;

const sqlAutocompleteSchemaCache = new Map<number, Promise<SqlAutocompleteSchema>>();

function sanitizeModelWhitespaceAfterPaste() {
    if (!editorRef.value || !modelRef.value) {
        return;
    }

    const currentValue = modelRef.value.getValue();

    if (!hasSuspiciousSqlWhitespace(currentValue)) {
        return;
    }

    const normalizedValue = normalizeSqlInputWhitespace(currentValue);

    if (normalizedValue === currentValue) {
        return;
    }

    const selections = editorRef.value.getSelections() ?? [];
    applyingExternalValue = true;
    modelRef.value.pushEditOperations(
        selections,
        [
            {
                range: modelRef.value.getFullModelRange(),
                text: normalizedValue,
            },
        ],
        () => selections
    );
    applyingExternalValue = false;
    modelValue.value = normalizedValue;
    scheduleSqlDiagnostics();
    syncMarkers();
}

async function getMonacoModule() {
    if (!monacoModuleRef.value) {
        monacoModuleRef.value = await loadMonacoModule();
    }

    return monacoModuleRef.value;
}

async function getSqlAutocompleteSchema(connectionId: number) {
    const cachedSchema = sqlAutocompleteSchemaCache.get(connectionId);

    if (cachedSchema) {
        return cachedSchema;
    }

    const schemaPromise = (async () => {
        await connections.ensureConnectionTables(connectionId);
        const tables = connections.getConnectionTablesState(connectionId).tables;

        await Promise.all(tables.map((table) => connections.ensureTableDetails(connectionId, table.name)));

        const tableInfos = tables.map((table) => connections.getTableDetailsState(connectionId, table.name).info).filter((info): info is TableInfo => Boolean(info));

        return {
            tables: tables.map((table) => ({
                name: table.name,
                type: table.type,
            })),
            columns: tableInfos.flatMap((tableInfo: TableInfo) =>
                tableInfo.columns.map((column) => ({
                    tableName: tableInfo.name,
                    columnName: column.name,
                }))
            ),
        } satisfies SqlAutocompleteSchema;
    })().catch((error) => {
        sqlAutocompleteSchemaCache.delete(connectionId);
        throw error;
    });

    sqlAutocompleteSchemaCache.set(connectionId, schemaPromise);
    return schemaPromise;
}

function clearSqlAutocompleteContext() {
    disposeSqlAutocompleteContextRef.value?.();
    disposeSqlAutocompleteContextRef.value = undefined;
}

function syncSqlAutocompleteContext() {
    clearSqlAutocompleteContext();

    if (props.language !== 'sql' || !props.sqlAutocompleteConnectionId || !modelRef.value) {
        return;
    }

    disposeSqlAutocompleteContextRef.value = registerSqlAutocompleteContext(modelRef.value.uri.toString(), {
        dialect: props.sqlAutocompleteDialect,
        getSchema: () => getSqlAutocompleteSchema(props.sqlAutocompleteConnectionId!),
    });
}

function getMarkerSeverity(monaco: MonacoModule, severity: MonacoDiagnosticMarker['severity']) {
    if (severity === 'warning') {
        return monaco.MarkerSeverity.Warning;
    }

    if (severity === 'info') {
        return monaco.MarkerSeverity.Info;
    }

    if (severity === 'hint') {
        return monaco.MarkerSeverity.Hint;
    }

    return monaco.MarkerSeverity.Error;
}

function syncMarkers() {
    if (!monacoModuleRef.value || !modelRef.value) {
        return;
    }

    monacoModuleRef.value.editor.setModelMarkers(
        modelRef.value,
        'external-diagnostics',
        [...internalMarkersRef.value, ...(props.extraMarkers ?? [])].map((marker) => ({
            ...marker,
            severity: getMarkerSeverity(monacoModuleRef.value!, marker.severity),
        }))
    );
}

function clearScheduledDiagnostics() {
    if (diagnosticsSyncTimer) {
        clearTimeout(diagnosticsSyncTimer);
        diagnosticsSyncTimer = undefined;
    }
}

function publishDiagnostics(result: SqlDiagnosticsResult) {
    props.onDiagnosticsChanged?.(result);
}

function scheduleSqlDiagnostics() {
    clearScheduledDiagnostics();

    if (props.language !== 'sql' || !modelRef.value) {
        internalMarkersRef.value = [];
        publishDiagnostics({ markers: [], problemMarkers: [] });
        syncMarkers();
        return;
    }

    const sql = modelRef.value.getValue();

    if (!sql.trim()) {
        internalMarkersRef.value = [];
        publishDiagnostics({ markers: [], problemMarkers: [] });
        syncMarkers();
        return;
    }

    const requestVersion = ++diagnosticsRequestVersion;
    diagnosticsSyncTimer = setTimeout(async () => {
        try {
            const result = await appClientRpc.request.getSqlDiagnostics({
                sql,
                dialect: props.sqlAutocompleteDialect,
                connectionId: props.sqlAutocompleteConnectionId,
            });

            if (requestVersion !== diagnosticsRequestVersion) {
                return;
            }

            internalMarkersRef.value = result.markers;
            publishDiagnostics(result);
        } catch {
            if (requestVersion !== diagnosticsRequestVersion) {
                return;
            }

            internalMarkersRef.value = [];
            publishDiagnostics({ markers: [], problemMarkers: [] });
        }

        syncMarkers();
    }, 350);
}

async function ensureEditor() {
    if (!editorContainerRef.value || editorRef.value) {
        return;
    }

    const monaco = await getMonacoModule();

    configureMonaco(monaco);
    monaco.editor.setTheme(APP_MONACO_THEME);

    modelRef.value = monaco.editor.createModel(modelValue.value ?? '', finalLanguage.value);
    editorRef.value = monaco.editor.create(editorContainerRef.value, options.value);
    editorRef.value.setModel(modelRef.value);
    editorRef.value.onDidPaste(() => {
        sanitizeModelWhitespaceAfterPaste();
    });

    modelRef.value.onDidChangeContent(() => {
        if (applyingExternalValue) {
            return;
        }

        modelValue.value = modelRef.value?.getValue() ?? '';
        scheduleSqlDiagnostics();
    });
}

function disposeEditor() {
    clearScheduledDiagnostics();
    diagnosticsRequestVersion += 1;
    clearSqlAutocompleteContext();
    editorRef.value?.dispose();
    modelRef.value?.dispose();
    editorRef.value = undefined;
    modelRef.value = undefined;
}

function onDragOver(event: DragEvent) {
    const transferTypes = event.dataTransfer?.types;

    if (!transferTypes?.includes(SQL_EDITOR_TABLE_DRAG_MIME)) {
        return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
}

function onDrop(event: DragEvent) {
    const rawPayload = event.dataTransfer?.getData(SQL_EDITOR_TABLE_DRAG_MIME);
    const payload = parseSqlEditorTableDropPayload(rawPayload);

    if (!payload) {
        return;
    }

    event.preventDefault();
    emit('tableDrop', payload);
}

function syncExternalModelValue() {
    if (!modelRef.value) {
        return;
    }

    const nextValue = modelValue.value ?? '';

    if (modelRef.value.getValue() === nextValue) {
        return;
    }

    applyingExternalValue = true;
    modelRef.value.setValue(nextValue);
    applyingExternalValue = false;
    scheduleSqlDiagnostics();
    syncMarkers();
}

async function syncEditor() {
    await ensureEditor();

    if (!modelRef.value || !editorRef.value) {
        return;
    }

    const nextLanguage = finalLanguage.value;

    if (modelRef.value.getLanguageId() !== nextLanguage) {
        monacoModuleRef.value?.editor.setModelLanguage(modelRef.value, nextLanguage);
    }

    editorRef.value.updateOptions(options.value);
    editorRef.value.layout();
    syncSqlAutocompleteContext();
    scheduleSqlDiagnostics();
    syncMarkers();
}

const finalLanguage = computed(() => {
    return getMonacoLanguage(props.language, props.pathForLanguage, props.sqlAutocompleteDialect);
});

const options = computed(() => {
    return createMonacoOptions({
        readonly: props.readonly,
        fontSize: settings.diffFontSize,
    }) as MonacoEditorModule.editor.IStandaloneEditorConstructionOptions;
});

watch(
    () => [props.language, props.pathForLanguage, props.sqlAutocompleteConnectionId, props.sqlAutocompleteDialect, props.readonly, settings.diffFontSize],
    () => {
        void syncEditor();
    }
);

watch(
    () => modelValue.value,
    () => {
        if (applyingExternalValue) {
            return;
        }

        syncExternalModelValue();
    }
);

watch(
    () => props.extraMarkers,
    () => {
        syncMarkers();
    },
    { deep: true }
);

onMounted(() => {
    void syncEditor();
});

onUnmounted(() => {
    disposeEditor();
});
</script>

<template>
    <div class="h-full flex flex-col relative" @dragover="onDragOver" @drop="onDrop">
        <div v-if="!props.noHead" class="flex items-center border-b border-x5 px-2 py-1.5 text-xs font-medium gap-1">
            <div class="line-clamp-1 flex-1 text-white">{{ title || pathForLanguage }}</div>

            <slot name="before-settings-button"></slot>

            <MonacoEditorSettingsButton :hide-diff-options="true" />
        </div>

        <div ref="editorContainerRef" class="w-full min-h-40 flex-1" :class="props.class" />
    </div>
</template>
