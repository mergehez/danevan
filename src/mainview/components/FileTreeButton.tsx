import { computed } from 'vue';
import { twMerge } from 'tailwind-merge';
import type { ContextMenuEntry } from '../../directives/contextMenuTypes';
import type { FileTreeItem } from '../../shared/utils/useFileTree';
import { useServerTree } from '../composables/useServerTree';
import { componentGeneric, ensureAllTsxProps, tsxWithDefaults, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props<T extends Pick<FileTreeItem, 'id' | 'rightText' | 'subtitle'> & { title?: string; name?: string }, TChild extends { id: string | number } = any> = {
    item: T;
    dataTestid?: string;
    dataCollectionKind?: string;
    dataSidebarSelfToggle?: boolean | 'true';
    dataNodeId: string;
    dataParentId?: string;
    expandable?: boolean;
    draggable?: boolean;
    collapsed?: boolean;
    children?: () => TChild[];
    isLoading?: boolean;
    tooltip?: string;
    class?: string;
    selected?: boolean;
    skipTitle?: boolean;
    stickySlot?: number;
    icon?: 'icon-[mdi--database-outline]' | 'icon-[mdi--folder-outline]' | 'icon-[mdi--file-outline]' | (string & {});
    contextMenuItems?: (item: T) => ContextMenuEntry[];

    onClick: (event: MouseEvent) => void;
    onDblClick?: (event: MouseEvent) => void;
    onDragstart?: (event: DragEvent) => void;
} & {
    slots?: {
        text?: (scope: { text: any }) => unknown;
        rightPrefix?: () => unknown;
        default?: () => unknown;
        child?: (scope: { item: any; parentId: string; allItems: TChild[] }) => unknown;
    };
};

export const FileTreeButton = componentGeneric(
    <T extends Pick<FileTreeItem, 'id' | 'rightText' | 'subtitle'> & { title?: string; name?: string }, TChild extends { id: string | number } = any>(_props: Props<T, TChild>) => {
        const props = tsxWithDefaults(_props, { expandable: true });

        const state = useServerTree();

        function focusSidebarEventTarget(event: MouseEvent) {
            if (event.currentTarget instanceof HTMLElement) {
                event.currentTarget.focus({ preventScroll: true });
            }
        }
        function clearPendingRowClick(nodeId: string | undefined) {
            if (!nodeId) {
                return;
            }

            const timerId = state.pendingRowClickTimers.get(nodeId);

            if (timerId === undefined) {
                return;
            }

            window.clearTimeout(timerId);
            state.pendingRowClickTimers.delete(nodeId);
        }
        function schedulePendingRowClick(nodeId: string | undefined, event: MouseEvent, action: () => void) {
            focusSidebarEventTarget(event);

            if (!nodeId || event.detail === 0) {
                action();
                return;
            }

            clearPendingRowClick(nodeId);
            const timerId = window.setTimeout(() => {
                state.pendingRowClickTimers.delete(nodeId);
                action();
            }, 200);
            state.pendingRowClickTimers.set(nodeId, timerId);
        }

        async function onRowClick(event: MouseEvent, skipSchedule = false) {
            if (!props.onClick) {
                return;
            }

            if (skipSchedule || props.dataSidebarSelfToggle) {
                props.onClick(event);
                return;
            }

            schedulePendingRowClick(props.dataNodeId, event, () => {
                props.onClick!(event);
            });
        }

        // function onContextMenu(event: MouseEvent) {
        //     if (!props.contextMenuItems) {
        //         return;
        //     }

        //     event.preventDefault();
        //     focusSidebarEventTarget(event);
        //     if (event.currentTarget instanceof HTMLElement) {
        //         event.currentTarget.openContextMenu(props.contextMenuItems);
        //     }

        //     // props.onContextMenu!(props.item, props.dataNodeId, event);
        // }

        function handleDoubleClick(event: MouseEvent) {
            if (!props.onDblClick) {
                return;
            }

            event.preventDefault();
            clearPendingRowClick(props.dataNodeId);
            props.onDblClick!(event);
        }

        function handleDragStart(event: DragEvent) {
            if (!props.onDragstart) {
                return;
            }

            props.onDragstart(event);
        }

        const children = computed(() => {
            if (!props.children) {
                return [];
            }

            return props.children();
        });

        // Row height (min-h-5 plus the label's py-1); sticky rows stack at slot × this.
        const ROW_HEIGHT = 24;

        return () => (
            <>
                {!props.skipTitle ? (
                    <button
                        data-sidebar-row="true"
                        data-test-id={props.dataTestid}
                        data-collection-kind={props.dataCollectionKind}
                        data-sidebar-self-toggle={props.dataSidebarSelfToggle ? 'true' : undefined}
                        data-node-id={props.dataNodeId}
                        data-parent-id={props.dataParentId}
                        data-sidebar-expandable={props.expandable ? 'true' : 'false'}
                        data-sidebar-collapsed={String(props.collapsed)}
                        draggable={props.draggable}
                        type="button"
                        style={props.stickySlot === undefined ? undefined : { top: `${props.stickySlot * ROW_HEIGHT}px` }}
                        v-menu={props.contextMenuItems ? { items: () => props.contextMenuItems!(props.item), key: props.dataNodeId } : undefined}
                        onClick={onRowClick}
                        onDblclick={handleDoubleClick}
                        onKeydown={state.handleSidebarRowKeydown}
                        onDragstart={handleDragStart}
                        class={twMerge(
                            'flex min-h-5 items-center gap-1 text-default w-full px-1 hover:bg-white/6  focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/50 focus-visible:bg-white/10',
                            props.stickySlot === undefined ? undefined : 'sticky z-10 before:absolute before:inset-0 before:-z-10 before:bg-x1',
                            props.class,
                            props.selected ? 'bg-white/10' : ''
                        )}
                    >
                        <span v-tooltip={props.tooltip} class="flex min-w-0 flex-1 py-1 items-center gap-0.5 text-left select-none">
                            <span
                                data-sidebar-toggle-for={props.expandable ? props.dataNodeId : undefined}
                                onClick={prevented((e) => onRowClick(e, props.expandable))}
                                class={['icon', [props.collapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]', props.expandable ? undefined : 'invisible w-2']]}
                            />
                            <span class="flex-1 inline-flex items-center gap-1 min-w-0 shrink-0 truncate">
                                {props.icon ? <span class={['icon shrink-0 text-sm', props.isLoading ? 'icon-[mdi--loading] animate-spin' : props.icon]} /> : null}
                                <span class="text-xs leading-tight text-white">
                                    {props.slots?.text?.({ text: props.item.title ?? props.item.name }) ?? <>{props.item.title ?? props.item.name}</>}
                                </span>
                                {!props.icon && props.isLoading ? (
                                    <span class={['icon shrink-0 text-sm', props.isLoading ? 'icon-[mdi--loading] animate-spin' : props.icon]} />
                                ) : null}
                                {props.item.subtitle ? <span class="pl-2 text-2xs opacity-70 select-none">{props.item.subtitle}</span> : null}
                                {props.item.rightText ? <span class="pl-2 ml-auto text-2xs opacity-80 font-semibold select-none">{props.item.rightText}</span> : null}
                            </span>
                            {props.slots?.rightPrefix?.()}
                        </span>
                        {props.slots?.default?.()}
                    </button>
                ) : null}
                {!props.collapsed && children.value?.length ? (
                    <div class={['min-w-0 border-l border-x3/50', props.skipTitle ? 'pl-0' : 'pl-3']}>
                        {children.value.map((child) => (
                            <div class="flex min-w-0 flex-col" key={child.id}>
                                {props.slots?.child?.({ item: child, parentId: props.dataNodeId, allItems: children.value })}
                            </div>
                        ))}
                    </div>
                ) : null}
            </>
        );
    },
    {
        name: 'FileTreeButton',
        props: ensureAllTsxProps<Props<any, any>>()([
            'item',
            'dataTestid',
            'dataCollectionKind',
            'dataSidebarSelfToggle',
            'dataNodeId',
            'dataParentId',
            'expandable',
            'draggable',
            'collapsed',
            'children',
            'isLoading',
            'tooltip',
            'class',
            'selected',
            'skipTitle',
            'stickySlot',
            'icon',
            'contextMenuItems',
            'onClick',
            'onDblClick',
            'onDragstart',
            'slots',
        ]),
    }
);

export default FileTreeButton;
