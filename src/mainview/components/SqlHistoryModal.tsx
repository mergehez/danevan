import { computed } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { useConnections } from '../composables/useConnections';
import { useSqlHistory, type SqlHistoryEntry } from '../composables/useSqlHistory';
import { component, ensureAllTsxProps, vModel, tsxWithDefaults } from '#shared/utils/tsxHelpers.tsx';

type Props = {} & {
    open?: boolean;
    onOpenChange?: (val: boolean) => unknown;
};

export const SqlHistoryModal = component(
    (_props: Props) => {
        const props = tsxWithDefaults(_props, { open: false });
        const open = computed({
            get: () => props.open,
            set: (value) => props.onOpenChange?.(value),
        });

        const sqlHistory = useSqlHistory();
        const connections = useConnections();

        function formatHistoryTime(timestamp: number) {
            return new Date(timestamp).toLocaleTimeString();
        }

        function getHistoryConnectionLabel(entry: SqlHistoryEntry) {
            if (entry.connectionLabel) {
                return entry.connectionLabel;
            }

            if (typeof entry.connectionId === 'number') {
                const connection = connections.connections.find((item) => item.id === entry.connectionId);
                return connection?.database_name || connection?.name || '';
            }

            return '';
        }

        return () => (
            <CenteredModal {...vModel(open, 'value', 'open')} title="SQL History" contentClass="max-w-3xl">
                <div class="max-h-[70vh] min-h-0 overflow-auto px-4 py-2 text-xs">
                    {!sqlHistory.entries.length ? <div class="px-2 py-3 text-xs opacity-60">No queries have been executed yet.</div> : null}
                    {sqlHistory.entries.map((entry) => (
                        <div class="border-b border-x4 py-1.5" key={entry.id}>
                            <div class="flex items-center gap-2">
                                <span class="shrink-0 opacity-60">{formatHistoryTime(entry.timestamp)}</span>
                                <span class={['shrink-0 px-1 border', entry.status === 'error' ? 'border-red-400 text-red-300' : 'border-x6 text-green-400']}>{entry.status}</span>
                                <span class="shrink-0 px-1 border border-x6 opacity-70">{entry.source}</span>
                                {getHistoryConnectionLabel(entry) ? <span class="truncate opacity-70">{getHistoryConnectionLabel(entry)}</span> : null}
                                {typeof entry.durationMs === 'number' ? <span class="ml-auto shrink-0 opacity-50">{entry.durationMs}ms</span> : null}
                            </div>
                            <pre class="whitespace-pre-wrap wrap-break-word pt-1 leading-5 text-white/85">{entry.sql}</pre>
                            {entry.errorMessage ? <div class="pt-0.5 text-red-300">{entry.errorMessage}</div> : null}
                        </div>
                    ))}
                </div>
                <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
                    <Button severity="secondary" smaller={true} onClick={() => (open.value = false)}>
                        {' '}
                        Close{' '}
                    </Button>
                </div>
            </CenteredModal>
        );
    },
    { name: 'SqlHistoryModal', props: ensureAllTsxProps<Props>()(['open', 'onOpenChange']) }
);

export default SqlHistoryModal;
