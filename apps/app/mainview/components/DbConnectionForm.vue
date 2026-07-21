<script setup lang="ts">
import { useConnections } from '@composables/useConnections';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import Alert from '@ui/Alert.vue';
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import { dbTypeLabels, dbTypes, type DbType, type MsAccessRuntimeStatus } from '@utils/appClient';
import { computed, reactive, watch } from 'vue';

const servers = useServers();
const connections = useConnections();

const connectionDriverOptions: Array<{ value: DbType; label: string }> = dbTypes.map((v) => ({
    value: v,
    label: dbTypeLabels[v],
}));

const forms = reactive({
    sourceName: '',
    serverFilePath: '',
    connectionName: 'local',
    connectionDriver: 'mysql' as DbType,
    connectionHost: '127.0.0.1',
    connectionPort: 3306 as '' | number,
    connectionUsername: 'root',
    connectionPassword: '',
    databaseName: '',
});

const status = reactive({
    message: '',
    severity: 'light' as 'light' | 'success' | 'danger',
});
const runtimeStatus = reactive({
    loading: false,
    value: undefined as MsAccessRuntimeStatus | undefined,
    error: '',
});

const addFormServer = computed(() => (servers.addForm.serverId > 0 ? servers.servers.find((server) => server.id === servers.addForm.serverId) : undefined));
const isFileDriver = computed(() => forms.connectionDriver === 'sqlite' || forms.connectionDriver === 'msaccess');
const addFormServerMatchesDriver = computed(() => {
    if (!addFormServer.value) {
        return false;
    }

    if (isFileDriver.value) {
        return addFormServer.value.driver === forms.connectionDriver && addFormServer.value.kind === 'file';
    }

    return addFormServer.value.driver === forms.connectionDriver && addFormServer.value.kind === 'server';
});
const title = computed(() => `Add ${connectionDriverOptions.find((option) => option.value === forms.connectionDriver)?.label || 'connection'} connection`);
const connectionNameLabel = computed(() => {
    if (!isFileDriver.value && !addFormServerMatchesDriver.value) {
        return 'Server name:';
    }

    return 'Connection name:';
});
const connectionNamePlaceholder = computed(() => {
    if (!isFileDriver.value && !addFormServerMatchesDriver.value) {
        return 'Server name';
    }

    return 'Connection name';
});
const canCreateConnection = computed(() => {
    if (!forms.connectionName.trim()) {
        return false;
    }

    if (isFileDriver.value) {
        return addFormServerMatchesDriver.value || Boolean(forms.sourceName.trim() && forms.serverFilePath.trim());
    }

    return addFormServerMatchesDriver.value || Boolean(forms.connectionHost.trim());
});
const runtimeSummary = computed(() => {
    if (runtimeStatus.loading) {
        return 'Checking MS Access runtime...';
    }

    if (runtimeStatus.error) {
        return runtimeStatus.error;
    }

    if (!runtimeStatus.value) {
        return 'MS Access runtime status is unavailable.';
    }

    if (runtimeStatus.value.currentPlatform === 'win32') {
        return 'On Windows, the native MS Access driver is used directly via PowerShell and OleDb.';
    }

    switch (runtimeStatus.value.runtimeSource) {
        case 'bundled':
            return runtimeStatus.value.currentPlatformHasBundledJre
                ? 'Bundled offline runtime and bundled JRE are available for this platform.'
                : 'Bundled offline runtime is available. This platform still needs external Java unless a JRE is bundled.';
        case 'downloaded':
            return 'Downloaded MS Access runtime is available in app data.';
        default:
            return runtimeStatus.value.runtimeDownloadsDisabled
                ? 'No MS Access runtime is available and downloads are disabled.'
                : 'No MS Access runtime is bundled yet. The app can still download jars on first use.';
    }
});

async function refreshMsAccessRuntimeStatus() {
    runtimeStatus.loading = true;
    runtimeStatus.error = '';

    try {
        runtimeStatus.value = await tasks.getMsAccessRuntimeStatus.run(undefined);
    } catch (error) {
        runtimeStatus.value = undefined;
        runtimeStatus.error = error instanceof Error ? error.message : String(error);
    } finally {
        runtimeStatus.loading = false;
    }
}

watch(
    () => servers.addForm.driver,
    (driver) => {
        forms.connectionDriver = driver;
        status.message = '';
        status.severity = 'light';
    },
    { immediate: true }
);

watch(
    () => forms.connectionDriver,
    (driver) => {
        if (driver === 'msaccess') {
            void refreshMsAccessRuntimeStatus();
        } else {
            runtimeStatus.loading = false;
            runtimeStatus.value = undefined;
            runtimeStatus.error = '';
        }

        if (driver === 'mysql' && forms.connectionPort === '') {
            forms.connectionPort = 3306;
        } else if (driver === 'postgresql' && forms.connectionPort === '') {
            forms.connectionPort = 5432;
        } else if (driver === 'sqlserver' && forms.connectionPort === '') {
            forms.connectionPort = 1433;
        }
    },
    { immediate: true }
);

function resetStatus() {
    status.message = '';
    status.severity = 'light';
}

async function pickDatabaseFile() {
    const filePath = await tasks.pickDatabaseFile.run({
        defaultPath: forms.serverFilePath || addFormServer.value?.file_path,
    });
    if (filePath) {
        forms.serverFilePath = filePath;
    }
}

async function testConnection() {
    resetStatus();

    try {
        const result = await tasks.testConnection.run({
            kind: isFileDriver.value ? 'file' : 'server',
            driver: forms.connectionDriver,
            filePath: isFileDriver.value ? (addFormServerMatchesDriver.value ? addFormServer.value?.file_path : forms.serverFilePath.trim() || undefined) : undefined,
            host: isFileDriver.value ? undefined : addFormServerMatchesDriver.value ? addFormServer.value?.host : forms.connectionHost.trim() || undefined,
            port: isFileDriver.value
                ? undefined
                : addFormServerMatchesDriver.value
                  ? addFormServer.value?.port
                  : typeof forms.connectionPort === 'number'
                    ? forms.connectionPort
                    : undefined,
            databaseName: isFileDriver.value ? undefined : forms.databaseName.trim() || undefined,
            username: isFileDriver.value ? undefined : forms.connectionUsername.trim() || undefined,
            password: isFileDriver.value ? undefined : forms.connectionPassword || undefined,
        });

        status.message = result.message;
        status.severity = 'success';
    } catch (error) {
        status.message = error instanceof Error ? error.message : String(error);
        status.severity = 'danger';
    }
}

async function createConnection() {
    if (!canCreateConnection.value) {
        return;
    }

    const isCreatingNewServer = !addFormServerMatchesDriver.value;
    let serverId = addFormServerMatchesDriver.value ? addFormServer.value?.id : undefined;

    if (!serverId) {
        if (isFileDriver.value) {
            await servers.createServer({
                name: forms.sourceName.trim(),
                kind: 'file',
                driver: forms.connectionDriver,
                filePath: forms.serverFilePath.trim(),
                username: forms.connectionUsername.trim() || undefined,
                password: forms.connectionPassword || undefined,
                host: undefined,
                port: undefined,
            });
        } else {
            const host = forms.connectionHost.trim();
            const port = typeof forms.connectionPort === 'number' ? forms.connectionPort : undefined;
            const serverName = forms.connectionName.trim() || host;

            await servers.createServer({
                name: serverName,
                kind: 'server',
                driver: forms.connectionDriver,
                host,
                port,
                username: forms.connectionUsername.trim() || undefined,
                password: forms.connectionPassword || undefined,
                filePath: undefined,
            });
        }

        serverId = servers.selectedServer?.id;
    }

    if (!serverId) {
        status.message = 'No suitable source found or created for the connection.';
        status.severity = 'danger';
        return;
    }

    if (!isCreatingNewServer || isFileDriver.value || forms.databaseName.trim()) {
        await connections.createConnection({
            serverId,
            name: forms.connectionName.trim(),
            host: isFileDriver.value ? undefined : addFormServerMatchesDriver.value ? addFormServer.value?.host : forms.connectionHost.trim() || undefined,
            port: isFileDriver.value
                ? undefined
                : addFormServerMatchesDriver.value
                  ? addFormServer.value?.port
                  : typeof forms.connectionPort === 'number'
                    ? forms.connectionPort
                    : undefined,
            databaseName: isFileDriver.value ? undefined : forms.databaseName.trim() || undefined,
            readonly: undefined,
        });
    }

    forms.sourceName = '';
    forms.serverFilePath = '';
    forms.connectionName = '';
    forms.connectionHost = '';
    forms.connectionPort = '';
    forms.connectionUsername = '';
    forms.connectionPassword = '';
    forms.databaseName = '';
    resetStatus();
    servers.addForm.visible = false;

    servers.clearAllServerSchemas();
}
</script>

<template>
    <CenteredModal v-model:open="servers.addForm.visible" :title="title">
        <section class="border border-x4 bg-x2 p-3 gap-x-2 gap-y-1 grid grid-cols-[auto_1fr] items-center">
            <span class="text-sm">Driver:</span>
            <div class="flex flex-wrap gap-x-2 gap-y-1 items-center">
                <label
                    v-for="option in connectionDriverOptions"
                    :key="option.value"
                    class="flex cursor-pointer items-center gap-2 rounded border border-x4 px-2 py-2 text-xs"
                    :class="forms.connectionDriver === option.value ? 'border-x7 bg-x4' : 'border-x7 hover:bg-x4'"
                    @click="forms.connectionDriver = option.value"
                >
                    <input type="radio" class="hidden" :checked="forms.connectionDriver === option.value" @change="forms.connectionDriver = option.value" />
                    <span
                        class="w-4 h-4 rounded-full border border-x4 shrink-0 flex items-center justify-center"
                        :class="forms.connectionDriver === option.value ? 'border-x7 bg-green-700' : 'border-x4 bg-x8'"
                    >
                        <span class="w-2 h-2 rounded-full" :class="forms.connectionDriver === option.value ? 'bg-green-500' : 'bg-x2'"></span>
                    </span>
                    <span>{{ option.label }}</span>
                </label>
            </div>

            <label for="form-connectionName" class="text-sm">{{ connectionNameLabel }}</label>
            <input
                v-model="forms.connectionName"
                id="form-connectionName"
                class="w-full border border-x4 bg-x1 px-2.5 py-2 text-xs outline-none"
                :placeholder="connectionNamePlaceholder"
            />

            <template v-if="isFileDriver">
                <label for="form-sourceName" class="text-sm">Source name:</label>
                <input v-model="forms.sourceName" id="form-sourceName" class="w-full border border-x6 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="Source name" />
                <label for="form-databaseFilePath" class="text-sm">File path:</label>
                <div class="flex gap-2">
                    <input
                        v-model="forms.serverFilePath"
                        id="form-databaseFilePath"
                        class="min-w-0 flex-1 border border-x6 bg-x0 px-2.5 py-2 text-xs outline-none"
                        :placeholder="forms.connectionDriver === 'msaccess' ? '/path/to/database.accdb' : '/path/to/database.sqlite'"
                    />
                    <button class="border border-x6 bg-x0 px-2.5 py-2 text-xs hover:bg-x3" @click="pickDatabaseFile">Browse</button>
                </div>
                <Alert v-if="forms.connectionDriver === 'msaccess'" small severity="secondary" class="col-span-full mt-2">
                    <div>{{ runtimeSummary }}</div>
                    <div v-if="runtimeStatus.value?.runtimePath" class="mt-1 opacity-70">Runtime path: {{ runtimeStatus.value.runtimePath }}</div>
                    <div v-if="runtimeStatus.value?.bundledJrePlatforms.length || runtimeStatus.value?.hasGenericBundledJre" class="mt-1 opacity-70">
                        Bundled JREs:
                        {{ [runtimeStatus.value?.hasGenericBundledJre ? 'generic' : undefined, ...(runtimeStatus.value?.bundledJrePlatforms || [])].filter(Boolean).join(', ') }}
                    </div>
                </Alert>
            </template>

            <template v-else>
                <label for="form-connectionHost" class="text-sm">Host:</label>
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <input v-model="forms.connectionHost" id="form-connectionHost" class="w-full border border-x4 bg-x1 px-2.5 py-2 text-xs outline-none" placeholder="Host" />
                    <input
                        v-model.number="forms.connectionPort"
                        id="form-connectionPort"
                        class="w-full border border-x4 bg-x1 px-2.5 py-2 text-xs outline-none"
                        inputmode="numeric"
                        min="1"
                        max="65535"
                        placeholder="Port"
                        type="number"
                    />
                </div>
                <label for="form-connectionUsername" class="text-sm">Username:</label>
                <input
                    v-model="forms.connectionUsername"
                    id="form-connectionUsername"
                    class="w-full border border-x6 bg-x0 px-2.5 py-2 text-xs outline-none"
                    placeholder="Username"
                />
                <label for="form-connectionPassword" class="text-sm">Password:</label>
                <input
                    v-model="forms.connectionPassword"
                    id="form-connectionPassword"
                    class="w-full border border-x6 bg-x0 px-2.5 py-2 text-xs outline-none"
                    placeholder="Password"
                    type="password"
                />
                <label for="form-databaseName" class="text-sm">Database name:</label>
                <input v-model="forms.databaseName" id="form-databaseName" class="w-full border border-x6 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="Database name" />
            </template>

            <Alert v-if="status.message" :severity="status.severity" small class="col-span-full">
                {{ status.message }}
            </Alert>

            <div class="col-span-full flex justify-end gap-2 mt-3">
                <Button severity="secondary" @click="servers.addForm.visible = false">Cancel</Button>
                <Button severity="secondary" @click="testConnection" :disabled="!canCreateConnection || tasks.testConnection.isRunning(isFileDriver ? 'source' : 'connection')">
                    {{ tasks.testConnection.isRunning(isFileDriver ? 'source' : 'connection') ? 'Testing...' : 'Test' }}
                </Button>
                <Button severity="primary" @click="createConnection" :disabled="!canCreateConnection || tasks.createConnection.isRunning(isFileDriver ? 'source' : 'connection')">
                    {{ tasks.createConnection.isRunning(isFileDriver ? 'source' : 'connection') ? 'Adding...' : 'Add' }}
                </Button>
            </div>
        </section>
    </CenteredModal>
</template>
