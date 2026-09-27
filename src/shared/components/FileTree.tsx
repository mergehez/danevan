import { prevented } from '#shared/utils/tsxHelpers.tsx';
import { twMerge } from 'tailwind-merge';
import { useFileTree } from '../../shared/utils/useFileTree';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';

type FT<TData, TRoot = {}> = ReturnType<typeof useFileTree<TData, TRoot>>;
type FTVisChild<TData, TRoot = {}> = ReturnType<typeof useFileTree<TData, TRoot>>['visibleChildren'][number];
type Props<TData, TRoot = {}> = {
    state: FT<TData, TRoot>;
    slots?: {
        header?: (scope: ReturnType<typeof headerSlotProps<TData, TRoot>>) => unknown;
        default?: (scope: ReturnType<typeof defaultSlotProps<TData, TRoot>>) => unknown;
        itemLeftIcon?: (scope: { item: FTVisChild<TData, TRoot>['item']; depth: number; isGroup: boolean; isCollapsed: boolean }) => unknown;
        itemTitle?: (scope: { item: FTVisChild<TData, TRoot>['item']; depth: number; isGroup: boolean; isCollapsed: boolean }) => unknown;
        itemRightIcon?: (scope: { item: FTVisChild<TData, TRoot>['item']; depth: number; isGroup: boolean; isCollapsed: boolean }) => unknown;
    };
};
function headerSlotProps<TData, TRoot = {}>(s: FT<TData, TRoot>) {
    return {
        item: s.item,
        isCollapsed: s.collapsed,
        selected: s.headerSelected,
        rowClass: [s.headerSelected ? 'bg-white/10' : undefined, s.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined, s.headerRowClass],
        nodeId: s.headerNodeId,
        parentId: s.headerParentId,
        onClick: s.onHeaderClick,
        onDoubleClick: s.onHeaderDoubleClick,
        onContextMenu: s.onHeaderContextMenu,
        onKeydown: (event: KeyboardEvent) => s.onHeaderKeydown?.(event),
    };
}
function defaultSlotProps<TData, TRoot = {}>(s: FT<TData, TRoot>, entryState: FTVisChild<TData, TRoot>) {
    return {
        item: entryState.item,
        depth: entryState.depth,
        isGroup: entryState.isGroup,
        isCollapsed: entryState.isCollapsed,
        selected: s.isSelected(entryState.item),
        outlined: s.isOutlined(entryState.item),
        rowClass: s.getRowWrapperClass(entryState.item),
        canDrag: s.canDragItem(entryState.item),
        rowPaddingStyle: s.noIndentation ? undefined : s.getRowPaddingStyle(entryState.depth),
        nodeId: s.getNodeId(entryState.item, entryState.isGroup),
        parentId: s.getParentId(entryState.item, entryState.isGroup),
        onClick: (event: MouseEvent) => s.onEntryClick(event, entryState.item),
        onContextMenu: (event: MouseEvent) => s.onContextMenu(event, entryState.item),
        onDragStart: (event: DragEvent) => s.onDragStart(event, entryState.item),
        onKeydown: (event: KeyboardEvent) => s.onItemKeydown?.(event),
    };
}

export const FileTree = <TData, TRoot = {}>(p: Props<TData, TRoot>) => {
    const state = p.state;

    return (
        <section class={['min-h-0 min-w-0 w-full', state.scrollable ? 'overflow-auto' : '']}>
            {state.item.title ? (
                <div>
                    {p.slots?.header ? (
                        p.slots?.header?.(headerSlotProps(state))
                    ) : (
                        <div
                            tabindex={state.headerNodeId ? 0 : undefined}
                            data-sidebar-row={state.headerNodeId ? 'true' : undefined}
                            data-node-id={state.headerNodeId}
                            data-parent-id={state.headerParentId}
                            data-sidebar-expandable={state.headerNodeId ? 'true' : undefined}
                            data-sidebar-collapsed={state.headerNodeId ? String(state.collapsed) : undefined}
                            data-sidebar-self-toggle={state.headerNodeId ? 'true' : undefined}
                            onClick={state.onHeaderClick}
                            onDblclick={state.onHeaderDoubleClick}
                            onContextmenu={state.onHeaderContextMenu}
                            onKeydown={(e) => state.onHeaderKeydown?.(e)}
                            class={[
                                'flex items-center justify-between px-1 py-1 text-xs font-semibold tracking-[0.02em] text-default',
                                [
                                    state.headerSelected ? 'bg-white/10' : undefined,
                                    state.headerOutlined ? 'outline-1 -outline-offset-1 outline-white/35 bg-white/6' : undefined,
                                    state.headerRowClass,
                                ],
                            ]}
                        >
                            <div class="flex items-center uppercase gap-1 flex-1">
                                <IconButton
                                    severity="raised"
                                    v-tooltip={{ value: state.collapsed ? 'Expand group' : 'Collapse group', xs: true, nowrap: true }}
                                    smaller={true}
                                    icon={state.collapsed ? 'icon-[mdi--plus]' : 'icon-[mdi--minus]'}
                                    onClick={prevented(state.onHeaderClick)}
                                    class="opacity-70"
                                />
                                <p onClick={prevented(state.onHeaderClick)} class={['cursor-pointer select-none', state.headerTitleClass]}>
                                    {state.item.title}
                                </p>
                                {state.titleActions
                                    ? state.titleActions.map((action) => (
                                          <Button
                                              severity={action.icon ? 'raised' : 'secondary'}
                                              disabled={action.disabled}
                                              smaller={true}
                                              onClick={prevented(action.onClick)}
                                              class={['text-2xs', action.icon ? 'p-0.5' : 'px-1 py-0.5']}
                                              key={action.title}
                                          >
                                              {action.icon ? <Icon icon={action.icon} /> : <span class="text-2xs">{action.title}</span>}
                                          </Button>
                                      ))
                                    : null}
                            </div>
                            <div class="flex items-center gap-1">
                                {state.headerActions
                                    ? state.headerActions.map((action) => (
                                          <Button
                                              severity={action.icon ? 'raised' : 'secondary'}
                                              disabled={action.disabled}
                                              smaller={true}
                                              v-tooltip={{ value: action.icon ? action.title : undefined, xs: true, nowrap: true }}
                                              onClick={prevented(action.onClick)}
                                              class={['text-2xs', action.icon ? 'p-0.5' : 'px-1 py-0.5']}
                                              key={action.title}
                                          >
                                              {action.icon ? <Icon icon={action.icon} /> : <span class="text-2xs">{action.title}</span>}
                                          </Button>
                                      ))
                                    : null}
                                <span class="bg-white/8 px-1.5 py-px select-none">{state.item.count ?? state.item.children.length ?? ''}</span>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
            {!state.item.children.length ? (
                <div class="px-5 py-2 text-xs opacity-50">{state.emptyText}</div>
            ) : !state.collapsed ? (
                <div class={state.scrollable ? 'overflow-auto' : ''}>
                    {state.visibleChildren.map((entryState) =>
                        p.slots?.default ? (
                            <div
                                style={state.noIndentation ? undefined : state.getRowPaddingStyle(entryState.depth + 1)}
                                class="group relative min-w-0 w-full transition"
                                key={`${entryState.item.id}`}
                            >
                                {p.slots?.default?.(defaultSlotProps(state, entryState))}
                            </div>
                        ) : (
                            <div
                                class={['group relative flex min-h-5 min-w-0 w-full items-center gap-1 px-2 text-left transition', state.getRowWrapperClass(entryState.item)]}
                                key={`${entryState.item.id}`}
                            >
                                <button
                                    type="button"
                                    data-testid={`file-tree-item-${entryState.item.id}`}
                                    aria-label={entryState.item.title}
                                    aria-expanded={entryState.isGroup ? !entryState.isCollapsed : undefined}
                                    draggable={state.canDragItem(entryState.item)}
                                    data-sidebar-row="true"
                                    data-node-id={state.getNodeId(entryState.item, entryState.isGroup)}
                                    data-parent-id={state.getParentId(entryState.item, entryState.isGroup)}
                                    data-sidebar-expandable={String(entryState.isGroup)}
                                    data-sidebar-collapsed={entryState.isGroup ? String(entryState.isCollapsed) : undefined}
                                    data-sidebar-self-toggle={entryState.isGroup && !state.selectGroups ? 'true' : undefined}
                                    style={state.noIndentation ? undefined : state.getRowPaddingStyle(entryState.depth)}
                                    onClick={(event) => state.onEntryClick(event as MouseEvent, entryState.item)}
                                    onDblclick={(event) => state.onEntryDoubleClick(event as MouseEvent, entryState.item)}
                                    onContextmenu={(e) => state.onContextMenu(e, entryState.item)}
                                    onDragstart={(event) => state.onDragStart(event, entryState.item)}
                                    onKeydown={(e) => state.onItemKeydown?.(e)}
                                    class="flex min-w-0 w-full flex-1 items-center gap-1.5 text-left overflow-hidden focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/50 focus-visible:bg-white/10"
                                >
                                    {entryState.isGroup ? (
                                        <span class={['icon shrink-0 text-sm opacity-60', entryState.isCollapsed ? 'icon-[mdi--chevron-right]' : 'icon-[mdi--chevron-down]']} />
                                    ) : (
                                        <span class="block w-3 shrink-0" />
                                    )}
                                    {p.slots?.itemLeftIcon?.({
                                        item: entryState.item,
                                        depth: entryState.depth,
                                        isGroup: entryState.isGroup,
                                        isCollapsed: entryState.isCollapsed,
                                    }) ?? (
                                        <>
                                            {state.leftIcon && state.leftIcon(entryState.item, entryState.isGroup) ? (
                                                <span class={twMerge('icon text-sm', state.leftIcon(entryState.item, entryState.isGroup))} />
                                            ) : null}
                                        </>
                                    )}
                                    <div class="flex min-w-0 flex-1 items-center py-px text-xs select-none">
                                        {p.slots?.itemTitle?.({
                                            item: entryState.item,
                                            depth: entryState.depth,
                                            isGroup: entryState.isGroup,
                                            isCollapsed: entryState.isCollapsed,
                                        }) ?? <p class="truncate text-xs leading-tight tracking-tight">{entryState.item.title}</p>}
                                    </div>
                                    {entryState.item.rightText ? (
                                        <p class="hidden min-w-0 flex-1 truncate pl-2 text-right text-2xs opacity-70 xl:block select-none">{entryState.item.rightText}</p>
                                    ) : null}
                                </button>
                                <div class="flex shrink-0 items-center gap-1">
                                    {p.slots?.itemRightIcon?.({
                                        item: entryState.item,
                                        depth: entryState.depth,
                                        isGroup: entryState.isGroup,
                                        isCollapsed: entryState.isCollapsed,
                                    }) ?? (
                                        <>
                                            {state.rightIcon && state.rightIcon(entryState.item, entryState.isGroup) ? (
                                                <span class={twMerge('icon text-sm', state.rightIcon(entryState.item, entryState.isGroup))} />
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    )}
                </div>
            ) : null}
        </section>
    );
};

export default FileTree;
