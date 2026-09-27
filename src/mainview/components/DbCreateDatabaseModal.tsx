import { ref, computed, withKeys } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { Input } from '../../shared/components/Input.tsx';
import { _dbCoreState } from '../composables/dbCoreState';
import { useServers } from '../composables/useServers';
import { tasks } from '../composables/useTasks';
import { component, ensureAllTsxProps, vModel, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    open: boolean;
    serverId: number;
    onClose?: () => void;
};

export const DbCreateDatabaseModal = component(
    (props: Props) => {
        const servers = useServers();
        const databaseName = ref('');
        const collation = ref('');
        const isSubmitting = ref(false);
        const errorMessage = ref('');

        const server = computed(() => servers.servers.find((entry) => entry.id === props.serverId));
        const driver = computed(() => server.value?.driver);
        const supportsCollation = computed(() => driver.value === 'mysql' || driver.value === 'sqlserver');
        const canSubmit = computed(() => Boolean(databaseName.value.trim()) && !isSubmitting.value);

        function resetForm() {
            databaseName.value = '';
            collation.value = '';
            errorMessage.value = '';
        }

        function handleOpenChange(nextOpen: boolean) {
            if (nextOpen) {
                return;
            }

            if (isSubmitting.value) {
                return;
            }

            resetForm();
            props.onClose?.();
        }

        async function submit() {
            if (!canSubmit.value || props.serverId <= 0) {
                return;
            }

            isSubmitting.value = true;
            errorMessage.value = '';

            try {
                const nextBootstrap = await tasks.createDatabase.run({
                    serverId: props.serverId,
                    databaseName: databaseName.value.trim(),
                    collation: supportsCollation.value ? collation.value.trim() || undefined : undefined,
                });
                _dbCoreState.applyBootstrap(nextBootstrap);
                resetForm();
                props.onClose?.();
            } catch (error) {
                errorMessage.value = error instanceof Error ? error.message : String(error);
            } finally {
                isSubmitting.value = false;
            }
        }

        return () => (
            <CenteredModal open={props.open} title="Create database" contentClass="max-w-md" onOpenChange={handleOpenChange}>
                <div class="space-y-3 px-4 py-4 text-xs">
                    <label class="block">
                        <span class="mb-1 block text-xs opacity-70">Database name</span>
                        <Input {...vModel(databaseName, 'value')} small={true} placeholder="mydatabase" onKeydown={prevented(withKeys(submit, ['enter']))} />
                    </label>
                    {supportsCollation.value ? (
                        <label class="block">
                            <span class="mb-1 block text-xs opacity-70">Collation</span>
                            <Input {...vModel(collation, 'value')} small={true} placeholder="utf8mb4_unicode_ci" onKeydown={prevented(withKeys(submit, ['enter']))} />
                        </label>
                    ) : null}
                    {errorMessage.value ? <p class="text-xs text-red-300">{errorMessage.value}</p> : null}
                </div>
                <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                    <Button severity="secondary" smaller={true} disabled={isSubmitting.value} onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button severity="primary" smaller={true} disabled={!canSubmit.value} onClick={submit}>
                        {isSubmitting.value ? 'Creating...' : 'Create'}
                    </Button>
                </div>
            </CenteredModal>
        );
    },
    { name: 'DbCreateDatabaseModal', props: ensureAllTsxProps<Props>()(['open', 'serverId', 'onClose']) }
);

export default DbCreateDatabaseModal;
