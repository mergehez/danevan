import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { ref, watch } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { CenteredModal } from '../../shared/components/CenteredModal.tsx';
import { ColorPicker } from '../../shared/components/colorPicker/ColorPicker.tsx';
import { normalizeDbColor, normalizeDbShortCode } from '../../shared/utils/dbAppearance';

type DbAppearance = {
    color: string | null;
    shortCode: string | null;
};

type Props = {
    open: boolean;
    title: string;
    /** The database's appearance when the dialog opened. */
    color?: string | null;
    shortCode?: string | null;
    onSave: (appearance: DbAppearance) => void;
    onClose: () => void;
};

/** The appearance (colour and short code) dialog for a database opened from its context menu. */
export const DbAppearanceDialog = component(
    (props: Props) => {
        const color = ref<string | null>(null);
        const shortCode = ref<string | null>(null);

        watch(
            () => props.open,
            (open) => {
                if (open) {
                    color.value = normalizeDbColor(props.color) ?? null;
                    shortCode.value = normalizeDbShortCode(props.shortCode) ?? null;
                }
            },
            { immediate: true }
        );

        function close() {
            props.onClose();
        }

        function save() {
            props.onSave({ color: normalizeDbColor(color.value) ?? null, shortCode: normalizeDbShortCode(shortCode.value) ?? null });
            props.onClose();
        }

        return () => (
            <CenteredModal open={props.open} title={props.title} contentClass="max-w-sm" onOpenChange={(open) => (open ? undefined : close())}>
                <div data-testid="db-appearance-dialog" class="flex flex-col gap-3 px-4 py-4">
                    <div class="flex items-center gap-2">
                        <span
                            data-testid="db-appearance-dialog-preview"
                            aria-hidden="true"
                            style={{ backgroundColor: normalizeDbColor(color.value) ?? 'transparent' }}
                            class={['h-4 w-4 rounded-full border', normalizeDbColor(color.value) ? 'border-transparent' : 'border-x5']}
                        />
                        <span class="font-mono text-2xs opacity-70">{normalizeDbColor(color.value) ?? 'no color'}</span>
                        <label class="ml-auto flex items-center gap-1 text-2xs">
                            <span class="opacity-60">Code</span>
                            <input
                                data-testid="db-appearance-short-code"
                                value={normalizeDbShortCode(shortCode.value) ?? ''}
                                maxlength={2}
                                placeholder="DB"
                                onInput={(event: Event) => (shortCode.value = normalizeDbShortCode((event.target as HTMLInputElement).value) ?? null)}
                                class="w-10 border border-x4 bg-x0 px-1.5 py-1 text-center font-mono text-xs uppercase outline-none focus:border-x7"
                            />
                        </label>
                    </div>
                    <ColorPicker value={normalizeDbColor(color.value) ?? undefined} onChange={(value) => (color.value = value ?? null)} />
                    <div class="flex items-center justify-end gap-2 border-t border-x3 pt-3">
                        <Button
                            type="button"
                            severity="secondary"
                            smaller={true}
                            data-testid="db-appearance-clear"
                            onClick={() => {
                                color.value = null;
                                shortCode.value = null;
                            }}
                        >
                            Clear
                        </Button>
                        <Button type="button" severity="secondary" smaller={true} onClick={close}>
                            Cancel
                        </Button>
                        <Button type="button" severity="primary" smaller={true} data-testid="db-appearance-save" onClick={save}>
                            Save
                        </Button>
                    </div>
                </div>
            </CenteredModal>
        );
    },
    { name: 'DbAppearanceDialog', props: ensureAllTsxProps<Props>()(['open', 'title', 'color', 'shortCode', 'onSave', 'onClose']) }
);

export default DbAppearanceDialog;
