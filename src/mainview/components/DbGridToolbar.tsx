import { ref, computed, watch } from 'vue';
import type { TDataGridState } from '../../datagrid/useDataGrid';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { component, ensureAllTsxProps, type SingleChildSlot, renderSlot } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    gridState: TDataGridState;
    title: string;
    isLoading?: boolean;
    showPageNav?: boolean;
    pageRangeStart?: number;
    pageRangeEnd?: number;
    totalRowCount?: number;
    canGoToPreviousPage?: boolean;
    canGoToNextPage?: boolean;
    onGoToPreviousPage?: () => void;
    onGoToNextPage?: () => void;
    pageSizeMenuOptions?: { value: number; label: string; isDefault: boolean }[];
    selectedDataLimit?: number;
    onSelectPageSize?: (limit: number) => void;
    disabled?: boolean;
    onAddRow?: () => void;
    onReload?: () => void;
} & {
    onToggleColumn?: (columnName: string) => void;
    slots?: SingleChildSlot;
};

export const DbGridToolbar = component(
    (props: Props) => {
        const columnMenuElement = ref<HTMLElement>();
        const columnButtonElement = ref<HTMLElement>();
        const isColumnMenuOpen = ref(false);
        const pageSizeMenuElement = ref<HTMLElement>();
        const pageSizeButtonElement = ref<HTMLElement>();
        const isPageSizeMenuOpen = ref(false);

        const visibleColumnCount = computed(() => {
            const hidden = new Set(props.gridState.hiddenColumns as string[]);
            return props.gridState.allColumns.filter((c: string) => !hidden.has(c)).length;
        });

        const totalColumnCount = computed(() => props.gridState.allColumns.length);

        function toggleColumnMenu() {
            isColumnMenuOpen.value = !isColumnMenuOpen.value;
        }

        function closeColumnMenu() {
            isColumnMenuOpen.value = false;
        }

        function togglePageSizeMenu() {
            isPageSizeMenuOpen.value = !isPageSizeMenuOpen.value;
        }

        function closePageSizeMenu() {
            isPageSizeMenuOpen.value = false;
        }

        function handlePointerDown(event: PointerEvent) {
            const target = event.target as Node | null;

            if (!target) {
                return;
            }

            if (columnMenuElement.value?.contains(target) || columnButtonElement.value?.contains(target)) {
                return;
            }

            if (pageSizeMenuElement.value?.contains(target) || pageSizeButtonElement.value?.contains(target)) {
                return;
            }

            closeColumnMenu();
            closePageSizeMenu();
        }

        watch(isColumnMenuOpen, () => {
            window.removeEventListener('pointerdown', handlePointerDown);

            if (isColumnMenuOpen.value || isPageSizeMenuOpen.value) {
                window.addEventListener('pointerdown', handlePointerDown);
            }
        });

        watch(isPageSizeMenuOpen, () => {
            window.removeEventListener('pointerdown', handlePointerDown);

            if (isColumnMenuOpen.value || isPageSizeMenuOpen.value) {
                window.addEventListener('pointerdown', handlePointerDown);
            }
        });

        return () => (
            <div class="flex min-w-0 flex-1 items-center gap-3">
                {/* Title */}
                <h2 class="shrink-0 text-sm font-semibold text-reverse">{props.title}</h2>
                {/* Custom controls — hidden when custom query is active */}
                {!props.disabled ? (
                    <>
                        <span ref={columnButtonElement} class="relative">
                            <button type="button" onClick={toggleColumnMenu} class="border border-x7 bg-x2 px-1 rounded-md text-2xs opacity-60 hover:opacity-100 transition">
                                {visibleColumnCount.value} of {totalColumnCount.value}columns
                            </button>
                            {isColumnMenuOpen.value ? (
                                <div ref={columnMenuElement} class="absolute left-0 top-full z-20 mt-1 min-w-40 border border-x4 bg-x1 py-1">
                                    <div class="px-3 py-1 text-2xs opacity-60">Visible Columns</div>
                                    {(props.gridState.allColumns ?? []).map((columnName) => (
                                        <label class="flex items-center gap-2 px-3 py-1 text-xs hover:bg-white/8" key={columnName}>
                                            <input
                                                type="checkbox"
                                                checked={!props.gridState.hiddenColumns.includes(columnName)}
                                                onChange={() => props.onToggleColumn?.(columnName)}
                                                class="h-3 w-3 rounded border-white/20 bg-transparent accent-white"
                                            />
                                            <span class="truncate">{columnName}</span>
                                        </label>
                                    ))}
                                </div>
                            ) : null}
                        </span>
                        {/* Page navigation */}
                        {props.showPageNav ? (
                            <div class="relative flex items-center text-2xs text-white">
                                <IconButton
                                    icon="icon-[mdi--chevron-left]"
                                    v-tooltip={'Previous page'}
                                    severity="secondary"
                                    disabled={!props.canGoToPreviousPage}
                                    onClick={() => props.onGoToPreviousPage?.()}
                                    class="rounded-r-none"
                                />
                                <div class="relative">
                                    <button
                                        ref={pageSizeButtonElement}
                                        type="button"
                                        disabled={props.isLoading}
                                        onClick={togglePageSizeMenu}
                                        class="inline-flex h-7 items-center gap-1 border border-x4 bg-x2 px-2 text-2xs opacity-80 transition hover:bg-x3 hover:opacity-100"
                                    >
                                        <span>
                                            {props.pageRangeStart}-{props.pageRangeEnd}
                                        </span>
                                        <span class="opacity-60">of {props.totalRowCount}</span>
                                        <span class="iconify icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-70" />
                                    </button>
                                    {isPageSizeMenuOpen.value ? (
                                        <div ref={pageSizeMenuElement} class="absolute left-0 right-0 top-full z-20 border-y border-x4 bg-x1 py-1">
                                            <div class="px-3 py-1 text-2xs opacity-60">Page Size</div>
                                            {(props.pageSizeMenuOptions ?? []).map((option) => (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        props.onSelectPageSize?.(option.value);
                                                        closePageSizeMenu();
                                                    }}
                                                    class="flex w-full items-center justify-between gap-3 px-3.5 py-1 text-left text-xs transition hover:bg-white/8"
                                                    key={option.value}
                                                >
                                                    <span class="inline-flex min-w-0 items-center gap-2">
                                                        <span>{option.label}</span>
                                                        <span class="h-4 w-4 text-center text-xs opacity-80">{props.selectedDataLimit === option.value ? '✓' : ''}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                                <IconButton
                                    icon="icon-[mdi--chevron-right]"
                                    v-tooltip={'Next page'}
                                    disabled={!props.canGoToNextPage}
                                    severity="secondary"
                                    onClick={() => props.onGoToNextPage?.()}
                                    class="rounded-l-none"
                                />
                            </div>
                        ) : (
                            <div class="flex-1">{renderSlot(props.slots)}</div>
                        )}
                        {/* Add row button */}
                        {props.onAddRow ? <IconButton icon="icon-[mdi--plus]" v-tooltip={'Add row'} smaller={true} severity="secondary" onClick={props.onAddRow!} /> : null}
                        {/* Reload button */}
                        {props.onReload ? (
                            <IconButton
                                icon={props.isLoading ? 'icon-[mdi--loading] animate-spin' : 'icon-[mdi--reload]'}
                                v-tooltip={'Reload'}
                                smaller={true}
                                disabled={props.isLoading}
                                onClick={props.onReload!}
                            />
                        ) : null}
                    </>
                ) : (
                    <span class="font-bold text-2xs text-yellow-500">{props.gridState.disabledFiltersMessage}</span>
                )}
            </div>
        );
    },
    {
        name: 'DbGridToolbar',
        props: ensureAllTsxProps<Props>()([
            'gridState',
            'title',
            'isLoading',
            'showPageNav',
            'pageRangeStart',
            'pageRangeEnd',
            'totalRowCount',
            'canGoToPreviousPage',
            'canGoToNextPage',
            'onGoToPreviousPage',
            'onGoToNextPage',
            'pageSizeMenuOptions',
            'selectedDataLimit',
            'onSelectPageSize',
            'disabled',
            'onAddRow',
            'onReload',
            'onToggleColumn',
            'slots',
        ]),
    }
);

export default DbGridToolbar;
