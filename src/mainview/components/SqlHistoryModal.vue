<script setup lang="ts">
import Button from '../../shared/components/Button.vue';
import CenteredModal from '../../shared/components/CenteredModal.vue';
import { useConnections } from '../composables/useConnections';
import { useSqlHistory, type SqlHistoryEntry } from '../composables/useSqlHistory';

const open = defineModel<boolean>('open', { default: false });
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
</script>

<template>
    <CenteredModal v-model:open="open" title="SQL History" content-class="max-w-3xl">
        <div class="max-h-[70vh] min-h-0 overflow-auto px-4 py-2 text-xs">
            <div v-if="!sqlHistory.entries.length" class="px-2 py-3 text-xs opacity-60">No queries have been executed yet.</div>
            <div v-for="entry in sqlHistory.entries" :key="entry.id" class="border-b border-x4 py-1.5">
                <div class="flex items-center gap-2">
                    <span class="shrink-0 opacity-60">{{ formatHistoryTime(entry.timestamp) }}</span>
                    <span class="shrink-0 px-1 border" :class="entry.status === 'error' ? 'border-red-400 text-red-300' : 'border-x6 text-green-400'">
                        {{ entry.status }}
                    </span>
                    <span class="shrink-0 px-1 border border-x6 opacity-70">{{ entry.source }}</span>
                    <span v-if="getHistoryConnectionLabel(entry)" class="truncate opacity-70">{{ getHistoryConnectionLabel(entry) }}</span>
                    <span v-if="typeof entry.durationMs === 'number'" class="ml-auto shrink-0 opacity-50">{{ entry.durationMs }}ms</span>
                </div>
                <pre class="whitespace-pre-wrap wrap-break-word pt-1 leading-5 text-white/85">{{ entry.sql }}</pre>
                <div v-if="entry.errorMessage" class="pt-0.5 text-red-300">{{ entry.errorMessage }}</div>
            </div>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
            <Button severity="secondary" smaller @click="open = false"> Close </Button>
        </div>
    </CenteredModal>
</template>
