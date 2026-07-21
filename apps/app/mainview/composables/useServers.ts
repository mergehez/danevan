import { _dbCoreState } from '@composables/dbCoreState';
import { useDbCaches } from '@composables/useDbCaches';
import { tasks } from '@composables/useTasks';
import { confirmAction } from '@lib/utils';
import { dbTypes, type CreateServerParams, type DbType, type ServerSchemaRecord, type UpdateServerParams } from '@utils/appClient';
import { reactive } from 'vue';

function getAnchorPosition(anchorElement?: HTMLElement) {
    if (!anchorElement) {
        return {
            left: 0,
            top: 0,
            width: 0,
        };
    }

    const rect = anchorElement.getBoundingClientRect();

    return {
        left: rect.left,
        top: rect.bottom + 6,
        width: rect.width,
    };
}

export function _useServers() {
    const dbCaches = useDbCaches();

    const state = reactive({
        addForm: {
            visible: false,
            driver: dbTypes[0] as DbType,
            serverId: -1,
        },
        updateForm: {
            visible: false,
            serverId: -1,
        },
        schemaSelectionModal: {
            visible: false,
            serverId: -1,
            anchorElement: undefined as HTMLElement | undefined,
            anchorLeft: 0,
            anchorTop: 0,
            anchorWidth: 0,
        },
        openAddForm(driver?: DbType, serverId?: number) {
            state.addForm.driver = driver ?? dbTypes[0];
            state.addForm.serverId = serverId ?? -1;
            state.addForm.visible = true;
        },
        openUpdateForm(serverId: number) {
            state.updateForm.serverId = serverId;
            state.updateForm.visible = true;
        },
        closeUpdateForm() {
            state.updateForm.visible = false;
            state.updateForm.serverId = -1;
        },
        openSchemaSelectionModal(serverId: number, anchorElement?: HTMLElement | null) {
            state.schemaSelectionModal.serverId = serverId;
            state.schemaSelectionModal.anchorElement = anchorElement ?? undefined;
            state.updateSchemaSelectionModalPosition();
            state.schemaSelectionModal.visible = true;
        },
        closeSchemaSelectionModal() {
            state.schemaSelectionModal.visible = false;
        },
        updateSchemaSelectionModalPosition() {
            const nextPosition = getAnchorPosition(state.schemaSelectionModal.anchorElement);
            state.schemaSelectionModal.anchorLeft = nextPosition.left;
            state.schemaSelectionModal.anchorTop = nextPosition.top;
            state.schemaSelectionModal.anchorWidth = nextPosition.width;
        },
        get servers() {
            return [..._dbCoreState.servers].sort((left, right) => Number(left.sequence) - Number(right.sequence) || left.name.localeCompare(right.name));
        },
        get selectedServerId() {
            return _dbCoreState.selectedServerId;
        },
        get selectedServer() {
            return _dbCoreState.servers.find((server) => server.id === _dbCoreState.selectedServerId);
        },
        getCachedServerSchemas(serverId: number) {
            return dbCaches.getCachedServerSchemas(serverId);
        },
        applyServerSchemas(serverId: number, schemas: ServerSchemaRecord[]) {
            dbCaches.applyServerSchemas(serverId, schemas);
        },
        clearServerSchemas(serverId: number) {
            dbCaches.clearServerSchemas(serverId);
        },
        clearAllServerSchemas() {
            dbCaches.clearAllServerSchemas();
        },
        async ensureServerSchemas(serverId: number, force = false) {
            const cachedSchemas = force ? undefined : state.getCachedServerSchemas(serverId);

            if (cachedSchemas) {
                return cachedSchemas;
            }

            if (force) {
                _dbCoreState.applyBootstrap(await tasks.refreshServerSchemas.run({ serverId }));
            }

            const schemas = await tasks.getServerSchemas.run({ serverId });
            state.applyServerSchemas(serverId, schemas);
            return schemas;
        },
        async selectServer(serverId: number | undefined) {
            _dbCoreState.applyBootstrap(await tasks.selectServer.run({ serverId }));
        },
        async createServer(server: CreateServerParams) {
            _dbCoreState.applyBootstrap(await tasks.createServer.run(server));
        },
        async updateServer(serverId: number, server: UpdateServerParams) {
            _dbCoreState.applyBootstrap(await tasks.updateServer.run({ serverId, server }));
        },
        async deleteServer(serverId: number) {
            const server = _dbCoreState.servers.find((entry) => entry.id === serverId);

            if (
                !(await confirmAction({
                    title: server?.kind === 'file' ? 'Delete source?' : 'Delete server?',
                    message: server?.name ? `This will permanently remove ${server.name}.` : 'This will permanently remove the selected server.',
                    detail:
                        server?.kind === 'file'
                            ? 'Connections and cached metadata for this source will also be removed.'
                            : 'Connections and cached metadata for this server will also be removed.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            _dbCoreState.applyBootstrap(await tasks.deleteServer.run({ serverId }));
        },
        async reorderServer(serverId: number, toIndex: number) {
            _dbCoreState.applyBootstrap(await tasks.reorderServer.run({ serverId, toIndex }));
        },
        async refreshServerSchemas(serverId: number) {
            return state.ensureServerSchemas(serverId, true);
        },
    });

    return state;
}

let serversSingleton: ReturnType<typeof _useServers> | undefined;

export function useServers() {
    serversSingleton ??= _useServers();
    return serversSingleton;
}
