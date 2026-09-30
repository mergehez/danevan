import { ref, computed, watch, onBeforeUnmount, Teleport } from 'vue';
import { useOverlaysState } from '../../directives/useOverlaysState';
import { Button } from '../../shared/components/Button.tsx';
import type { ServerSchemaRecord } from '../../shared/types';
import { useConnections } from '../composables/useConnections';
import { useServers } from '../composables/useServers';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {} & {
    open: boolean;
    onOpenChange?: (val: boolean) => unknown;
    onRefreshed?: () => void;
};

export const DbServerSchemasModal = component(
    (props: Props) => {
        const open = computed({
            get: () => props.open,
            set: (value) => props.onOpenChange?.(value),
        });

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
                if (!open.value || applying.value) {
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
                props.onRefreshed?.();
            } catch (error) {
                errorMessage.value = error instanceof Error ? error.message : String(error);
            } finally {
                loading.value = false;
            }
        }

        function toggleSchema(schemaName: string) {
            const nextSchemaNames = selectedSchemaNames.value.includes(schemaName)
                ? selectedSchemaNames.value.filter((name) => name !== schemaName)
                : [...selectedSchemaNames.value, schemaName];

            void applySchemaSelection(nextSchemaNames);
        }

        function toggleAllFilteredSchemas() {
            if (!filteredSchemas.value.length) {
                return;
            }

            if (allFilteredSelected.value) {
                const filteredSchemaNames = new Set(filteredSchemas.value.map((schema) => schema.name));
                void applySchemaSelection(selectedSchemaNames.value.filter((schemaName) => !filteredSchemaNames.has(schemaName)));
                return;
            }

            void applySchemaSelection([...new Set([...selectedSchemaNames.value, ...filteredSchemas.value.map((schema) => schema.name)])]);
        }

        async function applySchemaSelection(nextSchemaNames: string[]) {
            if (!server.value || applying.value) {
                return;
            }

            const previousSchemaNames = selectedSchemaNames.value;
            selectedSchemaNames.value = [...nextSchemaNames].sort((left, right) => left.localeCompare(right));
            applying.value = true;
            errorMessage.value = undefined;

            try {
                await connections.setVisibleServerSchemas(server.value.id, selectedSchemaNames.value);
                props.onRefreshed?.();
            } catch (error) {
                selectedSchemaNames.value = previousSchemaNames;
                errorMessage.value = error instanceof Error ? error.message : String(error);
            } finally {
                applying.value = false;
            }
        }

        function onOpenChange(nextOpen: boolean) {
            if (nextOpen) {
                open.value = true;
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

            onOpenChange(false);
        }

        function handleDocumentKeydown(event: KeyboardEvent) {
            if (!open.value) {
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                onOpenChange(false);
            }
        }

        onBeforeUnmount(() => {
            window.removeEventListener('resize', handleWindowGeometryChange);
            window.removeEventListener('scroll', handleWindowGeometryChange, true);
            document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
            document.removeEventListener('keydown', handleDocumentKeydown);
        });

        return () => (
            <Teleport to="body">
                {open.value ? (
                    <div
                        ref={popoverRef}
                        class="fixed overflow-hidden border border-x4 bg-x1 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
                        style={{ ...popoverStyle.value, zIndex: popoverZIndex.value }}
                    >
                        <div class="flex items-center gap-2 border-b border-x3 px-3 py-2">
                            <div class="min-w-0 flex-1">
                                <div class="text-2xs uppercase tracking-[0.2em] opacity-60">{modalTitle.value}</div>
                                <div class="text-xs opacity-80">{server.value?.name || 'Server'}</div>
                            </div>
                            <Button severity="secondary" smaller={true} disabled={loading.value || applying.value} onClick={refreshSchemas}>
                                {loading.value ? 'Refreshing...' : 'Refresh'}
                            </Button>
                        </div>
                        <div class="flex flex-col gap-2 p-3">
                            <input
                                type="search"
                                value={filterText.value}
                                onInput={(e: any) => (filterText.value = e.target.value)}
                                placeholder="search..."
                                class="w-full border border-x4 bg-x0 px-3 py-2 text-xs outline-none"
                            />
                            {errorMessage.value ? <p class="text-xs text-reverse opacity-80">{errorMessage.value}</p> : null}
                            <div class="border border-x3 bg-x2 text-xs">
                                <label class="flex items-center gap-3 border-b border-x3 px-3 py-2 hover:bg-x3">
                                    <input
                                        type="checkbox"
                                        checked={allFilteredSelected.value}
                                        indeterminate={!allFilteredSelected.value && someFilteredSelected.value}
                                        onChange={toggleAllFilteredSchemas}
                                        disabled={applying.value}
                                        class="size-4 border border-x4 bg-x1"
                                    />
                                    <span class="min-w-0 flex-1 truncate">All schemas</span>
                                </label>
                                <div class="max-h-[48vh] overflow-auto">
                                    {filteredSchemas.value.map((schema) => (
                                        <label class="flex items-center gap-3 border-b border-x3 px-3 py-2 hover:bg-x3 last:border-b-0" key={schema.name}>
                                            <input
                                                type="checkbox"
                                                checked={selectedSchemaNames.value.includes(schema.name)}
                                                onChange={() => toggleSchema(schema.name)}
                                                disabled={applying.value}
                                                class="size-4 border border-x4 bg-x1"
                                            />
                                            <span class="min-w-0 flex-1 truncate">{schema.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            {!availableSchemas.value.length && loading.value ? (
                                <p class="text-xs opacity-60">Loading databases...</p>
                            ) : !availableSchemas.value.length ? (
                                <p class="text-xs opacity-60">No cached database list yet for this server.</p>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </Teleport>
        );
    },
    { name: 'DbServerSchemasModal', props: ensureAllTsxProps<Props>()(['open', 'onOpenChange', 'onRefreshed']) }
);

export default DbServerSchemasModal;
