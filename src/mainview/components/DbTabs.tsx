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

        const states = computed(() => {
            return [navState.scriptTabs, navState.nonScriptTabs];
        });

        function onChange(tabs: Tab[], index: number) {
            if (index === 0) {
                navState.onScriptTabsChange(tabs);
            } else {
                navState.onNonScriptTabsChange(tabs);
            }
        }

        return () => (
            <div class="flex min-w-0 flex-col gap-0.5 bg-x2">
                {states.value.map((tabs, i) =>
                    i != 0 || tabs.length ? (
                        <div class="flex min-w-0 items-center gap-2" key={i}>
                            <DragTabs
                                items={tabs}
                                onChange={(tabs) => onChange(tabs, i)}
                                class="min-w-0 flex flex-1 flex-wrap overflow-x-auto border-b border-x0"
                                slots={{
                                    tab: ({ requiredClass, item: e, key }) => (
                                        <div
                                            key={key}
                                            v-tooltip={e.tooltip}
                                            draggable="true"
                                            id={e.hash}
                                            onClick={() => handleTabClick(e)}
                                            onContextmenu={prevented((ev) => openTabContextMenu(ev, e))}
                                            onMousedown={(ev) => onMouseDown(ev, e)}
                                            onAuxclick={prevented((ev) => onAuxClick(ev, e))}
                                            class={getClass(e, requiredClass)}
                                        >
                                            <Icon icon={e.type === 'scratch' ? 'icon-[mdi--file-edit-outline]' : 'icon-[mdi--table-large]'} class="text-sm opacity-70" />
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
                            {i == 0 ? (
                                <IconButton
                                    icon="icon-[mdi--plus]"
                                    v-tooltip={'New scratch tab'}
                                    smaller={true}
                                    disabled={!connections.connections.length}
                                    onClick={() => navState.openScratchTab()}
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
