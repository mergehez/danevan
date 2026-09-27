import { component, ensureAllTsxProps, looseToNumber, prevented } from '#shared/utils/tsxHelpers.tsx';
import { computed, reactive, watch } from 'vue';
import { Alert } from '../../shared/components/Alert.tsx';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import type { ServerRecord } from '../../shared/types';
import { useServers } from '../composables/useServers';
import { tasks } from '../composables/useTasks';

type Props = {
    open: boolean;
    serverId?: number;
    onClose: () => void;
};

export const DbServerFormModal = component(
    (props: Props) => {
        const servers = useServers();

        const form = reactive({
            name: '',
            filePath: '',
            host: '',
            port: '' as '' | number,
        });

        const status = reactive({
            message: '',
        });

        const server = computed<ServerRecord | undefined>(() => servers.servers.find((entry) => entry.id === props.serverId));
        const isFileServer = computed(() => server.value?.kind === 'file');
        const isSubmitting = computed(() => tasks.updateServer.isRunning());
        const title = computed(() => (isFileServer.value ? 'Update Source' : 'Update Server'));
        const subtitle = computed(() => {
            if (!server.value) {
                return '';
            }

            return isFileServer.value ? `${server.value.driver.toUpperCase()} file source` : `${server.value.driver.toUpperCase()} server`;
        });
        const canSubmit = computed(() => {
            if (!server.value || !form.name.trim()) {
                return false;
            }

            if (isFileServer.value) {
                return Boolean(form.filePath.trim());
            }

            return Boolean(form.host.trim());
        });

        watch(
            [() => props.open, server],
            ([isOpen, currentServer]) => {
                if (!isOpen || !currentServer) {
                    return;
                }

                form.name = currentServer.name;
                form.filePath = currentServer.file_path || '';
                form.host = currentServer.host || '';
                form.port = currentServer.port ?? '';
                status.message = '';
            },
            { immediate: true }
        );

        function closeModal() {
            status.message = '';
            props.onClose();
        }

        async function pickDatabaseFile() {
            const filePath = await tasks.pickDatabaseFile.run({
                defaultPath: form.filePath || server.value?.file_path,
            });

            if (filePath) {
                form.filePath = filePath;
            }
        }

        async function submit() {
            if (!server.value || !canSubmit.value || isSubmitting.value) {
                return;
            }

            status.message = '';

            try {
                await servers.updateServer(server.value.id, {
                    name: form.name.trim(),
                    kind: server.value.kind,
                    driver: server.value.driver,
                    filePath: isFileServer.value ? form.filePath.trim() : undefined,
                    host: isFileServer.value ? undefined : form.host.trim() || undefined,
                    port: isFileServer.value ? undefined : typeof form.port === 'number' ? form.port : undefined,
                    username: undefined,
                    password: undefined,
                });

                closeModal();
            } catch (error) {
                status.message = error instanceof Error ? error.message : String(error);
            }
        }

        function onModalOpenChange(nextOpen: boolean) {
            if (!nextOpen) {
                closeModal();
            }
        }

        return () => (
            <CenteredModal open={props.open} title={title.value} contentClass="max-w-xl" onOpenChange={onModalOpenChange}>
                <form onSubmit={prevented(submit)} class="space-y-4 px-4 py-4">
                    <div class="space-y-1">
                        <div class="text-2xs uppercase tracking-[0.18em] opacity-60">{subtitle.value}</div>
                        <p class="text-xs opacity-70">Update this {isFileServer.value ? 'source' : 'server'} without changing its driver or type.</p>
                    </div>
                    <div class="space-y-3">
                        <label class="block space-y-1">
                            <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Name</span>
                            <input
                                value={form.name}
                                onInput={(e: any) => (form.name = e.target.value)}
                                placeholder={isFileServer.value ? 'Source name' : 'Server name'}
                                class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                            />
                        </label>
                        {isFileServer.value ? (
                            <label class="block space-y-1">
                                <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Database File</span>
                                <div class="flex gap-2">
                                    <input
                                        value={form.filePath}
                                        onInput={(e: any) => (form.filePath = e.target.value)}
                                        placeholder="/path/to/database.sqlite"
                                        class="min-w-0 flex-1 border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                    />
                                    <Button type="button" severity="secondary" smaller={true} onClick={pickDatabaseFile}>
                                        Browse
                                    </Button>
                                </div>
                            </label>
                        ) : (
                            <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                                <label class="block space-y-1">
                                    <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Host</span>
                                    <input
                                        value={form.host}
                                        onInput={(e: any) => (form.host = e.target.value)}
                                        placeholder="Host"
                                        class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                    />
                                </label>
                                <label class="block space-y-1">
                                    <span class="text-2xs uppercase tracking-[0.18em] opacity-60">Port</span>
                                    <input
                                        value={form.port}
                                        onInput={(e: any) => (form.port = looseToNumber(e.target.value))}
                                        inputmode="numeric"
                                        min="1"
                                        max="65535"
                                        placeholder="Port"
                                        type="number"
                                        class="w-full border border-x4 bg-x0 px-2.5 py-2 text-xs outline-none"
                                    />
                                </label>
                            </div>
                        )}
                    </div>
                    {status.message ? (
                        <Alert severity="danger" small={true}>
                            {status.message}
                        </Alert>
                    ) : null}
                    <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                        <Button type="button" severity="secondary" smaller={true} onClick={closeModal}>
                            Cancel
                        </Button>
                        <Button type="submit" severity="primary" smaller={true} disabled={!canSubmit.value || isSubmitting.value}>
                            {isSubmitting.value ? 'Saving...' : 'Update'}
                        </Button>
                    </div>
                </form>
            </CenteredModal>
        );
    },
    { name: 'DbServerFormModal', props: ensureAllTsxProps<Props>()(['open', 'serverId', 'onClose']) }
);

export default DbServerFormModal;
