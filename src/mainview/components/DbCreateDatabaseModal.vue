<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from '../../shared/components/Button.vue';
import CenteredModal from '../../shared/components/CenteredModal.vue';
import Input from '../../shared/components/Input.vue';
import { _dbCoreState } from '../composables/dbCoreState';
import { useServers } from '../composables/useServers';
import { tasks } from '../composables/useTasks';

const props = defineProps<{
    open: boolean;
    serverId: number;
    onClose?: () => void;
}>();

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
</script>

<template>
    <CenteredModal :open="props.open" title="Create database" content-class="max-w-md" @update:open="handleOpenChange">
        <div class="space-y-3 px-4 py-4 text-xs">
            <label class="block">
                <span class="mb-1 block text-xs opacity-70">Database name</span>
                <Input v-model="databaseName" small placeholder="mydatabase" @keydown.enter.prevent="submit" />
            </label>
            <label v-if="supportsCollation" class="block">
                <span class="mb-1 block text-xs opacity-70">Collation</span>
                <Input v-model="collation" small placeholder="utf8mb4_unicode_ci" @keydown.enter.prevent="submit" />
            </label>
            <p v-if="errorMessage" class="text-xs text-red-300">{{ errorMessage }}</p>
        </div>
        <div class="flex items-center justify-end gap-2 border-t border-x3 px-4 py-3">
            <Button severity="secondary" smaller :disabled="isSubmitting" @click="handleOpenChange(false)">Cancel</Button>
            <Button severity="primary" smaller :disabled="!canSubmit" @click="submit">
                {{ isSubmitting ? 'Creating...' : 'Create' }}
            </Button>
        </div>
    </CenteredModal>
</template>
