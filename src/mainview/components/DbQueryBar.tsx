import { component, ensureAllTsxProps, looseToNumber, prevented, preventedKeys, tsxWithDefaults } from '#shared/utils/tsxHelpers.tsx';
import { computed, onBeforeUnmount, ref, Teleport, watch } from 'vue';
import { useOverlaysState } from '../../directives/useOverlaysState';
import { Button } from '../../shared/components/Button.tsx';
import { Checkbox } from '../../shared/components/Checkbox.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { Select } from '../../shared/components/Select.tsx';
import { useConnections } from '../composables/useConnections';
import { useQuery } from '../composables/useQuery';

type Props = {};

type QueryBarMenuProps = {
    open: boolean;
    width?: number;
    testId?: string;
    onUpdateOpen?: (open: boolean) => void;
    slots?: { trigger?: () => unknown; default?: () => unknown };
};

/**
 * One chip of the interactive bar plus the panel it opens. The panel is teleported to the body and
 * anchored under its trigger, so the panel's own scroll area cannot clip it.
 */
const QueryBarMenu = component(
    (_props: QueryBarMenuProps) => {
        const props = tsxWithDefaults(_props, { width: 320 });
        const triggerRef = ref<HTMLElement | null>(null);
        const panelRef = ref<HTMLElement | null>(null);
        const panelStyle = ref<Record<string, string>>({});
        const overlayState = useOverlaysState();
        const zIndex = ref(90);

        /** Anchored under the trigger and capped to the room below it, then scrolled internally. */
        function positionPanel() {
            const trigger = triggerRef.value;

            if (!trigger) {
                return;
            }

            const rect = trigger.getBoundingClientRect();
            const width = Math.min(props.width, window.innerWidth - 16);
            const left = Math.min(Math.max(rect.left, 8), Math.max(window.innerWidth - width - 8, 8));
            const top = rect.bottom + 4;

            panelStyle.value = {
                left: `${Math.round(left)}px`,
                top: `${Math.round(top)}px`,
                width: `${Math.round(width)}px`,
                maxHeight: `${Math.round(Math.max(window.innerHeight - top - 8, 160))}px`,
            };
        }

        function onDocumentPointerDown(event: PointerEvent) {
            const target = event.target as Node | null;

            if (!target || triggerRef.value?.contains(target) || panelRef.value?.contains(target)) {
                return;
            }

            props.onUpdateOpen?.(false);
        }

        function onDocumentKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                props.onUpdateOpen?.(false);
            }
        }

        function unbindWindowListeners() {
            window.removeEventListener('pointerdown', onDocumentPointerDown, true);
            window.removeEventListener('keydown', onDocumentKeyDown);
            window.removeEventListener('resize', positionPanel);
            window.removeEventListener('scroll', positionPanel, true);
        }

        watch(
            () => props.open,
            (open) => {
                zIndex.value = open ? overlayState.claimZIndex() : overlayState.releaseZIndex(zIndex.value);
                unbindWindowListeners();

                if (!open) {
                    return;
                }

                positionPanel();
                window.addEventListener('pointerdown', onDocumentPointerDown, true);
                window.addEventListener('keydown', onDocumentKeyDown);
                window.addEventListener('resize', positionPanel);
                window.addEventListener('scroll', positionPanel, true);
            },
            { immediate: true }
        );

        onBeforeUnmount(unbindWindowListeners);

        return () => (
            <span ref={triggerRef} class="relative inline-flex" data-query-bar-chip={props.testId} data-testid={props.testId ? `${props.testId}-trigger` : undefined}>
                <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={props.open}
                    onClick={prevented(() => props.onUpdateOpen?.(!props.open))}
                    class="inline-flex text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/70"
                >
                    {props.slots?.trigger?.()}
                </button>
                {props.open ? (
                    <Teleport to="body">
                        <div
                            ref={panelRef}
                            role="dialog"
                            data-testid={props.testId ? `${props.testId}-panel` : undefined}
                            class="fixed overflow-auto border border-x4 bg-x1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
                            style={{ ...panelStyle.value, zIndex: zIndex.value }}
                        >
                            {props.slots?.default?.()}
                        </div>
                    </Teleport>
                ) : null}
            </span>
        );
    },
    { name: 'QueryBarMenu', props: ensureAllTsxProps<QueryBarMenuProps>()(['open', 'width', 'testId', 'onUpdateOpen', 'slots']) }
);

/** A chip: `label value ▾`. Outlined in blue while the control adds something to the query. */
function renderChip(label: string, value: string, isActive: boolean) {
    return (
        <span
            class={[
                'inline-flex items-center gap-1 border px-1.5 py-0.5 text-xs transition',
                isActive ? 'border-blue-500/60 bg-blue-500/10 text-default' : 'border-x4 bg-x1 text-default opacity-80 hover:opacity-100',
            ]}
        >
            {label ? <span class="text-2xs uppercase tracking-tight opacity-60">{label}</span> : null}
            {value ? <span class="max-w-48 truncate">{value}</span> : null}
            <i class="icon icon-[mdi--chevron-down] text-3xs opacity-60" />
        </span>
    );
}

const INPUT_CLASS = 'min-w-0 flex-1 border border-x4 bg-x1 px-1.5 py-0.5 font-mono text-xs outline-none transition focus:border-x5';
const NUMBER_CLASS = 'w-16 border border-x4 bg-x1 px-1.5 py-0.5 font-mono text-xs outline-none transition focus:border-x5';
const TRIGGER_CLASS = 'border border-x4 bg-x1 px-1.5 py-0.5 text-xs opacity-80 transition hover:opacity-100';

export const DbQueryBar = component(
    (_: Props) => {
        const query = useQuery();
        const connections = useConnections();

        const openMenu = ref<'mode' | 'columns' | 'where' | 'order' | undefined>();
        // Written by the per-row function refs so "Add" can focus the row it just appended.
        const whereInputs: Array<HTMLInputElement | undefined> = [];
        const expressionInputs: Array<HTMLInputElement | undefined> = [];

        const draft = computed(() => query.interactiveDraft);
        const tableColumns = computed(() => query.tableInfo?.columns.map((column) => column.name) ?? []);
        // The connection the panel is showing, not the sidebar's selection: the statement must
        // belong to the database whose table is on screen.
        const dialect = computed(() => connections.getConnectionDialect(query.loadedConnectionId));
        const generatedSql = computed(() => query.buildInteractiveQuerySql(dialect.value));
        const isInteractive = computed(() => query.customQueryEditorMode === 'interactive');

        const whereConditions = computed(() => draft.value.where.filter((condition) => condition.trim()).length);
        const orderClauses = computed(() => draft.value.orderBy.filter((clause) => clause.column.trim()).length);
        const customColumnCount = computed(() => draft.value.columns.length + draft.value.expressions.filter((expression) => expression.trim()).length);
        const columnsSummary = computed(() => {
            if (draft.value.selectMode === 'all') {
                return '*';
            }

            return customColumnCount.value === 1 ? '1 column' : `${customColumnCount.value} columns`;
        });

        const columnOptions = computed(() => tableColumns.value.map((name) => ({ label: name, value: name })));
        const directionOptions = ['ASC', 'DESC'];
        const selectModeOptions = ['All', 'Custom'];

        function setMenu(menu: 'mode' | 'columns' | 'where' | 'order', open: boolean) {
            openMenu.value = open ? menu : openMenu.value === menu ? undefined : openMenu.value;
        }

        function setEditorMode(mode: 'interactive' | 'manual') {
            query.customQueryEditorMode = mode;
            openMenu.value = undefined;
        }

        function runInteractive() {
            openMenu.value = undefined;
            void query.runInteractiveQuery(dialect.value);
        }

        function runOnEnter() {
            runInteractive();
        }

        /** Switching to Custom starts on every column: the user removes what they do not want. */
        function setSelectMode(mode: 'all' | 'custom') {
            draft.value.selectMode = mode;

            if (mode === 'custom' && draft.value.columns.length === 0 && draft.value.expressions.every((expression) => !expression.trim())) {
                draft.value.columns = [...tableColumns.value];
            }
        }

        function toggleColumn(columnName: string) {
            if (draft.value.columns.includes(columnName)) {
                draft.value.columns = draft.value.columns.filter((name) => name !== columnName);
                return;
            }

            // Keep the table's own column order, so the SELECT list does not depend on click order.
            draft.value.columns = [...draft.value.columns, columnName].sort((left, right) => tableColumns.value.indexOf(left) - tableColumns.value.indexOf(right));
        }

        function addWhereCondition() {
            draft.value.where.push('');
            void focusLast(whereInputs);
        }

        function removeWhereCondition(index: number) {
            draft.value.where.splice(index, 1);
            whereInputs.splice(index, 1);
        }

        function addExpression() {
            draft.value.expressions.push('');
            void focusLast(expressionInputs);
        }

        function removeExpression(index: number) {
            draft.value.expressions.splice(index, 1);
            expressionInputs.splice(index, 1);
        }

        function addOrderClause() {
            draft.value.orderBy.push({ column: tableColumns.value[0] ?? '', direction: 'ASC' });
        }

        function removeOrderClause(index: number) {
            draft.value.orderBy.splice(index, 1);
        }

        function setOrderColumn(index: number, column: string) {
            const clause = draft.value.orderBy[index];

            if (clause) {
                clause.column = column;
            }
        }

        function setOrderDirection(index: number, direction: string) {
            const clause = draft.value.orderBy[index];

            if (clause) {
                clause.direction = direction === 'DESC' ? 'DESC' : 'ASC';
            }
        }

        function toggleOrderDirection(index: number) {
            const clause = draft.value.orderBy[index];

            if (clause) {
                clause.direction = clause.direction === 'ASC' ? 'DESC' : 'ASC';
            }
        }

        async function focusLast(inputs: Array<HTMLInputElement | undefined>) {
            await Promise.resolve();
            inputs[inputs.length - 1]?.focus();
        }

        /** The rows are rendered from an array, so a slot ref keeps each input addressable by index. */
        function bindRowInput(inputs: Array<HTMLInputElement | undefined>, index: number) {
            return {
                ref: (element: unknown) => {
                    inputs[index] = element instanceof HTMLInputElement ? element : undefined;
                },
            };
        }

        function renderSqlPreview() {
            return (
                <pre
                    data-testid="query-bar-sql-preview"
                    v-tooltip={{ value: 'This statement is built from the controls above', xs: true }}
                    class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap border-t border-x3 pt-1.5 font-mono text-2xs text-default opacity-70"
                >
                    {generatedSql.value || 'No table selected.'}
                </pre>
            );
        }

        function renderColumnsPanel() {
            return (
                <div class="flex flex-col gap-2 p-2">
                    <div class="flex items-center gap-2">
                        <span class="text-2xs uppercase tracking-tight opacity-60">Columns</span>
                        <Select
                            data-testid="query-bar-select-mode"
                            modelValue={draft.value.selectMode === 'custom' ? 'Custom' : 'All'}
                            options={selectModeOptions}
                            smaller={true}
                            onChange={(value) => setSelectMode(value === 'Custom' ? 'custom' : 'all')}
                        />
                    </div>
                    {draft.value.selectMode === 'custom' ? (
                        <>
                            <div class="flex flex-wrap gap-x-3 gap-y-1">
                                {tableColumns.value.map((columnName) => (
                                    <Checkbox
                                        data-testid={`query-bar-column-${columnName}`}
                                        modelValue={draft.value.columns.includes(columnName)}
                                        smaller={true}
                                        label={columnName}
                                        onChange={() => toggleColumn(columnName)}
                                        key={columnName}
                                    />
                                ))}
                            </div>
                            {draft.value.expressions.map((expression, index) => (
                                <div class="flex items-center gap-1" key={`expression-${index}`}>
                                    <input
                                        {...bindRowInput(expressionInputs, index)}
                                        data-testid={`query-bar-expression-${index}`}
                                        value={expression}
                                        placeholder="count(*) as total"
                                        onInput={(event: any) => (draft.value.expressions[index] = event.target.value)}
                                        onKeydown={preventedKeys(runOnEnter, ['enter'])}
                                        class={INPUT_CLASS}
                                    />
                                    <IconButton
                                        icon="icon-[mdi--close]"
                                        v-tooltip={{ value: 'Remove expression', xs: true, nowrap: true }}
                                        smaller={true}
                                        onClick={() => removeExpression(index)}
                                    />
                                </div>
                            ))}
                            <Button severity="secondary" smaller={true} data-testid="query-bar-expression-add" onClick={addExpression}>
                                Add expression
                            </Button>
                        </>
                    ) : (
                        <p class="text-2xs opacity-60">Every column of the table. Pick Custom to choose columns or add expressions.</p>
                    )}
                    {renderSqlPreview()}
                </div>
            );
        }

        function renderWherePanel() {
            return (
                <div class="flex flex-col gap-2 p-2">
                    {draft.value.where.length === 0 ? <p class="text-2xs opacity-60">No conditions yet. Each row is joined with AND.</p> : null}
                    {draft.value.where.map((condition, index) => (
                        <div class="flex flex-col gap-1" key={`where-${index}`}>
                            {index > 0 ? <span class="text-2xs uppercase tracking-tight opacity-50">AND</span> : null}
                            <div class="flex items-center gap-1">
                                <input
                                    {...bindRowInput(whereInputs, index)}
                                    data-testid={`query-bar-where-${index}`}
                                    value={condition}
                                    list="query-bar-where-columns"
                                    placeholder="age > 30"
                                    onInput={(event: any) => (draft.value.where[index] = event.target.value)}
                                    onKeydown={preventedKeys(runOnEnter, ['enter'])}
                                    class={INPUT_CLASS}
                                />
                                <IconButton
                                    icon="icon-[mdi--close]"
                                    v-tooltip={{ value: 'Remove condition', xs: true, nowrap: true }}
                                    smaller={true}
                                    onClick={() => removeWhereCondition(index)}
                                />
                            </div>
                        </div>
                    ))}
                    <datalist id="query-bar-where-columns">
                        {tableColumns.value.map((columnName) => (
                            <option value={columnName} key={columnName} />
                        ))}
                    </datalist>
                    <Button severity="secondary" smaller={true} data-testid="query-bar-where-add" onClick={addWhereCondition}>
                        Add condition
                    </Button>
                    <p class="text-2xs opacity-50">SQL goes in as written; the field suggests this table's columns.</p>
                    {renderSqlPreview()}
                </div>
            );
        }

        function renderOrderPanel() {
            return (
                <div class="flex flex-col gap-2 p-2">
                    {draft.value.orderBy.length === 0 ? <p class="text-2xs opacity-60">No ordering yet. Rows come back in the database's own order.</p> : null}
                    {draft.value.orderBy.map((clause, index) => (
                        <div class="flex items-center gap-1" key={`order-${index}`}>
                            <Select
                                data-testid={`query-bar-order-column-${index}`}
                                class="min-w-0 flex-1"
                                modelValue={clause.column}
                                options={columnOptions.value}
                                smaller={true}
                                onChange={(value) => setOrderColumn(index, value)}
                            />
                            <Select
                                data-testid={`query-bar-order-direction-${index}`}
                                class="w-16 shrink-0"
                                modelValue={clause.direction}
                                options={directionOptions}
                                smaller={true}
                                onChange={(value) => setOrderDirection(index, value)}
                            />
                            <IconButton
                                icon="icon-[mdi--swap-vertical]"
                                v-tooltip={{ value: 'Toggle direction', xs: true, nowrap: true }}
                                smaller={true}
                                onClick={() => toggleOrderDirection(index)}
                            />
                            <IconButton
                                icon="icon-[mdi--close]"
                                v-tooltip={{ value: 'Remove order', xs: true, nowrap: true }}
                                smaller={true}
                                onClick={() => removeOrderClause(index)}
                            />
                        </div>
                    ))}
                    <Button severity="secondary" smaller={true} data-testid="query-bar-order-add" onClick={addOrderClause}>
                        Add order column
                    </Button>
                    {renderSqlPreview()}
                </div>
            );
        }

        return () => (
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-x4 bg-x0 px-2 py-1" data-testid="query-bar">
                <QueryBarMenu
                    open={openMenu.value === 'mode'}
                    width={200}
                    testId="query-bar-mode"
                    onUpdateOpen={(open) => setMenu('mode', open)}
                    slots={{
                        trigger: () => (
                            <span class={[TRIGGER_CLASS, 'inline-flex items-center gap-1 border-x5 font-semibold text-default'].join(' ')}>
                                <i class={['icon', isInteractive.value ? 'icon-[mdi--cursor-default-click]' : 'icon-[mdi--console]', 'text-sm']} />
                                {isInteractive.value ? 'Interactive' : 'Manual'}
                                <i class="icon icon-[mdi--chevron-down] text-3xs opacity-60" />
                            </span>
                        ),
                        default: () => (
                            <div class="flex flex-col py-1 text-xs">
                                <button
                                    type="button"
                                    data-testid="query-bar-mode-interactive"
                                    onClick={() => setEditorMode('interactive')}
                                    class="flex items-center justify-between gap-3 px-3 py-1 text-left transition hover:bg-white/8"
                                >
                                    <span>Interactive</span>
                                    <span class="text-2xs opacity-70">{isInteractive.value ? '✓' : ''}</span>
                                </button>
                                <button
                                    type="button"
                                    data-testid="query-bar-mode-manual"
                                    onClick={() => setEditorMode('manual')}
                                    class="flex items-center justify-between gap-3 px-3 py-1 text-left transition hover:bg-white/8"
                                >
                                    <span>Manual</span>
                                    <span class="text-2xs opacity-70">{isInteractive.value ? '' : '✓'}</span>
                                </button>
                            </div>
                        ),
                    }}
                />
                <div class="h-4 w-px bg-x4" />
                {isInteractive.value ? (
                    <>
                        <span class="font-mono text-xs font-semibold opacity-80">SELECT</span>
                        <QueryBarMenu
                            open={openMenu.value === 'columns'}
                            width={340}
                            testId="query-bar-columns"
                            onUpdateOpen={(open) => setMenu('columns', open)}
                            slots={{
                                trigger: () => renderChip('', columnsSummary.value, draft.value.selectMode === 'custom'),
                                default: renderColumnsPanel,
                            }}
                        />
                        <span class="font-mono text-xs opacity-60">FROM</span>
                        <span class="max-w-64 truncate font-mono text-xs font-semibold text-default" data-testid="query-bar-table">
                            {query.selectedTableName}
                        </span>
                        <QueryBarMenu
                            open={openMenu.value === 'where'}
                            width={340}
                            testId="query-bar-where"
                            onUpdateOpen={(open) => setMenu('where', open)}
                            slots={{
                                trigger: () => renderChip('where', whereConditions.value ? String(whereConditions.value) : '', whereConditions.value > 0),
                                default: renderWherePanel,
                            }}
                        />
                        <QueryBarMenu
                            open={openMenu.value === 'order'}
                            width={360}
                            testId="query-bar-order"
                            onUpdateOpen={(open) => setMenu('order', open)}
                            slots={{
                                trigger: () => renderChip('order by', orderClauses.value ? String(orderClauses.value) : '', orderClauses.value > 0),
                                default: renderOrderPanel,
                            }}
                        />
                        <label class="flex items-center gap-1 font-mono text-xs">
                            <span class="text-2xs uppercase tracking-tight opacity-60">limit</span>
                            <input
                                data-testid="query-bar-limit"
                                type="number"
                                min="0"
                                placeholder="all"
                                value={draft.value.limit}
                                onChange={(event: any) => (draft.value.limit = looseToNumber(event.target.value))}
                                onKeydown={preventedKeys(runOnEnter, ['enter'])}
                                class={NUMBER_CLASS}
                            />
                        </label>
                        <label class="flex items-center gap-1 font-mono text-xs">
                            <span class="text-2xs uppercase tracking-tight opacity-60">offset</span>
                            <input
                                data-testid="query-bar-offset"
                                type="number"
                                min="0"
                                placeholder="0"
                                value={draft.value.offset}
                                onChange={(event: any) => (draft.value.offset = looseToNumber(event.target.value))}
                                onKeydown={preventedKeys(runOnEnter, ['enter'])}
                                class={NUMBER_CLASS}
                            />
                        </label>
                    </>
                ) : (
                    <input
                        data-testid="query-bar-manual-input"
                        value={query.customQueryText}
                        onInput={(event: any) => query.setCustomQueryText(event.target.value)}
                        placeholder="select * from myTable limit 100;"
                        onKeydown={preventedKeys(() => query.runCustomQuery(), ['enter'])}
                        class="min-w-0 flex-1 border border-x4 bg-x1 px-2 py-1 font-mono text-xs outline-none transition focus:border-x5"
                    />
                )}
                <div class="ml-auto flex items-center gap-1">
                    {query.isCustomQueryMode ? (
                        <IconButton
                            data-testid="query-bar-reset"
                            icon="icon-[mdi--backup-restore]"
                            v-tooltip={{ value: 'Reset to generated query', xs: true, nowrap: true }}
                            smaller={true}
                            severity="secondary"
                            onClick={() => query.clearCustomQuery()}
                        />
                    ) : null}
                    <IconButton
                        data-testid="query-bar-run"
                        icon={query.isRunningQuery ? 'icon-[mdi--loading] animate-spin' : 'icon-[mdi--play]'}
                        v-tooltip={{ value: 'Run query', xs: true, nowrap: true }}
                        smaller={true}
                        severity="primary"
                        disabled={isInteractive.value ? !generatedSql.value || query.isRunningQuery : !query.customQueryText.trim() || query.isRunningQuery}
                        onClick={() => (isInteractive.value ? runInteractive() : void query.runCustomQuery())}
                    />
                </div>
            </div>
        );
    },
    { name: 'DbQueryBar', props: ensureAllTsxProps<Props>()([]) }
);

export default DbQueryBar;
