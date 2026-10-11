import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Alert, type TAlertSeverity } from '../../shared/components/Alert.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import type { RunSqlScriptDefaults, RunSqlScriptStatus } from '../../shared/types';
import { useConnections } from '../composables/useConnections';
import { tasks } from '../composables/useTasks';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    open: boolean;
    connectionId?: number;
    scriptPath?: string;
    onClose: () => void;
};

type Phase = 'confirm' | 'running' | 'done';

const POLL_INTERVAL_MS = 350;

function formatFileSize(size: number) {
    if (!Number.isFinite(size) || size < 0) {
        return 'unknown size';
    }

    if (size < 1024) {
        return `${size} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(durationMs: number) {
    return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

export const DbRunSqlScriptModal = component(
    (props: Props) => {
        const connections = useConnections();

        const defaults = ref<RunSqlScriptDefaults | undefined>();
        const isLoadingDefaults = ref(false);
        const phase = ref<Phase>('confirm');
        const output = ref('');
        const outputOffset = ref(0);
        const result = ref<RunSqlScriptStatus | undefined>();
        const outcome = ref<{ severity: TAlertSeverity; message: string } | undefined>();
        const activeRunId = ref<string | undefined>();

        let pollTimer: ReturnType<typeof setTimeout> | undefined;

        const isRunning = computed(() => phase.value === 'running');
        const canRun = computed(() => Boolean(defaults.value) && phase.value === 'confirm');

        function stopPolling() {
            if (pollTimer !== undefined) {
                clearTimeout(pollTimer);
                pollTimer = undefined;
            }
        }

        function reset() {
            stopPolling();
            defaults.value = undefined;
            isLoadingDefaults.value = false;
            phase.value = 'confirm';
            output.value = '';
            outputOffset.value = 0;
            result.value = undefined;
            outcome.value = undefined;
            activeRunId.value = undefined;
        }

        watch(
            [() => props.open, () => props.connectionId, () => props.scriptPath],
            async ([isOpen, connectionId, scriptPath]) => {
                if (!isOpen || typeof connectionId !== 'number' || !scriptPath) {
                    return;
                }

                // The dialog can be closed and reopened for another file or connection before this
                // answers; the confirmation must describe the run the user is looking at.
                const isCurrent = () => props.open && props.connectionId === connectionId && props.scriptPath === scriptPath;

                reset();
                isLoadingDefaults.value = true;

                try {
                    const nextDefaults = await tasks.getRunSqlScriptDefaults.run({ connectionId, filePath: scriptPath });

                    if (!isCurrent()) {
                        return;
                    }

                    defaults.value = nextDefaults;
                } catch (error) {
                    if (!isCurrent()) {
                        return;
                    }

                    phase.value = 'done';
                    outcome.value = { severity: 'danger', message: error instanceof Error ? error.message : String(error) };
                } finally {
                    if (isCurrent()) {
                        isLoadingDefaults.value = false;
                    }
                }
            },
            { immediate: true }
        );

        function fail(error: unknown) {
            phase.value = 'done';
            outcome.value = { severity: 'danger', message: error instanceof Error ? error.message : String(error) };
        }

        async function pollRun() {
            const runId = activeRunId.value;

            if (!runId) {
                return;
            }

            try {
                const status = await tasks.getRunSqlScriptStatus.run({ runId, offset: outputOffset.value });

                if (status.outputChunk) {
                    output.value += status.outputChunk;
                }

                outputOffset.value = status.nextOffset;
                result.value = status;

                if (status.status === 'running') {
                    pollTimer = setTimeout(() => void pollRun(), POLL_INTERVAL_MS);
                    return;
                }

                activeRunId.value = undefined;
                phase.value = 'done';
                outcome.value =
                    status.status === 'succeeded'
                        ? { severity: 'secondary', message: `Script finished successfully in ${formatDuration(status.durationMs)}.` }
                        : { severity: 'danger', message: status.error || 'The script failed.' };
            } catch (error) {
                activeRunId.value = undefined;
                fail(error);
            }
        }

        async function runScript() {
            const connectionId = props.connectionId;

            if (typeof connectionId !== 'number' || !props.scriptPath || !defaults.value) {
                return;
            }

            phase.value = 'running';
            output.value = '';
            outputOffset.value = 0;
            result.value = undefined;
            outcome.value = undefined;

            try {
                const started = await tasks.startRunSqlScript.run({
                    connectionId,
                    filePath: props.scriptPath,
                    executable: defaults.value.executable,
                });

                activeRunId.value = started.runId;
                void pollRun();
            } catch (error) {
                fail(error);
            }
        }

        async function cancelRun() {
            const runId = activeRunId.value;
            stopPolling();
            activeRunId.value = undefined;
            phase.value = 'done';
            outcome.value = { severity: 'warning', message: 'The script run was cancelled.' };

            if (runId) {
                await tasks.stopRunSqlScript.run({ runId });
            }
        }

        // Closing ends the dialog: a script that is still running is stopped instead
        // of being left behind in the backend.
        function closeModal() {
            const runId = activeRunId.value;
            activeRunId.value = undefined;
            reset();
            props.onClose();

            if (runId) {
                void tasks.stopRunSqlScript.run({ runId }).catch(() => undefined);
            }
        }

        function onModalOpenChange(nextOpen: boolean) {
            if (!nextOpen) {
                closeModal();
            }
        }

        onBeforeUnmount(() => {
            const runId = activeRunId.value;
            stopPolling();

            if (runId) {
                void tasks.stopRunSqlScript.run({ runId }).catch(() => undefined);
            }
        });

        // Only the built-in driver runner reports statement counts; the mysql client
        // just streams its output.
        const statementProgress = computed(() => {
            const run = result.value;

            if (!run?.statementCount) {
                return '';
            }

            return `${run.completedStatements ?? 0} of ${run.statementCount}`;
        });

        return () => (
            <CenteredModal open={props.open} title="Run SQL script" contentClass="max-w-xl" onOpenChange={onModalOpenChange}>
                <div class="flex flex-col gap-4 px-4 py-4 text-xs">
                    <div class="space-y-1">
                        <div class="text-2xs uppercase tracking-[0.18em] opacity-60">
                            {defaults.value?.dataSource || connections.connections.find((entry) => entry.id === props.connectionId)?.name || 'Connection'}
                        </div>
                        <p class="opacity-70">Run a SQL script file against the selected database.</p>
                    </div>
                    {isLoadingDefaults.value ? <p class="opacity-70">Preparing...</p> : null}
                    {defaults.value ? (
                        <div class="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 border border-x3 bg-x2 p-3">
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Script</span>
                            <span class="min-w-0 break-all">{defaults.value.scriptName}</span>
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Size</span>
                            <span>{formatFileSize(defaults.value.scriptSize)}</span>
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Target database</span>
                            <span class="font-semibold">{defaults.value.database}</span>
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Runner</span>
                            <span class="min-w-0 break-all">{defaults.value.runner === 'client' ? `mysql client (${defaults.value.executable})` : 'built-in driver'}</span>
                        </div>
                    ) : null}
                    {phase.value !== 'confirm' ? (
                        <div class="space-y-1">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Output</span>
                                {isRunning.value ? (
                                    <span class="flex items-center gap-1.5 text-2xs opacity-60">
                                        <span class="icon icon-[mdi--loading] animate-spin" />
                                        <span>{statementProgress.value || 'Running...'}</span>
                                    </span>
                                ) : null}
                            </div>
                            <pre class="max-h-64 min-h-24 overflow-auto border border-x3 bg-x0 p-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap">
                                {output.value || (isRunning.value ? 'Waiting for output...' : 'The runner produced no output.')}
                            </pre>
                        </div>
                    ) : null}
                    {outcome.value ? (
                        <Alert severity={outcome.value.severity} small={true}>
                            {outcome.value.message}
                        </Alert>
                    ) : null}
                    <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                        {phase.value === 'confirm' ? (
                            <>
                                <Button type="button" severity="secondary" smaller={true} disabled={isLoadingDefaults.value} onClick={closeModal}>
                                    Cancel
                                </Button>
                                <Button type="button" severity="primary" smaller={true} disabled={!canRun.value} onClick={runScript}>
                                    Run script
                                </Button>
                            </>
                        ) : isRunning.value ? (
                            <Button type="button" severity="secondary" smaller={true} onClick={cancelRun}>
                                Cancel run
                            </Button>
                        ) : (
                            <Button type="button" severity="secondary" smaller={true} onClick={closeModal}>
                                Close
                            </Button>
                        )}
                    </div>
                </div>
            </CenteredModal>
        );
    },
    { name: 'DbRunSqlScriptModal', props: ensureAllTsxProps<Props>()(['open', 'connectionId', 'scriptPath', 'onClose']) }
);

export default DbRunSqlScriptModal;
