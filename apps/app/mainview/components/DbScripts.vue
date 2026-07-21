<script setup lang="ts">
import DbGridToolbar from '@components/DbGridToolbar.vue';
import DbSaveBar from '@components/DbSaveBar.vue';
import SqlEditor from '@components/SqlEditor.vue';
import { useConnections } from '@composables/useConnections';
import { useDbDataGrid } from '@composables/useDbDataGrid';
import { useDbSettings } from '@composables/useDbSettings';
import { useNavState } from '@composables/useNavState';
import { useQuery } from '@composables/useQuery';
import { useScriptsDb } from '@composables/useScriptsDb';
import { useServers } from '@composables/useServers';
import { DataGrid } from '@datagrid';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import SplitterVertical from '@ui/SplitterVertical.vue';
import type { SqlDiagnosticMarker, SqlDiagnosticsResult, TableData } from '@utils/appClient';
import { quoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { computed, reactive, ref, watch } from 'vue';

const settings = useDbSettings();
const connections = useConnections();
const servers = useServers();
const scripts = useScriptsDb();
const query = useQuery();
const navState = useNavState();

const selectedScript = computed(() => scripts.selectedScript);
const activeTab = computed(() => navState.activeTab);
const activeScriptTab = computed(() => {
    const currentTab = activeTab.value;

    if (!currentTab || (currentTab.type !== 'script' && currentTab.type !== 'scratch')) {
        return undefined;
    }

    return currentTab;
});
const activeSavedScript = computed(() => {
    const currentTab = activeScriptTab.value;

    if (!currentTab || currentTab.type !== 'script') {
        return undefined;
    }

    return scripts.scripts.find((script) => script.id === currentTab.targetId);
});
const isSaveModalOpen = ref(false);
const resultPanelTab = ref<'result' | 'problems'>('problems');
const scriptProblems = ref<SqlDiagnosticMarker[]>([]);
const problemSourcesToIgnore = [
    'sqlfluff:AM04', // Query produces an unknown number of result columns
    'sqlfluff:LT01', // Unnecessary trailing whitespace
    'sqlfluff:LT12', // Files must end with a single trailing newline.
    'sqlfluff:LT14', // The 'where' keyword should always start a new line.
    'sqlfluff:RF06', // Unnecessary quoted identifier...
];
const scriptProblemsFiltered = computed(() => {
    const res = scriptProblems.value.filter((problem) => {
        if (!problem.source) {
            return true;
        }

        return !problemSourcesToIgnore.includes(problem.source);
    });
    if (res.length) console.log('Filtered script problems: ' + JSON.stringify(res, null, 2));
    return res;
});
const saveForm = reactive({
    name: '',
    groupName: '',
});
const editorConnectionId = computed(() => activeScriptTab.value?.connectionId ?? selectedScript.value?.connection_id ?? connections.selectedConnectionId);
const editorConnection = computed(() => connections.connections.find((connection) => connection.id === editorConnectionId.value));
const editorServerId = computed(() => editorConnection.value?.server_id);
const editorServer = computed(() => servers.servers.find((server) => server.id === editorServerId.value));
const serverOptions = computed(() => servers.servers.filter((server) => connections.connections.some((connection) => connection.server_id === server.id)));
const serverConnections = computed(() => {
    if (typeof editorServerId.value !== 'number') {
        return [];
    }

    return connections.connections.filter((connection) => connection.server_id === editorServerId.value);
});
const showDatabaseSelect = computed(() => editorServer.value?.kind === 'server');
const editorSqlDialect = computed(() => {
    if (editorServer.value?.driver) {
        return editorServer.value.driver;
    }

    return 'mysql' as const;
});

const canOpenSaveModal = computed(() => typeof editorConnectionId.value === 'number');
const canSubmitSave = computed(() => !!saveForm.name.trim() && typeof editorConnectionId.value === 'number');
const isBusy = computed(() => query.isRunningQuery);
const problemCount = computed(() => scriptProblemsFiltered.value.length);
const hasProblems = computed(() => problemCount.value > 0);

const getEmptyTableData = (): TableData => ({
    columns: [],
    rows: [],
    columnStats: {},
    rowCount: 0,
    limit: 0,
    offset: 0,
});

const resultTableInfo = computed(() => {
    if (query.queryResult?.kind !== 'rows' || !editorConnectionId.value) {
        return undefined;
    }

    const connectionId = editorConnectionId.value;
    const resultColumns = new Set(query.queryResult.columns.map((c) => c.toLowerCase()));
    const tablesState = connections.getConnectionTablesState(connectionId);
    const knownTables = tablesState.tables;

    for (const table of knownTables) {
        const info = connections.getTableDetailsState(connectionId, table.name).info;

        if (!info) {
            continue;
        }

        const pkColumns = info.columns.filter((c) => c.isPrimaryKey).map((c) => c.name.toLowerCase());

        if (!pkColumns.length) {
            continue;
        }

        if (pkColumns.every((pk) => resultColumns.has(pk))) {
            return info;
        }
    }

    return undefined;
});

const resultDetectedTableName = computed(() => resultTableInfo.value?.name);

const resultDbGridState = useDbDataGrid({
    connectionId: () => editorConnectionId.value!,
    tableData: () => (query.queryResult?.kind === 'rows' ? query.queryResult : getEmptyTableData()) as TableData,
    tableInfo: () => resultTableInfo.value,
    tableName: () => resultDetectedTableName.value,
    emptyText: () => 'Query returned no rows.',
});

function reloadQueryResult() {
    if (query.queryText.trim()) {
        void query.runQuery();
    }
}

watch(
    () => activeScriptTab.value?.hash,
    (nextTabHash) => {
        const nextState = navState.getScriptTabRuntimeState(nextTabHash);
        query.queryResult = nextState.queryResult;
        resultPanelTab.value = nextState.resultPanelTab;
        scriptProblems.value = [...nextState.scriptProblems];
    },
    { immediate: true }
);

watch(
    () => query.queryResult,
    (nextQueryResult) => {
        const activeTabHash = activeScriptTab.value?.hash;

        if (!activeTabHash) {
            return;
        }

        navState.setScriptTabRuntimeState(activeTabHash, {
            queryResult: nextQueryResult,
        });
    }
);

watch(resultPanelTab, (nextResultPanelTab) => {
    const activeTabHash = activeScriptTab.value?.hash;

    if (!activeTabHash) {
        return;
    }

    navState.setScriptTabRuntimeState(activeTabHash, {
        resultPanelTab: nextResultPanelTab,
    });
});

watch(
    scriptProblems,
    (nextScriptProblems) => {
        const activeTabHash = activeScriptTab.value?.hash;

        if (!activeTabHash) {
            return;
        }

        navState.setScriptTabRuntimeState(activeTabHash, {
            scriptProblems: [...nextScriptProblems],
        });
    },
    { deep: true }
);

function openSaveScriptModal() {
    if (typeof editorConnectionId.value !== 'number') {
        return;
    }

    saveForm.name = activeSavedScript.value?.name || '';
    saveForm.groupName = activeSavedScript.value?.group_name || '';
    isSaveModalOpen.value = true;
}

async function submitScriptSave() {
    if (!canSubmitSave.value || typeof editorConnectionId.value !== 'number') {
        return;
    }

    const currentTab = activeScriptTab.value;

    if (activeSavedScript.value) {
        await scripts.updateScript(activeSavedScript.value.id, {
            name: saveForm.name,
            groupName: saveForm.groupName || undefined,
            connectionId: editorConnectionId.value,
            sqlText: query.queryText,
        });
    } else {
        await scripts.createScript({
            connectionId: editorConnectionId.value,
            name: saveForm.name,
            groupName: saveForm.groupName || undefined,
            sqlText: query.queryText,
        });

        const createdScript = scripts.selectedScript;

        if (createdScript) {
            if (currentTab?.type === 'scratch') {
                navState.replaceScratchTabWithScript(currentTab.hash, createdScript.id);
            } else {
                navState.selectScript(createdScript.id);
            }
        }
    }

    isSaveModalOpen.value = false;
}

async function assignEditorConnection(nextConnectionId: number) {
    const currentTab = activeScriptTab.value;
    const currentSavedScript = activeSavedScript.value;

    if (currentTab) {
        navState.updateTabConnection(currentTab.hash, nextConnectionId);
    }

    if (currentSavedScript) {
        if (currentSavedScript.connection_id !== nextConnectionId) {
            await scripts.updateScript(currentSavedScript.id, {
                name: currentSavedScript.name,
                connectionId: nextConnectionId,
                sqlText: query.queryText,
            });
        }

        if (connections.selectedConnectionId !== nextConnectionId) {
            await connections.selectConnection(nextConnectionId);
        }

        return;
    }

    if (connections.selectedConnectionId !== nextConnectionId) {
        await connections.selectConnection(nextConnectionId);
    }
}

function getConnectionDatabaseLabel(connectionId: number) {
    const connection = connections.connections.find((entry) => entry.id === connectionId);
    return connection?.database_name || connection?.name;
}

async function assignEditorServer(nextServerId: number) {
    const nextServer = servers.servers.find((server) => server.id === nextServerId);

    if (!nextServer) {
        return;
    }

    const nextConnections = connections.connections.filter((connection) => connection.server_id === nextServerId);

    if (nextConnections.length === 0) {
        return;
    }

    const currentServer = editorServer.value;
    const currentDatabaseName = editorConnectionId.value ? getConnectionDatabaseLabel(editorConnectionId.value) : undefined;

    let nextConnection = nextConnections[0];

    if (currentServer?.kind === 'server' && nextServer.kind === 'server' && currentDatabaseName) {
        const matchingConnection = nextConnections.find((connection) => (connection.database_name || connection.name) === currentDatabaseName);

        if (matchingConnection) {
            nextConnection = matchingConnection;
        }
    }

    await assignEditorConnection(nextConnection.id);
}

async function handleEditorConnectionChange(event: Event) {
    const nextValue = Number((event.target as HTMLSelectElement).value);

    if (!Number.isFinite(nextValue) || nextValue <= 0) {
        return;
    }

    await assignEditorConnection(nextValue);
}

async function handleEditorServerChange(event: Event) {
    const nextValue = Number((event.target as HTMLSelectElement).value);

    if (!Number.isFinite(nextValue) || nextValue <= 0) {
        return;
    }

    await assignEditorServer(nextValue);
}

function appendQueryText(nextStatement: string) {
    const currentText = query.queryText.trimEnd();
    query.queryText = currentText ? `${currentText}\n${nextStatement}` : nextStatement;
}

async function handleEditorTableDrop(payload: { connectionId: number; tableName: string }) {
    await settings.setActiveView('scripts');
    await assignEditorConnection(payload.connectionId);
    appendQueryText(`select * from ${quoteSqlIdentifier(payload.tableName, editorSqlDialect.value)};`);
}

async function runSelectedScript() {
    await settings.setActiveView('scripts');
    resultPanelTab.value = 'result';
    await query.runQuery();
}

function handleSqlDiagnosticsChanged(result: SqlDiagnosticsResult) {
    scriptProblems.value = result.problemMarkers || [];
}

function getProblemSeverityClasses(severity: SqlDiagnosticMarker['severity']) {
    if (severity === 'error') {
        return 'border-x5 bg-red-950 text-red-100';
    }

    if (severity === 'warning') {
        return 'border-x5 bg-yellow-950 text-amber-100';
    }

    if (severity === 'info') {
        return 'border-x5 bg-sky-950 text-sky-100';
    }

    return 'border-x5 bg-x1 text-white/75';
}
</script>

<template>
    <CenteredModal v-model:open="isSaveModalOpen" title="Save script" contentClass="max-w-lg">
        <div class="space-y-3 px-4 py-4" @keydown.enter.prevent="submitScriptSave">
            <div class="space-y-1">
                <label class="text-xs font-medium uppercase tracking-[0.2em] opacity-70">Script name</label>
                <input v-model="saveForm.name" class="w-full border border-x4 bg-x0 px-3 py-2 text-sm outline-none" placeholder="Script name" />
            </div>
            <div class="space-y-1">
                <label class="text-xs font-medium uppercase tracking-[0.2em] opacity-70">Group</label>
                <input v-model="saveForm.groupName" class="w-full border border-x4 bg-x0 px-3 py-2 text-sm outline-none" placeholder="Optional group" />
            </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
            <Button severity="secondary" smaller @click="isSaveModalOpen = false"> Cancel </Button>
            <Button severity="primary" smaller :disabled="!canSubmitSave" @click="submitScriptSave"> Save </Button>
        </div>
    </CenteredModal>

    <SplitterVertical class="h-full bg-transparent" base-side="bottom" default-height="200px" min-height="200px" max-height="60%" local-storage-key="scriptViewSplit">
        <template #top>
            <div class="bg-x0 flex-1">
                <SqlEditor
                    v-model="query.queryText"
                    :title="activeScriptTab?.name || selectedScript?.name || 'Scratch SQL'"
                    :connection-id="editorConnectionId"
                    :sql-dialect="editorSqlDialect"
                    :on-diagnostics-changed="handleSqlDiagnosticsChanged"
                    :readonly="isBusy"
                    class="h-full"
                    @tableDrop="handleEditorTableDrop"
                >
                    <template #before-header-actions>
                        <label class="flex items-center gap-1 border border-x4 bg-x2 px-1 py-0.5 text-2xs font-normal text-default rounded">
                            <span class="opacity-60">Server:</span>
                            <select
                                :value="editorServerId"
                                class="min-w-32 bg-transparent text-xs outline-none"
                                :disabled="serverOptions.length === 0 || isBusy"
                                @change="handleEditorServerChange"
                            >
                                <option v-for="server in serverOptions" :key="server.id" :value="server.id">
                                    {{ server.name }}
                                </option>
                            </select>
                        </label>
                        <label v-if="showDatabaseSelect" class="flex items-center gap-1 border border-x4 bg-x2 px-1 py-0.5 text-2xs font-normal text-default rounded">
                            <span class="opacity-60">DB:</span>
                            <select
                                :value="editorConnectionId"
                                class="min-w-32 bg-transparent text-xs outline-none"
                                :disabled="serverConnections.length === 0 || isBusy"
                                @change="handleEditorConnectionChange"
                            >
                                <option v-for="connection in serverConnections" :key="connection.id" :value="connection.id">
                                    {{ connection.database_name || connection.name }}
                                </option>
                            </select>
                        </label>
                        <Button severity="secondary" smaller :disabled="!canOpenSaveModal || isBusy" @click="openSaveScriptModal"> Save </Button>
                        <Button severity="primary" smaller :disabled="!query.queryText.trim() || isBusy" @click="runSelectedScript"> Run </Button>
                    </template>
                </SqlEditor>
            </div>
        </template>
        <template #bottom>
            <div class="relative mt-1 border flex-1 border-x4 bg-x2 flex min-h-0 flex-col">
                <div class="flex items-center gap-1 border-b border-x4 bg-x3">
                    <button
                        type="button"
                        class="px-2 py-1 text-xs border"
                        :class="resultPanelTab === 'result' ? ' border-x5 bg-x1 text-white' : 'border-transparent opacity-65 hover:opacity-100'"
                        @click="resultPanelTab = 'result'"
                    >
                        Result
                    </button>
                    <button
                        type="button"
                        class="px-2 py-1 text-xs border"
                        :class="resultPanelTab === 'problems' ? ' border-x5 bg-x1 text-white' : 'border-transparent opacity-65 hover:opacity-100'"
                        @click="resultPanelTab = 'problems'"
                    >
                        Problems
                        <span v-if="hasProblems" class="ml-1 opacity-70">{{ problemCount }}</span>
                    </button>
                </div>
                <div v-if="isBusy" class="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-x2/65 backdrop-blur-[1px]">
                    <div class="border border-x4 bg-x1 px-2 py-2 text-xs text-reverse">Running query...</div>
                </div>
                <DbSaveBar
                    :pending-change-count="resultDbGridState.pendingChangeCount"
                    :can-undo="resultDbGridState.canUndo"
                    :can-redo="resultDbGridState.canRedo"
                    :is-saving-changes="resultDbGridState.isSavingChanges"
                    :save-button-label="resultDbGridState.saveButtonLabel"
                    :on-undo-changes="resultDbGridState.undoChanges"
                    :on-redo-changes="resultDbGridState.redoChanges"
                    :on-preview-changes="resultDbGridState.openPreview"
                    :on-save-changes="resultDbGridState.saveChanges"
                />
                <DataGrid v-if="resultPanelTab === 'result' && query.queryResult?.kind === 'rows'" :state="resultDbGridState" :has-toolbar="true" class="flex-1">
                    <template #title>
                        <DbGridToolbar :grid-state="resultDbGridState" title="Result" :is-loading="isBusy" :on-reload="reloadQueryResult">
                            <div class="flex flex-wrap gap-1 text-2xs">
                                <span class="border border-x6 bg-x2 px-1 rounded-md">Rows {{ query.queryResult.rows.length }}</span>
                                <span class="border border-x6 bg-x2 px-1 rounded-md">Columns {{ query.queryResult.columns.length }}</span>
                            </div>
                        </DbGridToolbar>
                    </template>
                </DataGrid>
                <div v-else-if="resultPanelTab === 'result' && query.queryResult?.kind === 'mutation'" class="px-2 py-3 text-xs opacity-70">
                    Mutation completed. Last insert row id: {{ query.queryResult.lastInsertRowid }}
                </div>
                <div v-else-if="resultPanelTab === 'result'" class="px-2 py-3 text-xs opacity-60">Run the selected script to preview its result here.</div>
                <div v-else-if="hasProblems" class="min-h-0 flex-1 overflow-y-auto px-2 py-1 text-xs grid grid-cols-[auto_1fr] items-center place-content-start">
                    <template v-for="(problem, index) in scriptProblemsFiltered" :key="`${problem.source || 'sql'}-${problem.startLineNumber}-${problem.startColumn}-${index}`">
                        <!-- class="flex items-center px-2 py-0.5 leading-5 text-xs border-b" -->
                        <!-- <div class="shrink-0 opacity-80">
                            {{ problem.severity }}
                        </div> -->
                        <div class="py-1 shrink-0 px-2 border-b" :class="getProblemSeverityClasses(problem.severity)">{{ problem.startLineNumber }}:{{ problem.startColumn }}</div>
                        <div class="py-1 min-w-0 flex-1 truncate border-b pr-2" :class="getProblemSeverityClasses(problem.severity)">{{ problem.message }}</div>
                        <!-- <div class="shrink-0 opacity-75">{{ getProblemSourceLabel(problem) }}</div> -->
                    </template>
                </div>
                <div v-else class="px-4 py-3 text-xs opacity-60">No linting or formatting problems for the current SQL.</div>
            </div>
        </template>
    </SplitterVertical>
    <!-- <section class="flex-1 flex flex-col border border-x4 bg-x5 overflow-y-auto"></section> -->

    <CenteredModal :open="resultDbGridState.isPreviewOpen" title="Pending updates" contentClass="max-w-3xl" @update:open="resultDbGridState.isPreviewOpen = $event">
        <div class="space-y-3 px-4 py-4">
            <p class="text-xs opacity-70">These statements will be executed in order.</p>
            <div class="max-h-[60vh] overflow-auto border border-x4 bg-x0">
                <pre class="whitespace-pre-wrap p-3 text-xs leading-6 text-default">{{ resultDbGridState.previewQueries.join('\n') }}</pre>
            </div>
        </div>
        <div class="flex items-center justify-end gap-3 border-t border-x3 px-4 py-3">
            <Button severity="secondary" smaller @click="resultDbGridState.isPreviewOpen = false"> Close </Button>
            <Button severity="primary" smaller :disabled="!resultDbGridState.pendingChangeCount || resultDbGridState.isSavingChanges" @click="resultDbGridState.saveChanges()">
                {{ resultDbGridState.saveButtonLabel }}
            </Button>
        </div>
    </CenteredModal>
</template>
