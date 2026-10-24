import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { ref, watch } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { ColorPicker } from '../../shared/components/colorPicker/ColorPicker.tsx';
import { normalizeDbColor } from '../../shared/utils/dbColor';

type Props = {
    open: boolean;
    title: string;
    /** The database's color when the dialog opened. */
    value?: string | null;
    onSave: (value: string | null) => void;
    onClose: () => void;
};

/** The colour picker for a database opened from its context menu. */
export const DbColorDialog = component(
    (props: Props) => {
        const color = ref<string | null>(null);

        watch(
            () => props.open,
            (open) => {
                if (open) {
                    color.value = normalizeDbColor(props.value) ?? null;
                }
            },
            { immediate: true }
        );

        function close() {
            props.onClose();
        }

        function save() {
            props.onSave(normalizeDbColor(color.value) ?? null);
            props.onClose();
        }

        return () => (
            <CenteredModal open={props.open} title={props.title} contentClass="max-w-sm" onOpenChange={(open) => (open ? undefined : close())}>
                <div data-testid="db-color-dialog" class="flex flex-col gap-3 px-4 py-4">
                    <div class="flex items-center gap-2">
                        <span
                            data-testid="db-color-dialog-preview"
                            aria-hidden="true"
                            style={{ backgroundColor: normalizeDbColor(color.value) ?? 'transparent' }}
                            class={['h-4 w-4 rounded-full border', normalizeDbColor(color.value) ? 'border-transparent' : 'border-x5']}
                        />
                        <span class="font-mono text-2xs opacity-70">{normalizeDbColor(color.value) ?? 'no color'}</span>
                        <span class="ml-auto text-2xs opacity-50">Shown as the dot on this database's table tabs.</span>
                    </div>
                    <ColorPicker value={normalizeDbColor(color.value) ?? undefined} onChange={(value) => (color.value = value ?? null)} />
                    <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                        <Button type="button" severity="secondary" smaller={true} data-testid="db-color-dialog-clear" onClick={() => (color.value = null)}>
                            Clear
                        </Button>
                        <Button type="button" severity="secondary" smaller={true} onClick={close}>
                            Cancel
                        </Button>
                        <Button type="button" severity="primary" smaller={true} data-testid="db-color-dialog-save" onClick={save}>
                            Save
                        </Button>
                    </div>
                </div>
            </CenteredModal>
        );
    },
    { name: 'DbColorDialog', props: ensureAllTsxProps<Props>()(['open', 'title', 'value', 'onSave', 'onClose']) }
);

export default DbColorDialog;
