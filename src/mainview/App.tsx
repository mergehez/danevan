import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { ContextMenu } from '../directives/ContextMenu.tsx';
import { useContextMenu } from '../directives/useContextMenu';
import { useOverlaysState } from '../directives/useOverlaysState';
import { Alert } from '../shared/components/Alert.tsx';
import { AppConfirmationModal } from '../shared/components/AppConfirmationModal.tsx';
import Splitter from '../shared/components/Splitter';
import { DbData } from './components/DbData.tsx';
import DbScripts from './components/DbScripts';
import { DbSidebar } from './components/DbSidebar.tsx';
import { DbTabs } from './components/DbTabs.tsx';
import { GridFormatterModal } from './components/GridFormatterModal.tsx';
import ModifyTableModal from './components/ModifyTableModal';
import { SettingsModal } from './components/SettingsModal.tsx';
import { initializeDbStates } from './composables/initializeDbStates.ts';
import { useConnections } from './composables/useConnections.ts';
import { useDbSettings } from './composables/useDbSettings.ts';
import { useNavState } from './composables/useNavState.ts';
import { useQuery } from './composables/useQuery.ts';
import { useServers } from './composables/useServers.ts';
import { tasks } from './composables/useTasks.ts';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {};

export const App = component(
    (_: Props) => {
        initializeDbStates();

        const settings = useDbSettings();
        const servers = useServers();
        const connections = useConnections();
        useQuery();
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

        // watch(
        //     () => connections.selectedConnectionId,
        //     () => {
        //         void query.loadTables();
        //     },
        //     { immediate: true }
        // );

        watch(
            () => [selectedConnection.value?.name, selectedServer.value?.name],
            ([connectionName, serverName]) => {
                document.title = connectionName ? `${connectionName} - ${serverName ?? 'Danevan'}` : 'Danevan';
            },
            { immediate: true }
        );

        let disposeNativeCommandListener: (() => void) | undefined;

        onMounted(() => {
            disposeNativeCommandListener = window.electronAPI?.onNativeCommand(async (command) => {
                if (command.kind === 'open-settings') {
                    settings.openSettingsWindow();
                }
            });
        });

        onBeforeUnmount(() => {
            disposeNativeCommandListener?.();
            disposeNativeCommandListener = undefined;
        });

        return () => (
            <>
                <div class="min-h-screen bg-x0 text-default">
                    <Splitter
                        baseSide="left"
                        defaultWidth="200px"
                        minWidth="180px"
                        maxWidth="50%"
                        localStorageKey="mainSidebarWidth"
                        class="flex h-screen bg-transparent dark"
                        slots={{
                            left: () => <DbSidebar />,
                            right: () => (
                                <main class="flex min-w-0 flex-1 flex-col gap-3 py-1 overflow-auto">
                                    <DbTabs />
                                    {!selectedConnection.value ? (
                                        <section class="flex min-h-0 flex-1 items-center justify-center border border-dashed border-x4 bg-x1 p-8 text-center">
                                            <div class="max-w-md">
                                                <p class="text-2xs uppercase tracking-[0.32em] opacity-60">Workspace</p>
                                                <h2 class="mt-2 text-2xl font-semibold tracking-tight text-reverse">Choose a connection</h2>
                                                <p class="mt-3 text-sm opacity-70">
                                                    Use the compact tree on the left to add a source, create a named connection, then switch between info, data, and script tabs.
                                                </p>
                                            </div>
                                        </section>
                                    ) : !activeTab.value ? (
                                        <section class="flex min-h-0 flex-1 items-center justify-center border border-dashed border-x4 bg-x1 p-8 text-center">
                                            <div class="max-w-md">
                                                <p class="text-2xs uppercase tracking-[0.32em] opacity-60">Workspace</p>
                                                <h2 class="mt-2 text-2xl font-semibold tracking-tight text-reverse">Open a tab</h2>
                                                <p class="mt-3 text-sm opacity-70">Open a table from the sidebar or create a script or scratch tab to drive the main panel.</p>
                                            </div>
                                        </section>
                                    ) : mainPanel.value === 'data' ? (
                                        <DbData />
                                    ) : mainPanel.value === 'scripts' ? (
                                        <DbScripts />
                                    ) : null}
                                </main>
                            ),
                        }}
                    />
                    {tasks.errorMessage ? (
                        <div class="fixed bottom-4 right-4 max-w-md border border-x5 bg-x2 px-4 py-3 text-sm text-reverse shadow-2xl" style={{ zIndex: errorZIndex.value }}>
                            <div class="mb-2 flex items-center justify-between gap-4">
                                <strong>Request failed</strong>
                                <button onClick={tasks.dismissError} class="text-xs uppercase tracking-[0.2em] text-reverse opacity-70">
                                    Dismiss
                                </button>
                            </div>
                            <p>{tasks.errorMessage}</p>
                        </div>
                    ) : null}
                    <SettingsModal />
                    <AppConfirmationModal />
                    <GridFormatterModal />
                    <ModifyTableModal />
                    <ContextMenu state={contextMenu} />
                </div>
                {tasks.isBusy ? (
                    <Alert small={true} severity="primary" class="fixed right-4 bottom-4" style={{ zIndex: busyZIndex.value }}>
                        <div class="flex items-center gap-2">
                            <span class="icon icon-[mdi--loading] animate-spin text-sm" />
                            <span>{tasks.getLongRunningOperation || tasks.getRunningOperation() || 'Working...'}</span>
                        </div>
                    </Alert>
                ) : null}
            </>
        );
    },
    { name: 'App', props: ensureAllTsxProps<Props>()([]) }
);

export default App;
