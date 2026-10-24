import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';
import { computed } from 'vue';
import type { ContextMenuEntry } from '../../directives/contextMenuTypes';
import { useContextMenu } from '../../directives/useContextMenu';
import { DragTabs } from '../../shared/components/DragTabs.tsx';
import { Icon } from '../../shared/components/Icon.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { useConnections } from '../composables/useConnections';
import { useNavState } from '../composables/useNavState';
import { useServerTree } from '../composables/useServerTree';
import type { Tab } from '../composables/useSettings';

type Props = {};

export const DbTabs = component(
    (_: Props) => {
        const navState = useNavState();
        const contextMenu = useContextMenu();
        const connections = useConnections();
        const serverTree = useServerTree();

        const onAuxClick = (event: MouseEvent, endpoint: Tab) => {
            if (event.button === 1) {
                event.preventDefault();
                setTimeout(() => {
                    navState.closeTab(endpoint);
                }, 200);
            }
        };

        const onMouseDown = (event: MouseEvent, endpoint: Tab) => {
            if (event.button == 1) {
                event.preventDefault();
                navState.closeTab(endpoint);
            }
        };

        function handleTabClick(tab: Tab) {
            if (tab.type === 'table' && tab.name) {
                serverTree.requestRevealTableSelection(tab.connectionId, tab.name);
            }

            navState.selectTab(tab);
        }

        function openTabContextMenu(event: MouseEvent, tab: Tab) {
            event.preventDefault();

            const items: ContextMenuEntry[] = [
                {
                    id: `close-tab:${tab.hash}`,
                    label: 'Close tab',
                    iconClass: 'icon-[mdi--close]',
                    action: () => navState.closeTab(tab),
                },
                {
                    id: `close-other-tabs:${tab.hash}`,
                    label: 'Close other',
                    iconClass: 'icon-[mdi--close-box-multiple-outline]',
                    disabled: navState.selectedTabs.length <= 1,
                    action: () => navState.closeOtherTabs(tab),
                },
                {
                    id: `close-all-tabs:${tab.hash}`,
                    label: 'Close all',
                    iconClass: 'icon-[mdi--close-network-outline]',
                    disabled: navState.selectedTabs.length === 0,
                    action: () => navState.closeAllTabs(),
                },
                {
                    type: 'separator',
                },
                {
                    id: 'reopen-closed-tab',
                    label: 'Reopen closed tab',
                    iconClass: 'icon-[mdi--tab-plus]',
                    disabled: navState.closedTabs.length === 0,
                    action: () => navState.reopenClosedTab(),
                },
            ];

            contextMenu.openAtEvent(event, items);
        }

        const getClass = (tab: Tab, requiredClass: string) => {
            return [
                'group relative flex cursor-pointer items-center gap-1 whitespace-nowrap border px-2 py-1 pr-5 text-xs text-white',
                requiredClass,
                navState.activeTab?.hash === tab.hash ? 'bg-green-700 hover:bg-green-800 border-green-600' : 'bg-x2 hover:bg-x0 border-x4 opacity-80',
            ].join(' ');
        };

        // The script row first, then one table row per group (or a single "all" row). A grouped row
        // shows its database/server tag on the left, once, so its tabs are just names.
        const rows = computed(() => [
            { key: 'scripts', kind: 'scripts' as const, label: '', tabs: navState.scriptTabs, appearance: undefined },
            ...navState.tableTabGroups.map((group) => ({ key: group.key, kind: 'table' as const, label: group.label, tabs: group.tabs, appearance: group.appearance })),
        ]);

        function onChange(tabs: Tab[], row: { key: string; kind: 'scripts' | 'table' }) {
            if (row.kind === 'scripts') {
                navState.onScriptTabsChange(tabs);
                return;
            }

            navState.onTableTabsChange(row.key, tabs);
        }

        function renderTag(color: string | undefined, shortCode: string | undefined, codeTestId: string, colorTestId: string) {
            return (
                <>
                    {shortCode ? (
                        <span data-testid={codeTestId} style={{ color }} class="shrink-0 font-mono text-2xs font-semibold">
                            {shortCode}
                        </span>
                    ) : null}
                    <span
                        data-testid={colorTestId}
                        aria-hidden="true"
                        style={{ backgroundColor: color ?? 'transparent' }}
                        class={['h-2.5 w-2.5 shrink-0 rounded-full border', color ? 'border-transparent' : 'border-x5']}
                    />
                </>
            );
        }

        return () => (
            <div class="flex min-w-0 flex-col gap-0.5 bg-x2">
                {rows.value.map((row, i) =>
                    // The script row stays for its "new scratch tab" button, which is the only way to
                    // start a scratch tab and used to disappear exactly when the workspace was empty.
                    row.kind === 'table' || row.tabs.length || connections.connections.length ? (
                        <div class="flex min-w-0 items-center gap-2" key={row.key} data-testid={`tab-row-${row.key}`}>
                            {row.kind === 'table' && row.label ? (
                                <span class="flex w-24 shrink-0 items-center gap-1 pl-1" v-tooltip={{ value: row.label, xs: true, nowrap: true }}>
                                    {renderTag(row.appearance?.color, row.appearance?.shortCode, `group-${row.key}-code`, `group-${row.key}-color`)}
                                    <span class="min-w-0 truncate text-2xs opacity-60">{row.label}</span>
                                </span>
                            ) : null}
                            <DragTabs
                                items={row.tabs}
                                onChange={(tabs) => onChange(tabs, row)}
                                class="min-w-0 flex flex-1 flex-wrap overflow-x-auto border-b border-x0"
                                slots={{
                                    tab: ({ requiredClass, item: e, key }) => (
                                        <div
                                            key={key}
                                            v-tooltip={{ value: e.tooltip, xs: true, nowrap: true, delay: true }}
                                            draggable="true"
                                            id={e.hash}
                                            onClick={() => handleTabClick(e)}
                                            onContextmenu={prevented((ev) => openTabContextMenu(ev, e))}
                                            onMousedown={(ev) => onMouseDown(ev, e)}
                                            onAuxclick={prevented((ev) => onAuxClick(ev, e))}
                                            class={getClass(e, requiredClass)}
                                        >
                                            {e.type === 'table' ? (
                                                // A table tab is named by its table only. When the rows are grouped,
                                                // the group header carries the tag once; otherwise the tab does.
                                                row.kind === 'table' && row.label ? null : (
                                                    renderTag(e.color, e.shortCode, `tab-code-${e.hash}`, `tab-color-${e.hash}`)
                                                )
                                            ) : (
                                                <Icon icon={e.type === 'scratch' ? 'icon-[mdi--file-edit-outline]' : 'icon-[mdi--table-large]'} class="text-sm opacity-70" />
                                            )}
                                            <span class="select-none pointer-events-none">{e.name}</span>
                                            <span
                                                onClick={prevented(() => navState.closeTab(e))}
                                                class="absolute right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                                            >
                                                <i class="icon icon-[mdi--close] aspect-square text-sm" />
                                            </span>
                                        </div>
                                    ),
                                }}
                            />
                            {row.kind === 'scripts' ? (
                                <IconButton
                                    icon="icon-[mdi--plus]"
                                    data-testid="new-scratch-tab"
                                    v-tooltip={{ value: 'New scratch tab', xs: true, nowrap: true }}
                                    smaller={true}
                                    disabled={!connections.connections.length}
                                    onClick={() => navState.openScratchTab(navState.activeTab?.connectionId ?? connections.selectedConnectionId ?? undefined)}
                                />
                            ) : i === 1 ? (
                                <IconButton
                                    icon="icon-[mdi--dots-vertical]"
                                    data-testid="table-tabs-menu"
                                    v-tooltip={{ value: 'Group and sort table tabs', xs: true, nowrap: true }}
                                    smaller={true}
                                    v-menu={{ value: () => navState.tableTabMenuItems(), button: true }}
                                />
                            ) : null}
                        </div>
                    ) : null
                )}
            </div>
        );
    },
    { name: 'DbTabs', props: ensureAllTsxProps<Props>()([]) }
);

export default DbTabs;
