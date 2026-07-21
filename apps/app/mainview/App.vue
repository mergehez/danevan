<script setup lang="ts">
import DbData from '@components/DbData.vue';
import DbScripts from '@components/DbScripts.vue';
import DbSidebar from '@components/DbSidebar.vue';
import DbTabs from '@components/DbTabs.vue';
import GridFormatterModal from '@components/GridFormatterModal.vue';
import ModifyTableModal from '@components/ModifyTableModal.vue';
import SettingsModal from '@components/SettingsModal.vue';
import { initializeDbStates } from '@composables/initializeDbStates';
import { useConnections } from '@composables/useConnections';
import { useDbSettings } from '@composables/useDbSettings';
import { useNavState } from '@composables/useNavState';
import { useQuery } from '@composables/useQuery';
import { useServers } from '@composables/useServers';
import { tasks } from '@composables/useTasks';
import ContextMenu from '@directives/ContextMenu.vue';
import { useContextMenu } from '@directives/useContextMenu';
import { useOverlaysState } from '@directives/useOverlaysState';
import Alert from '@ui/Alert.vue';
import AppConfirmationModal from '@ui/AppConfirmationModal.vue';
import Splitter from '@ui/Splitter.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

initializeDbStates();

const settings = useDbSettings();
const servers = useServers();
const connections = useConnections();
const query = useQuery();
const contextMenu = useContextMenu();
const navState = useNavState();
const overlayState = useOverlaysState();
const errorZIndex = ref(90);
const busyZIndex = ref(90);

watch(
    () => tasks.errorMessage,
    (msg) => {
        errorZIndex.value = msg ? overlayState.claimZIndex() : overlayState.releaseZIndex(errorZIndex.value);
    }
);

watch(
    () => tasks.isBusy,
    (busy) => {
        busyZIndex.value = busy ? overlayState.claimZIndex() : overlayState.releaseZIndex(busyZIndex.value);
    }
);

const selectedServer = computed(() => servers.selectedServer);
const selectedConnection = computed(() => connections.selectedConnection);
const activeTab = computed(() => navState.activeTab);
const mainPanel = computed(() => {
    if (!activeTab.value) {
        return undefined;
    }

    return activeTab.value.type === 'table' ? 'data' : 'scripts';
});

watch(
    () => connections.selectedConnectionId,
    () => {
        void query.loadTables();
    },
    { immediate: true }
);

watch(
    () => [selectedConnection.value?.name, selectedServer.value?.name],
    ([connectionName, serverName]) => {
        document.title = connectionName ? `${connectionName} - ${serverName ?? 'Danevan'}` : 'Danevan';
    },
    { immediate: true }
);

let disposeNativeCommandListener: (() => void) | undefined;

onMounted(() => {
    disposeNativeCommandListener = window.appClient.onNativeCommand(async (command) => {
        if (command.kind === 'open-settings') {
            settings.openSettingsWindow();
        }
    });
});

onBeforeUnmount(() => {
    disposeNativeCommandListener?.();
    disposeNativeCommandListener = undefined;
});
</script>

<template>
    <div class="min-h-screen bg-x0 text-default">
        <Splitter class="flex h-screen bg-transparent dark" base-side="left" default-width="200px" min-width="180px" max-width="50%" local-storage-key="mainSidebarWidth">
            <template #left>
                <DbSidebar />
            </template>
            <template #right>
                <main class="flex min-w-0 flex-1 flex-col gap-3 py-1 overflow-auto">
                    <DbTabs />

                    <section v-if="!selectedConnection" class="flex min-h-0 flex-1 items-center justify-center border border-dashed border-x4 bg-x1 p-8 text-center">
                        <div class="max-w-md">
                            <p class="text-2xs uppercase tracking-[0.32em] opacity-60">Workspace</p>
                            <h2 class="mt-2 text-2xl font-semibold tracking-tight text-reverse">Choose a connection</h2>
                            <p class="mt-3 text-sm opacity-70">
                                Use the compact tree on the left to add a source, create a named connection, then switch between info, data, and script tabs.
                            </p>
                        </div>
                    </section>
                    <section v-else-if="!activeTab" class="flex min-h-0 flex-1 items-center justify-center border border-dashed border-x4 bg-x1 p-8 text-center">
                        <div class="max-w-md">
                            <p class="text-2xs uppercase tracking-[0.32em] opacity-60">Workspace</p>
                            <h2 class="mt-2 text-2xl font-semibold tracking-tight text-reverse">Open a tab</h2>
                            <p class="mt-3 text-sm opacity-70">Open a table from the sidebar or create a script or scratch tab to drive the main panel.</p>
                        </div>
                    </section>
                    <DbData v-else-if="mainPanel === 'data'" />
                    <DbScripts v-else-if="mainPanel === 'scripts'" />
                </main>
            </template>
        </Splitter>

        <div v-if="tasks.errorMessage" class="fixed bottom-4 right-4 max-w-md border border-x5 bg-x2 px-4 py-3 text-sm text-reverse shadow-2xl" :style="{ zIndex: errorZIndex }">
            <div class="mb-2 flex items-center justify-between gap-4">
                <strong>Request failed</strong>
                <button class="text-xs uppercase tracking-[0.2em] text-reverse opacity-70" @click="tasks.dismissError">Dismiss</button>
            </div>
            <p>{{ tasks.errorMessage }}</p>
        </div>

        <SettingsModal />
        <AppConfirmationModal />
        <GridFormatterModal />
        <ModifyTableModal />

        <ContextMenu :state="contextMenu" />
    </div>
    <Alert v-if="tasks.isBusy" class="fixed right-4 bottom-4" small severity="primary" :style="{ zIndex: busyZIndex }">
        <div class="flex items-center gap-2">
            <span class="icon icon-[mdi--loading] animate-spin text-sm"></span>
            <span>{{ tasks.getLongRunningOperation || tasks.getRunningOperation() || 'Working...' }}</span>
        </div>
    </Alert>
</template>
