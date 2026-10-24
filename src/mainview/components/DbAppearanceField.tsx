import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { ref } from 'vue';
import { Button } from '../../shared/components/Button.tsx';
import { ColorPicker } from '../../shared/components/colorPicker/ColorPicker.tsx';
import { normalizeDbColor, normalizeDbShortCode } from '../../shared/utils/dbAppearance';

type Props = {
    modelValue?: string | null;
    shortCode?: string | null;
    disabled?: boolean;
    onChange?: (value: string | null) => void;
    onShortCodeChange?: (value: string | null) => void;
};

/**
 * A database's appearance: the colour (opened inline as the full picker) and the 1-2 letter tag its
 * table tabs show before the dot.
 */
export const DbAppearanceField = component(
    (props: Props) => {
        const expanded = ref(false);

        return () => {
            const color = normalizeDbColor(props.modelValue);
            const shortCode = normalizeDbShortCode(props.shortCode);

            return (
                <div class="flex flex-col gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            data-testid="db-appearance-trigger"
                            disabled={props.disabled}
                            onClick={() => (expanded.value = !expanded.value)}
                            class={[
                                'flex items-center gap-2 border border-x4 bg-x0 px-2 py-1 text-xs transition',
                                props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-x3',
                            ]}
                        >
                            <span
                                data-testid="db-appearance-current"
                                style={{ backgroundColor: color ?? 'transparent' }}
                                class={['h-4 w-4 shrink-0 rounded-full border', color ? 'border-transparent' : 'border-x5']}
                            />
                            <span class="font-mono text-2xs opacity-70">{color ?? 'no color'}</span>
                        </button>
                        <label class="flex items-center gap-1 text-2xs">
                            <span class="opacity-60">Code</span>
                            <input
                                data-testid="db-short-code"
                                value={shortCode ?? ''}
                                maxlength={2}
                                placeholder="DB"
                                disabled={props.disabled}
                                onInput={(event: Event) => props.onShortCodeChange?.(normalizeDbShortCode((event.target as HTMLInputElement).value) ?? null)}
                                class="w-10 border border-x4 bg-x0 px-1.5 py-1 text-center font-mono text-xs uppercase outline-none focus:border-x7 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </label>
                        {color || shortCode ? (
                            <Button
                                type="button"
                                severity="secondary"
                                smaller={true}
                                data-testid="db-appearance-clear"
                                onClick={() => {
                                    props.onChange?.(null);
                                    props.onShortCodeChange?.(null);
                                }}
                            >
                                Clear
                            </Button>
                        ) : null}
                        <span class="text-2xs opacity-50">Shown on this database's table tabs.</span>
                    </div>
                    {expanded.value ? (
                        <div data-testid="db-appearance-picker" class="w-fit border border-x4 bg-x3 p-2">
                            <ColorPicker value={color} onChange={(value) => props.onChange?.(value ?? null)} />
                        </div>
                    ) : null}
                </div>
            );
        };
    },
    { name: 'DbAppearanceField', props: ensureAllTsxProps<Props>()(['modelValue', 'shortCode', 'disabled', 'onChange', 'onShortCodeChange']) }
);

export default DbAppearanceField;
