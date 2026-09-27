import { computed } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { IconButton } from '../../shared/components/IconButton.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    pendingChangeCount: number;
    canUndo: boolean;
    canRedo: boolean;
    isSavingChanges?: boolean;
    saveButtonLabel?: string;
    supportsForeignKeyCheckToggle?: boolean;
    disableForeignKeyChecks?: boolean;
    onClearChanges?: () => void;
    onUndoChanges?: () => void;
    onRedoChanges?: () => void;
    onPreviewChanges?: () => void;
    onSaveChanges?: () => void;
    onSetDisableForeignKeyChecks?: (value: boolean) => void;
};

export const DbSaveBar = component(
    (props: Props) => {
        const showSaveBar = computed(() => props.pendingChangeCount > 0 || props.canUndo || props.canRedo);
        const changeLabel = computed(() => (props.pendingChangeCount === 1 ? 'change' : 'changes'));
        const resolvedSaveLabel = computed(() => props.saveButtonLabel || `Save ${props.pendingChangeCount} ${changeLabel.value}`);

        return () => (
            <>
                {showSaveBar.value ? (
                    <div class="mb-3 flex items-center justify-between gap-3 border border-amber-300/25 bg-amber-300/8 px-3 py-2 text-2xs">
                        <span class="flex items-center gap-2">
                            <IconButton icon="icon-[mdi--close]" smaller={true} severity="secondary" onClick={() => props.onClearChanges?.()} />
                            <span>
                                {props.pendingChangeCount} pending {changeLabel.value}
                            </span>
                        </span>
                        <div class="flex items-center gap-3">
                            {props.supportsForeignKeyCheckToggle ? (
                                <label class="flex cursor-pointer items-center gap-2 opacity-80 transition hover:opacity-100">
                                    <input
                                        checked={props.disableForeignKeyChecks}
                                        type="checkbox"
                                        onChange={(e) => props.onSetDisableForeignKeyChecks?.((e.target as HTMLInputElement).checked)}
                                        class="h-4 w-4 rounded border-white/20 bg-transparent accent-white"
                                    />
                                    <span>Disable FK checks</span>
                                </label>
                            ) : null}
                            <div class="flex items-center gap-2">
                                <Button severity="secondary" smaller={true} disabled={!props.canUndo} onClick={() => props.onUndoChanges?.()}>
                                    {' '}
                                    Undo{' '}
                                </Button>
                                <Button severity="secondary" smaller={true} disabled={!props.canRedo} onClick={() => props.onRedoChanges?.()}>
                                    {' '}
                                    Redo{' '}
                                </Button>
                                <Button severity="secondary" smaller={true} disabled={!props.pendingChangeCount} onClick={() => props.onPreviewChanges?.()}>
                                    {' '}
                                    Preview{' '}
                                </Button>
                                <Button severity="primary" smaller={true} disabled={!props.pendingChangeCount || props.isSavingChanges} onClick={() => props.onSaveChanges?.()}>
                                    {resolvedSaveLabel.value}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </>
        );
    },
    {
        name: 'DbSaveBar',
        props: ensureAllTsxProps<Props>()([
            'pendingChangeCount',
            'canUndo',
            'canRedo',
            'isSavingChanges',
            'saveButtonLabel',
            'supportsForeignKeyCheckToggle',
            'disableForeignKeyChecks',
            'onClearChanges',
            'onUndoChanges',
            'onRedoChanges',
            'onPreviewChanges',
            'onSaveChanges',
            'onSetDisableForeignKeyChecks',
        ]),
    }
);

export default DbSaveBar;
