import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { ref } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { ColorPicker } from '../../shared/components/colorPicker/ColorPicker.tsx';
import { normalizeDbColor } from '../../shared/utils/dbColor';

type Props = {
    modelValue?: string | null;
    disabled?: boolean;
    onChange?: (value: string | null) => void;
};

/** A database colour field: the current swatch, and the full picker inline once opened. */
export const DbColorField = component(
    (props: Props) => {
        const expanded = ref(false);

        return () => {
            const color = normalizeDbColor(props.modelValue);

            return (
                <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                        <button
                            type="button"
                            data-testid="db-color-trigger"
                            disabled={props.disabled}
                            onClick={() => (expanded.value = !expanded.value)}
                            class={[
                                'flex items-center gap-2 border border-x4 bg-x0 px-2 py-1 text-xs transition',
                                props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-x3',
                            ]}
                        >
                            <span
                                data-testid="db-color-current"
                                style={{ backgroundColor: color ?? 'transparent' }}
                                class={['h-4 w-4 shrink-0 rounded-full border', color ? 'border-transparent' : 'border-x5']}
                            />
                            <span class="font-mono text-2xs opacity-70">{color ?? 'no color'}</span>
                        </button>
                        {color ? (
                            <Button type="button" severity="secondary" smaller={true} data-testid="db-color-clear" onClick={() => props.onChange?.(null)}>
                                Clear
                            </Button>
                        ) : null}
                        <span class="text-2xs opacity-50">Shown as the dot on this database's table tabs.</span>
                    </div>
                    {expanded.value ? (
                        <div data-testid="db-color-picker" class="w-fit border border-x4 bg-x3 p-2">
                            <ColorPicker value={color} onChange={(value) => props.onChange?.(value ?? null)} />
                        </div>
                    ) : null}
                </div>
            );
        };
    },
    { name: 'DbColorField', props: ensureAllTsxProps<Props>()(['modelValue', 'disabled', 'onChange']) }
);

export default DbColorField;
