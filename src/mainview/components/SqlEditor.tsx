import { ref, computed } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import type { DbType, SqlDiagnosticMarker, SqlDiagnosticsResult } from '../../shared/types';
import { toast } from '../../shared/utils/useToast';
import { appClientRpc } from '../appClient';
import type { MonacoDiagnosticMarker } from '../lib/monaco';
import { MonacoEditor } from './MonacoEditor.tsx';
import { MonacoEditorSettingsButton } from './MonacoEditorSettingsButton.tsx';
import type { MonacoEditorActionZone } from './monacoEditorTypes';
import { component, ensureAllTsxProps, vModel } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    title: string;
    connectionId?: number;
    sqlDialect?: DbType;
    focusLine?: number;
    readonly?: boolean;
    actionZones?: MonacoEditorActionZone[];
    actionZoneVisibility?: 'always' | 'hover';
    extraMarkers?: MonacoDiagnosticMarker[];
    noHead?: boolean;
    onDiagnosticsChanged?: (result: SqlDiagnosticsResult) => void;
} & {
    modelValue: string;
    onChange?: (val: string) => unknown;
    onTableDrop?: (payload: { connectionId: number; tableName: string }) => void;
    slots?: { beforeHeaderActions?: () => unknown; afterHeader?: () => unknown };
};

export const SqlEditor = component(
    (props: Props) => {
        const modelValue = computed({
            get: () => props.modelValue,
            set: (value) => props.onChange?.(value),
        });

        const isFormatting = ref(false);
        const latestDiagnostics = ref<SqlDiagnosticsResult>({ markers: [], problemMarkers: [] });

        const hasBlockingErrors = computed(() => latestDiagnostics.value.markers.some((marker) => marker.severity === 'error'));

        const canFormat = computed(() => {
            return !props.readonly && !isFormatting.value && !hasBlockingErrors.value && Boolean(modelValue.value.trim()) && props.sqlDialect !== 'msaccess';
        });

        function handleDiagnosticsChanged(result: SqlDiagnosticsResult) {
            latestDiagnostics.value = result;
            props.onDiagnosticsChanged?.(result);
        }

        function getBlockingErrorMessage(markers: SqlDiagnosticMarker[]) {
            return markers.find((marker) => marker.severity === 'error')?.message || 'Formatting is disabled while SQL has parser or database errors.';
        }

        async function formatSql() {
            if (!modelValue.value.trim() || props.readonly || props.sqlDialect === 'msaccess' || isFormatting.value) {
                return;
            }

            const diagnostics = await appClientRpc.request.getSqlDiagnostics({
                sql: modelValue.value,
                dialect: props.sqlDialect,
                connectionId: props.connectionId,
            });

            handleDiagnosticsChanged(diagnostics);

            if (diagnostics.markers.some((marker) => marker.severity === 'error')) {
                toast.showToast(getBlockingErrorMessage(diagnostics.markers), 'warning');
                return;
            }

            isFormatting.value = true;

            try {
                modelValue.value = await appClientRpc.request.formatSql({
                    sql: modelValue.value,
                    dialect: props.sqlDialect,
                });
            } catch (error) {
                toast.showToast(error instanceof Error ? error.message : String(error), 'danger');
            } finally {
                isFormatting.value = false;
            }
        }

        return () => (
            <div class="relative flex h-full flex-col">
                {!props.noHead ? (
                    <div class="flex items-center gap-1 border-b border-x5 px-2 py-1.5 text-xs font-medium">
                        <div class="truncate flex-1 text-white">{props.title}</div>
                        {props.slots?.beforeHeaderActions?.()}
                        {/* <div v-if="state?.metaItems?.length" class="flex flex-wrap items-center gap-1 text-xs text-white/65">
                <Alert severity="secondary" v-for="item in state.metaItems" :key="item.id" class="rounded px-2 py-px tracking-tight" v-html="item.text"> </Alert>
            </div> */}
                        <Button severity="secondary" smaller={true} disabled={!canFormat.value} onClick={formatSql}>
                            Format
                        </Button>
                        <MonacoEditorSettingsButton hideDiffOptions={true} />
                    </div>
                ) : null}
                {props.slots?.afterHeader?.()}
                <MonacoEditor
                    noHead={true}
                    {...vModel(modelValue, 'value')}
                    extraMarkers={props.extraMarkers}
                    language="sql"
                    readonly={props.readonly}
                    sqlAutocompleteConnectionId={props.connectionId}
                    sqlAutocompleteDialect={props.sqlDialect}
                    onDiagnosticsChanged={handleDiagnosticsChanged}
                    onTableDrop={(payload) => props.onTableDrop?.(payload)}
                    class="overflow-y-auto text-xs leading-6 text-white/85"
                />
            </div>
        );
    },
    {
        name: 'SqlEditor',
        props: ensureAllTsxProps<Props>()([
            'title',
            'connectionId',
            'sqlDialect',
            'focusLine',
            'readonly',
            'actionZones',
            'actionZoneVisibility',
            'extraMarkers',
            'noHead',
            'onDiagnosticsChanged',
            'modelValue',
            'onChange',
            'onTableDrop',
            'slots',
        ]),
    }
);

export default SqlEditor;
