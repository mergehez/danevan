<script setup lang="ts">
import { useConnections } from '@composables/useConnections';
import { useServers } from '@composables/useServers';
import { useOverlaysState } from '@directives/useOverlaysState';
import Button from '@ui/Button.vue';
import type { ServerSchemaRecord } from '@utils/appClient';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
    refreshed: [];
}>();

const servers = useServers();
const connections = useConnections();

const schemas = ref<ServerSchemaRecord[]>([]);
const filterText = ref('');
const selectedSchemaNames = ref<string[]>([]);
const loading = ref(false);
const applying = ref(false);
const errorMessage = ref<string>();

const server = computed(() => servers.servers.find((server) => server.id === servers.schemaSelectionModal.serverId));
const visibleSchemaNames = computed(() => {
    const serverId = servers.schemaSelectionModal.serverId;

    if (typeof serverId !== 'number') {
        return [];
    }

    return connections.connections
        .filter((connection) => connection.server_id === serverId)
        .map((connection) => connection.database_name || connection.name)
        .filter((name): name is string => Boolean(name));
});
const normalizedVisibleSchemaNames = computed(() => [...new Set(visibleSchemaNames.value.filter(Boolean))].sort((left, right) => left.localeCompare(right)));
const availableSchemas = computed(() => {
    const schemaNames = new Set(schemas.value.map((schema) => schema.name));

    for (const visibleSchemaName of normalizedVisibleSchemaNames.value) {
        schemaNames.add(visibleSchemaName);
    }

    return [...schemaNames].sort((left, right) => left.localeCompare(right)).map((name) => ({ name }) satisfies ServerSchemaRecord);
});
const filteredSchemas = computed(() => {
    const normalizedFilter = filterText.value.trim().toLowerCase();

    if (!normalizedFilter) {
        return availableSchemas.value;
    }

    return availableSchemas.value.filter((schema) => schema.name.toLowerCase().includes(normalizedFilter));
});
const hasPendingChanges = computed(() => {
    if (selectedSchemaNames.value.length !== normalizedVisibleSchemaNames.value.length) {
        return true;
    }

    return selectedSchemaNames.value.some((schemaName, index) => schemaName !== normalizedVisibleSchemaNames.value[index]);
});
const allFilteredSelected = computed(() => filteredSchemas.value.length > 0 && filteredSchemas.value.every((schema) => selectedSchemaNames.value.includes(schema.name)));
const someFilteredSelected = computed(() => filteredSchemas.value.some((schema) => selectedSchemaNames.value.includes(schema.name)));
const modalTitle = computed(() => `${selectedSchemaNames.value.length} Connections`);
const overlayState = useOverlaysState();
const popoverZIndex = ref(90);
const popoverRef = ref<HTMLElement>();
const popoverStyle = computed(() => {
    const minWidth = Math.max(servers.schemaSelectionModal.anchorWidth, 220);
    const maxWidth = Math.min(420, window.innerWidth - 24);
    const width = Math.min(Math.max(minWidth, 260), maxWidth);
    const left = Math.min(servers.schemaSelectionModal.anchorLeft, Math.max(window.innerWidth - width - 12, 12));
    const top = Math.min(servers.schemaSelectionModal.anchorTop, Math.max(window.innerHeight - 24, 24));

    return {
        left: `${Math.max(left, 12)}px`,
        top: `${Math.max(top, 12)}px`,
        width: `${width}px`,
    };
});

watch(
    [open, () => server.value?.id],
    async ([isOpen, serverId]) => {
        if (!isOpen || typeof serverId !== 'number') {
            return;
        }

        await loadSchemas();
        selectedSchemaNames.value = [...normalizedVisibleSchemaNames.value];

        if (!schemas.value.length && server.value?.kind === 'server') {
            await refreshSchemas();
        }
    },
    { immediate: true }
);

watch(open, (isOpen) => {
    popoverZIndex.value = isOpen ? overlayState.claimZIndex() : overlayState.releaseZIndex(popoverZIndex.value);

    if (isOpen) {
        servers.updateSchemaSelectionModalPosition();
        window.addEventListener('resize', handleWindowGeometryChange);
        window.addEventListener('scroll', handleWindowGeometryChange, true);
        document.addEventListener('pointerdown', handleDocumentPointerDown, true);
        document.addEventListener('keydown', handleDocumentKeydown);
        return;
    }

    window.removeEventListener('resize', handleWindowGeometryChange);
    window.removeEventListener('scroll', handleWindowGeometryChange, true);
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    document.removeEventListener('keydown', handleDocumentKeydown);
});

watch(
    () => visibleSchemaNames.value,
    () => {
        if (!open.value || hasPendingChanges.value) {
            return;
        }

        selectedSchemaNames.value = [...normalizedVisibleSchemaNames.value];
    },
    { deep: true }
);

async function loadSchemas() {
    if (!server.value) {
        schemas.value = [];
        return;
    }

    loading.value = true;
    errorMessage.value = undefined;

    try {
        schemas.value = await servers.ensureServerSchemas(server.value.id);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        loading.value = false;
    }
}

async function refreshSchemas() {
    if (!server.value) {
        return;
    }

    loading.value = true;
    errorMessage.value = undefined;

    try {
        schemas.value = await servers.refreshServerSchemas(server.value.id);
        emit('refreshed');
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        loading.value = false;
    }
}

function toggleSchema(schemaName: string) {
    if (selectedSchemaNames.value.includes(schemaName)) {
        selectedSchemaNames.value = selectedSchemaNames.value.filter((name) => name !== schemaName);
        return;
    }

    selectedSchemaNames.value = [...selectedSchemaNames.value, schemaName].sort((left, right) => left.localeCompare(right));
}

function toggleAllFilteredSchemas() {
    if (!filteredSchemas.value.length) {
        return;
    }

    if (allFilteredSelected.value) {
        const filteredSchemaNames = new Set(filteredSchemas.value.map((schema) => schema.name));
        selectedSchemaNames.value = selectedSchemaNames.value.filter((schemaName) => !filteredSchemaNames.has(schemaName));
        return;
    }

    selectedSchemaNames.value = [...new Set([...selectedSchemaNames.value, ...filteredSchemas.value.map((schema) => schema.name)])].sort((left, right) =>
        left.localeCompare(right)
    );
}

async function applySchemaSelection() {
    if (!server.value) {
        return;
    }

    applying.value = true;
    errorMessage.value = undefined;

    try {
        await connections.setVisibleServerSchemas(server.value.id, selectedSchemaNames.value);
        emit('refreshed');
        open.value = false;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
        applying.value = false;
    }
}

async function onOpenChange(nextOpen: boolean) {
    if (nextOpen) {
        open.value = true;
        return;
    }

    if (applying.value) {
        return;
    }

    if (hasPendingChanges.value) {
        await applySchemaSelection();
        return;
    }

    servers.closeSchemaSelectionModal();
    open.value = false;
}

function handleWindowGeometryChange() {
    if (!open.value) {
        return;
    }

    servers.updateSchemaSelectionModalPosition();
}

function isWithinAnchor(target: EventTarget | null) {
    const anchorElement = servers.schemaSelectionModal.anchorElement;

    return target instanceof Node && !!anchorElement?.contains(target);
}

function handleDocumentPointerDown(event: PointerEvent) {
    if (!open.value) {
        return;
    }

    if (popoverRef.value?.contains(event.target as Node) || isWithinAnchor(event.target)) {
        return;
    }

    void onOpenChange(false);
}

function handleDocumentKeydown(event: KeyboardEvent) {
    if (!open.value) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        void onOpenChange(false);
    }
}

onBeforeUnmount(() => {
    window.removeEventListener('resize', handleWindowGeometryChange);
    window.removeEventListener('scroll', handleWindowGeometryChange, true);
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
    <Teleport to="body">
        <div
            v-if="open"
            ref="popoverRef"
            class="fixed overflow-hidden border border-x4 bg-x1 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
            :style="{ ...popoverStyle, zIndex: popoverZIndex }"
        >
            <div class="flex items-center gap-2 border-b border-x3 px-3 py-2">
                <div class="min-w-0 flex-1">
                    <div class="text-2xs uppercase tracking-[0.2em] opacity-60">
                        {{ modalTitle }}
                    </div>
                    <div class="text-xs opacity-80">{{ server?.name || 'Server' }}</div>
                </div>
                <Button severity="secondary" smaller :disabled="loading || applying" @click="refreshSchemas">
                    {{ loading ? 'Refreshing...' : 'Refresh' }}
                </Button>
            </div>

            <div class="flex flex-col gap-2 p-3" @keydown.enter.prevent="applySchemaSelection">
                <input type="search" v-model="filterText" class="w-full border border-x4 bg-x0 px-3 py-2 text-xs outline-none" placeholder="search..." />

                <p v-if="errorMessage" class="text-xs text-reverse opacity-80">
                    {{ errorMessage }}
                </p>

                <div class="border border-x3 bg-x2 text-xs">
                    <label class="flex items-center gap-3 border-b border-x3 px-3 py-2 hover:bg-x3">
                        <input
                            type="checkbox"
                            class="size-4 border border-x4 bg-x1"
                            :checked="allFilteredSelected"
                            :indeterminate.prop="!allFilteredSelected && someFilteredSelected"
                            @change="toggleAllFilteredSchemas"
                        />
                        <span class="min-w-0 flex-1 truncate">All schemas</span>
                    </label>

                    <div class="max-h-[48vh] overflow-auto">
                        <label v-for="schema in filteredSchemas" :key="schema.name" class="flex items-center gap-3 border-b border-x3 px-3 py-2 hover:bg-x3 last:border-b-0">
                            <input type="checkbox" class="size-4 border border-x4 bg-x1" :checked="selectedSchemaNames.includes(schema.name)" @change="toggleSchema(schema.name)" />
                            <span class="min-w-0 flex-1 truncate">{{ schema.name }}</span>
                        </label>
                    </div>
                </div>

                <div class="flex items-center justify-between text-2xs opacity-70">
                    <span></span>
                    <Button severity="success" smaller :disabled="!hasPendingChanges || applying" @click="applySchemaSelection">
                        {{ applying ? 'Applying...' : 'Apply now' }}
                    </Button>
                </div>

                <p v-if="!availableSchemas.length && loading" class="text-xs opacity-60">Loading databases...</p>
                <p v-else-if="!availableSchemas.length" class="text-xs opacity-60">No cached database list yet for this server.</p>
            </div>
        </div>
    </Teleport>
</template>
