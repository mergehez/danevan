<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Alert from '../../shared/components/Alert.vue';
import Button from '../../shared/components/Button.vue';
import CenteredModal from '../../shared/components/CenteredModal.vue';
import IconButton from '../../shared/components/IconButton.vue';
import type { MysqldumpExportOptions } from '../../shared/types';
import { useConnections } from '../composables/useConnections';
import { tasks } from '../composables/useTasks';

const props = defineProps<{
    open: boolean;
    connectionId?: number;
    onClose: () => void;
}>();

const connections = useConnections();

const form = reactive({
    executable: '',
    outputPath: '',
    databases: '',
    tables: '',
    options: {
        addDropTable: true,
        disableKeys: true,
        addLocks: false,
        addDropTrigger: false,
        exportSchemaOnly: false,
        completeInsert: false,
        includeTableOptions: true,
        includeRoutines: false,
        lockTables: false,
        insertDelayed: false,
    } as MysqldumpExportOptions,
});

const optionDefinitions = [
    { key: 'addDropTable', label: 'Add DROP TABLE before CREATE...' },
    { key: 'disableKeys', label: 'Add DISABLE KEYS before each I...' },
    { key: 'addLocks', label: 'Add LOCK TABLES before each tabl...' },
    { key: 'addDropTrigger', label: 'Add DROP TRIGGER before CREATE T...' },
    { key: 'exportSchemaOnly', label: 'Export schema without data' },
    { key: 'completeInsert', label: 'Include column names in each INSERT...' },
    { key: 'includeTableOptions', label: 'Include all table options in CREATE T...' },
    { key: 'includeRoutines', label: 'Include stored routines in the dump' },
    { key: 'lockTables', label: 'Lock all tables for the duration of exp...' },
    { key: 'insertDelayed', label: 'Use INSERT DELAYED (up to MySQL ...)' },
] as const;

const status = reactive({ message: '', success: false, outputPath: '' });
const loadingDefaults = ref(false);

const connection = computed(() => connections.connections.find((entry) => entry.id === props.connectionId));
const title = computed(() => 'Export with mysqldump...');
const isRunning = computed(() => tasks.exportWithMysqldump.isRunning());
const canRun = computed(() => Boolean(form.executable.trim() && form.databases.trim() && form.outputPath.trim()) && !isRunning.value);

watch(
    [() => props.open, () => props.connectionId],
    async ([isOpen, connectionId]) => {
        if (!isOpen || typeof connectionId !== 'number') {
            return;
        }

        status.message = '';
        status.success = false;
        loadingDefaults.value = true;

        try {
            const defaults = await tasks.getMysqldumpExportDefaults.run({ connectionId });
            form.executable = defaults.executable ?? '';
            form.outputPath = defaults.defaultOutputPath;
            form.databases = defaults.database;
            form.tables = '';
        } catch (error) {
            status.message = error instanceof Error ? error.message : String(error);
        } finally {
            loadingDefaults.value = false;
        }
    },
    { immediate: true }
);

function closeModal() {
    props.onClose();
}

async function pickExecutable() {
    const executable = await tasks.pickDatabaseFile.run({ defaultPath: form.executable });
    if (executable) {
        form.executable = executable;
    }
}

async function pickOutputPath() {
    const outputPath = await tasks.pickSavePath.run({ defaultPath: form.outputPath });
    if (outputPath) {
        form.outputPath = outputPath;
    }
}

async function run() {
    if (!canRun.value || typeof props.connectionId !== 'number') {
        return;
    }

    status.message = '';
    status.success = false;
    status.outputPath = '';

    try {
        const result = await tasks.exportWithMysqldump.run({
            connectionId: props.connectionId,
            executable: form.executable.trim(),
            outputPath: form.outputPath.trim(),
            databases: form.databases.trim(),
            tables: form.tables.trim() || undefined,
            options: { ...form.options },
        });

        status.success = true;
        status.message = `Export written to ${result.outputPath}`;
        status.outputPath = result.outputPath;
    } catch (error) {
        status.message = error instanceof Error ? error.message : String(error);
    }
}

function onModalOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
        closeModal();
    }
}

async function openFolder() {
    if (status.outputPath) {
        await tasks.revealPathInFileManager.run({ path: status.outputPath, mode: 'reveal-item' });
    }
}

async function openInVsCode() {
    if (status.outputPath) {
        await tasks.openFileInEditor.run({ path: status.outputPath });
    }
}
</script>

<template>
    <CenteredModal :open="props.open" :title="title" contentClass="max-w-2xl" @update:open="onModalOpenChange">
        <div class="flex flex-col gap-4 px-4 py-4">
            <div class="space-y-1">
                <div class="text-2xs uppercase tracking-[0.18em] opacity-60">{{ connection?.name || 'Connection' }}</div>
                <p class="text-xs opacity-70">Dump a MySQL database to a local SQL file using mysqldump.</p>
            </div>

            <div class="space-y-3">
                <label class="block space-y-1">
                    <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Path to executable</span>
                    <div class="flex gap-2">
                        <input v-model="form.executable" class="min-w-0 flex-1 border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="/path/to/mysqldump" />
                        <IconButton severity="secondary" smaller icon="icon-[mdi--folder-open-outline]" v-tooltip="'Browse'" :disabled="loadingDefaults" @click="pickExecutable" />
                    </div>
                </label>

                <label class="block space-y-1">
                    <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Output result to</span>
                    <div class="flex gap-2">
                        <input v-model="form.outputPath" class="min-w-0 flex-1 border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="/path/to/dump.sql" />
                        <IconButton severity="secondary" smaller icon="icon-[mdi--folder-outline]" v-tooltip="'Save to...'" :disabled="loadingDefaults" @click="pickOutputPath" />
                    </div>
                    <span class="block pt-1 text-2xs opacity-50">Allowed substitution patterns: (timestamp), (database), (data_source), (database)</span>
                </label>
            </div>

            <div class="space-y-3">
                <div class="text-2xs uppercase tracking-[0.18em] opacity-60">Options</div>

                <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                    <label class="block space-y-1">
                        <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Databases to dump</span>
                        <input v-model="form.databases" class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="database_name" />
                    </label>

                    <label class="block space-y-1">
                        <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Tables to dump</span>
                        <input v-model="form.tables" class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none" placeholder="table1 table2" />
                    </label>
                </div>

                <div class="grid grid-cols-2 gap-x-4 gap-y-1 border border-x3 bg-x2 p-3">
                    <label v-for="option in optionDefinitions" :key="option.key" class="flex items-center gap-2 text-xs">
                        <input v-model="form.options[option.key]" type="checkbox" class="size-4 border border-x4 bg-x1" />
                        <span class="min-w-0 flex-1">{{ option.label }}</span>
                    </label>
                </div>
            </div>

            <Alert v-if="status.message" :severity="status.success ? 'success' : 'danger'" small class="flex flex-col gap-2 justify-start">
                <div>{{ status.message }}</div>

                <div v-if="status.success" class="w-full flex items-center gap-2">
                    <Button type="button" severity="secondary" smaller @click="openFolder">Open the folder</Button>
                    <Button type="button" severity="secondary" smaller @click="openInVsCode">Open in VS Code</Button>
                </div>
            </Alert>

            <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                <Button type="button" severity="secondary" smaller :disabled="isRunning" @click="closeModal">Cancel</Button>
                <Button type="button" severity="primary" smaller :disabled="!canRun" @click="run">
                    {{ isRunning ? 'Running...' : 'Run' }}
                </Button>
            </div>
        </div>
    </CenteredModal>
</template>
