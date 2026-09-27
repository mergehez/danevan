import { ref, computed, reactive, watch } from 'vue';
import { Alert } from '../../shared/components/Alert.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import type { MysqldumpExportOptions } from '../../shared/types';
import { useConnections } from '../composables/useConnections';
import { tasks } from '../composables/useTasks';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    open: boolean;
    connectionId?: number;
    onClose: () => void;
};

export const DbMysqldumpExportModal = component(
    (props: Props) => {
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

        return () => (
            <CenteredModal open={props.open} title={title.value} contentClass="max-w-2xl" onOpenChange={onModalOpenChange}>
                <div class="flex flex-col gap-4 px-4 py-4">
                    <div class="space-y-1">
                        <div class="text-2xs uppercase tracking-[0.18em] opacity-60">{connection.value?.name || 'Connection'}</div>
                        <p class="text-xs opacity-70">Dump a MySQL database to a local SQL file using mysqldump.</p>
                    </div>
                    <div class="space-y-3">
                        <label class="block space-y-1">
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Path to executable</span>
                            <div class="flex gap-2">
                                <input
                                    value={form.executable}
                                    onInput={(e: any) => (form.executable = e.target.value)}
                                    placeholder="/path/to/mysqldump"
                                    class="min-w-0 flex-1 border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                />
                                <IconButton
                                    severity="secondary"
                                    smaller={true}
                                    icon="icon-[mdi--folder-open-outline]"
                                    v-tooltip={'Browse'}
                                    disabled={loadingDefaults.value}
                                    onClick={pickExecutable}
                                />
                            </div>
                        </label>
                        <label class="block space-y-1">
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Output result to</span>
                            <div class="flex gap-2">
                                <input
                                    value={form.outputPath}
                                    onInput={(e: any) => (form.outputPath = e.target.value)}
                                    placeholder="/path/to/dump.sql"
                                    class="min-w-0 flex-1 border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                />
                                <IconButton
                                    severity="secondary"
                                    smaller={true}
                                    icon="icon-[mdi--folder-outline]"
                                    v-tooltip={'Save to...'}
                                    disabled={loadingDefaults.value}
                                    onClick={pickOutputPath}
                                />
                            </div>
                            <span class="block pt-1 text-2xs opacity-50">Allowed substitution patterns: (timestamp), (database), (data_source), (database)</span>
                        </label>
                    </div>
                    <div class="space-y-3">
                        <div class="text-2xs uppercase tracking-[0.18em] opacity-60">Options</div>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                            <label class="block space-y-1">
                                <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Databases to dump</span>
                                <input
                                    value={form.databases}
                                    onInput={(e: any) => (form.databases = e.target.value)}
                                    placeholder="database_name"
                                    class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                />
                            </label>
                            <label class="block space-y-1">
                                <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Tables to dump</span>
                                <input
                                    value={form.tables}
                                    onInput={(e: any) => (form.tables = e.target.value)}
                                    placeholder="table1 table2"
                                    class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                />
                            </label>
                        </div>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-1 border border-x3 bg-x2 p-3">
                            {optionDefinitions.map((option) => (
                                <label class="flex items-center gap-2 text-xs" key={option.key}>
                                    <input
                                        value={form.options[option.key]}
                                        onInput={(e: any) => (form.options[option.key] = e.target.value)}
                                        type="checkbox"
                                        class="size-4 border border-x4 bg-x1"
                                    />
                                    <span class="min-w-0 flex-1">{option.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                    {status.message ? (
                        <Alert severity={status.success ? 'success' : 'danger'} small={true} class="flex flex-col gap-2 justify-start">
                            <div>{status.message}</div>
                            {status.success ? (
                                <div class="w-full flex items-center gap-2">
                                    <Button type="button" severity="secondary" smaller={true} onClick={openFolder}>
                                        Open the folder
                                    </Button>
                                    <Button type="button" severity="secondary" smaller={true} onClick={openInVsCode}>
                                        Open in VS Code
                                    </Button>
                                </div>
                            ) : null}
                        </Alert>
                    ) : null}
                    <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                        <Button type="button" severity="secondary" smaller={true} disabled={isRunning.value} onClick={closeModal}>
                            Cancel
                        </Button>
                        <Button type="button" severity="primary" smaller={true} disabled={!canRun.value} onClick={run}>
                            {isRunning.value ? 'Running...' : 'Run'}
                        </Button>
                    </div>
                </div>
            </CenteredModal>
        );
    },
    { name: 'DbMysqldumpExportModal', props: ensureAllTsxProps<Props>()(['open', 'connectionId', 'onClose']) }
);

export default DbMysqldumpExportModal;
