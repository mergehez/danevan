import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type { ContextMenuEntry } from '../../directives/contextMenuTypes';
import { Alert } from '../../shared/components/Alert.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { Checkbox } from '../../shared/components/Checkbox.tsx';
import { type CellValue, DataTable } from '../../shared/components/DataTable.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { ListBox } from '../../shared/components/ListBox.tsx';
import { useComparison } from '../composables/useComparison';
import type { ComparisonSection } from '../lib/compareSchemas';
import { comparisonOptionDefinitions } from '../lib/comparisonOptions';

type Props = {};

export const DbComparisonModal = component(
    (_: Props) => {
        const comparison = useComparison();
        const breakingPillRef = useTemplateRef<HTMLElement>('comparisonBreakingPill');
        const breakingPanelRef = useTemplateRef<HTMLElement>('comparisonBreakingPanel');
        const breakingOpen = ref(false);

        function handlePointerDown(event: PointerEvent) {
            const target = event.target as Node | null;

            if (!target) {
                return;
            }

            if (breakingPillRef.value?.contains(target) || breakingPanelRef.value?.contains(target)) {
                return;
            }

            breakingOpen.value = false;
        }

        // The panel is a plain anchored popover, so it closes itself when a click
        // lands outside both the pill and the panel.
        watch(breakingOpen, (open) => {
            window.removeEventListener('pointerdown', handlePointerDown);

            if (open) {
                window.addEventListener('pointerdown', handlePointerDown);
            }
        });

        onBeforeUnmount(() => window.removeEventListener('pointerdown', handlePointerDown));

        // Never reopen the modal with a stale panel already expanded.
        watch(
            () => comparison.open,
            (open) => {
                if (!open) {
                    breakingOpen.value = false;
                }
            }
        );

        function getCellClass(value: CellValue, context: { columnName: string }) {
            if (context.columnName !== 'Status') {
                return undefined;
            }

            switch (value) {
                case 'added':
                    return 'text-green-400';
                case 'removed':
                    return 'text-red-400';
                case 'changed':
                    return 'text-yellow-400';
                case 'identical':
                    return 'opacity-50';
                default:
                    return undefined;
            }
        }

        /**
         * Rows where one side is missing an object get a small add button in the
         * object cell; everything else keeps the default rendering.
         */
        function getCellContent(section: ComparisonSection, context: { columnName: string; rowIndex: number }) {
            if (context.columnName !== section.columns[0]) {
                return undefined;
            }

            const action = section.actions?.[context.rowIndex];

            if (!action) {
                return undefined;
            }

            return (
                <div class="flex items-center gap-1">
                    <span class="line-clamp-1 min-w-0">{String(section.rows[context.rowIndex]?.[context.columnName] ?? '')}</span>
                    <IconButton
                        icon="icon-[mdi--plus-circle-outline]"
                        smaller={true}
                        severity="raised"
                        disabled={comparison.isApplyingFix(action) || !comparison.canApplyFix(action)}
                        v-tooltip={{ value: comparison.getFixTooltip(action), xs: true }}
                        onClick={prevented(() => void comparison.applyFix(action))}
                    />
                </div>
            );
        }

        /** Grouped checkbox popover: one title row per object group, same source of truth as the diff. */
        function getOptionMenuItems(): ContextMenuEntry[] {
            const items: ContextMenuEntry[] = [];
            let currentGroup = '';

            for (const definition of comparisonOptionDefinitions) {
                if (definition.group !== currentGroup) {
                    currentGroup = definition.group;
                    items.push({ type: 'title', id: `comparison-options:${definition.group}`, title: definition.group });
                }

                items.push({
                    id: `comparison-option:${definition.id}`,
                    type: 'checkbox',
                    label: definition.label,
                    checked: comparison.getOption(definition.id),
                    action: () => comparison.toggleOption(definition.id),
                });
            }

            return items;
        }

        function renderSection(section: ComparisonSection) {
            if (section.rows.length === 0) {
                return null;
            }

            return (
                <section class="border-b border-x4 last:border-b-0" key={section.id}>
                    <header class="flex items-center gap-2 border-b border-x3 bg-x2 px-3 py-1.5">
                        <span class="text-2xs uppercase tracking-[0.2em]">{section.title}</span>
                        <span class={['text-2xs', section.differenceCount > 0 ? 'text-yellow-400' : 'opacity-60']}>
                            {section.summary ??
                                (section.differenceCount > 0 ? `${section.differenceCount} ${section.differenceCount === 1 ? 'difference' : 'differences'}` : 'no differences')}
                        </span>
                    </header>
                    <DataTable
                        columns={section.columns}
                        rows={section.rows}
                        rowKey={(_row, index) => `${section.id}:${index}`}
                        cellContent={(_value, context) => getCellContent(section, context)}
                        cellClass={getCellClass}
                        emptyText="No differences."
                    />
                </section>
            );
        }

        return () => (
            <CenteredModal
                open={comparison.open}
                localStorageKey="schema-comparison-modal"
                title={comparison.mode === 'table' ? 'Compare tables' : 'Compare databases'}
                compactHeader={true}
                minWidth={760}
                minHeight={420}
                contentClass="w-[86vw] h-[78vh] border-x4"
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        comparison.closeModal();
                    }
                }}
                slots={{
                    default: () => (
                        <div class="flex min-h-0 flex-1 flex-col bg-x1">
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-x3 bg-x2 px-3 py-2">
                                <div class="flex min-w-0 items-center gap-1">
                                    <span class="text-2xs uppercase tracking-[0.2em] opacity-60">Source</span>
                                    <span class="max-w-64 truncate text-xs" title={comparison.sourceLabel}>
                                        {comparison.sourceLabel || '—'}
                                    </span>
                                </div>
                                <IconButton
                                    icon="icon-[mdi--swap-horizontal]"
                                    smaller={true}
                                    disabled={!comparison.canSwap || comparison.loading}
                                    v-tooltip={{ value: 'Swap source and target', xs: true, nowrap: true }}
                                    onClick={() => void comparison.swapSides()}
                                />
                                <div class="flex min-w-0 items-center gap-1">
                                    <span class="text-2xs uppercase tracking-[0.2em] opacity-60">Target</span>
                                    <ListBox
                                        smaller={true}
                                        class="w-56"
                                        placeholder="Choose database..."
                                        selection={comparison.targetConnectionId}
                                        items={comparison.targetConnectionOptions}
                                        onSelect={(option) => void comparison.selectTargetConnection(option?.value)}
                                    />
                                    {comparison.mode === 'table' ? (
                                        <ListBox
                                            smaller={true}
                                            class="w-48"
                                            placeholder="Choose table..."
                                            selection={comparison.targetTableName}
                                            items={comparison.targetTableOptions}
                                            disabled={comparison.targetConnectionId === undefined}
                                            onSelect={(option) => void comparison.selectTargetTable(option?.value)}
                                        />
                                    ) : null}
                                </div>
                                <div class="ml-auto flex items-center gap-2">
                                    <Checkbox
                                        label="Differences only"
                                        smaller={true}
                                        modelValue={!comparison.showIdentical}
                                        onChange={(value) => (comparison.showIdentical = !value)}
                                    />
                                    <span class="text-2xs opacity-60">{`${comparison.differenceCount} ${comparison.differenceCount === 1 ? 'difference' : 'differences'}`}</span>
                                    {comparison.canCompare ? (
                                        <span class="relative inline-flex">
                                            <button
                                                ref="comparisonBreakingPill"
                                                type="button"
                                                aria-expanded={breakingOpen.value}
                                                v-tooltip={{ value: 'Breaking changes', xs: true, nowrap: true }}
                                                onClick={() => (breakingOpen.value = !breakingOpen.value)}
                                                class={[
                                                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition',
                                                    comparison.breakingCount > 0
                                                        ? 'border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20'
                                                        : 'border-x4 bg-x3 opacity-70 hover:opacity-100',
                                                ]}
                                            >
                                                <span class={['icon text-sm', comparison.breakingCount > 0 ? 'icon-[mdi--alert-outline]' : 'icon-[mdi--check-circle-outline]']} />
                                                <span>{comparison.breakingCount}</span>
                                            </button>
                                            {breakingOpen.value ? (
                                                <div
                                                    ref="comparisonBreakingPanel"
                                                    class="absolute right-0 top-full z-30 mt-1 max-h-80 w-96 overflow-auto border border-x4 bg-x2 shadow-2xl"
                                                >
                                                    <div class="border-b border-x3 px-3 py-1.5 text-2xs uppercase tracking-[0.2em] opacity-80">
                                                        {`Breaking changes (${comparison.breakingCount})`}
                                                    </div>
                                                    {comparison.breakingChanges.length === 0 ? (
                                                        <p class="px-3 py-2 text-xs opacity-60">
                                                            {comparison.ignoredBreakingCount > 0 ? 'No counted breaking changes.' : 'No breaking changes.'}
                                                        </p>
                                                    ) : (
                                                        comparison.breakingChanges.map((change) => (
                                                            <div class="flex items-start gap-2 border-b border-x3 px-3 py-1.5 text-xs last:border-b-0" key={change.id}>
                                                                <span class="mt-0.5 icon icon-[mdi--alert-outline] shrink-0 text-sm text-red-300" />
                                                                <span class="min-w-0">{change.text}</span>
                                                            </div>
                                                        ))
                                                    )}
                                                    {comparison.ignoredBreakingCount > 0 ? (
                                                        <p class={['bg-x3/40 px-3 py-2 text-2xs opacity-70', comparison.breakingChanges.length > 0 ? 'border-t border-x3' : '']}>
                                                            {`${comparison.ignoredBreakingCount} foreign key ${
                                                                comparison.ignoredBreakingCount === 1 ? 'difference is' : 'differences are'
                                                            } ignored by the comparison options.`}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </span>
                                    ) : null}
                                    <IconButton
                                        icon="icon-[mdi--refresh]"
                                        smaller={true}
                                        disabled={comparison.loading || !comparison.canCompare}
                                        v-tooltip={{ value: 'Reload metadata and compare again', xs: true, nowrap: true }}
                                        onClick={() => void comparison.refresh()}
                                    />
                                    <IconButton
                                        icon="icon-[mdi--download-outline]"
                                        smaller={true}
                                        disabled={comparison.visibleSections.length === 0}
                                        v-tooltip={{ value: 'Export as Markdown', xs: true, nowrap: true }}
                                        onClick={() => comparison.exportMarkdown()}
                                    />
                                    <IconButton
                                        icon="icon-[mdi--dots-horizontal]"
                                        smaller={true}
                                        v-tooltip={{ value: 'Comparison options', xs: true, nowrap: true }}
                                        v-menu={{ value: getOptionMenuItems, button: true }}
                                    />
                                </div>
                            </div>
                            <div class="flex min-h-0 flex-1 flex-col overflow-auto">
                                {comparison.loading ? (
                                    <div class="flex items-center gap-2 px-3 py-2 text-xs opacity-70">
                                        <span class="icon icon-[mdi--loading] animate-spin text-base" />
                                        <span>Reading both schemas...</span>
                                    </div>
                                ) : null}
                                {comparison.errorMessage ? (
                                    <Alert severity="danger" small={true} class="m-3">
                                        {comparison.errorMessage}
                                    </Alert>
                                ) : null}
                                {!comparison.canCompare ? (
                                    <div class="px-3 py-8 text-center text-xs opacity-60">
                                        {comparison.mode === 'table' ? 'Choose a target table to compare with.' : 'Choose a target database to compare with.'}
                                    </div>
                                ) : comparison.visibleSections.length === 0 && !comparison.loading ? (
                                    <div class="px-3 py-8 text-center text-xs opacity-60">No differences to display.</div>
                                ) : (
                                    comparison.visibleSections.map((section) => renderSection(section))
                                )}
                            </div>
                            {comparison.differenceCount > 0 ? (
                                <div class="border-t border-x3 bg-x2 px-3 py-1 text-2xs opacity-60">added = present in source only · removed = present in target only</div>
                            ) : null}
                        </div>
                    ),
                }}
            />
        );
    },
    { name: 'DbComparisonModal', props: ensureAllTsxProps<Props>()([]) }
);

export default DbComparisonModal;
