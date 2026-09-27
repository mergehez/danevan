import { ref, computed, withKeys } from 'vue';
import { uniqueId } from '../utils/utils';
import { component, ensureAllTsxProps, tsxWithDefaults, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    disabled?: boolean;
    small?: boolean;
    smaller?: boolean;
    class?: string;
    id?: string;
    label?: string;
} & {
    modelValue: boolean;
    onChange?: (val: boolean) => unknown;
};

export const Checkbox = component(
    (_props: Props) => {
        const props = tsxWithDefaults(_props, { id: uniqueId() });
        const modelValue = computed({
            get: () => props.modelValue,
            set: (value) => props.onChange?.(value),
        });

        const focusTargetRef = ref<HTMLElement | null>(null);

        const sizeClass = computed(() => {
            if (props.smaller) {
                return 'h-3 w-3 rounded-xs';
            }
            if (props.small) {
                return 'h-4 w-4 rounded-sm';
            }
            return 'h-5 w-5 rounded';
        });

        const textSizeClass = computed(() => {
            if (props.smaller) {
                return 'text-[0.5rem]';
            }
            if (props.small) {
                return 'text-xs';
            }
            return 'text-sm';
        });

        const colorClasses = computed(() => {
            if (props.disabled) {
                return 'border-x4';
            }
            return modelValue.value ? 'bg-blue-500 border-blue-400' : 'border-x7';
        });

        function toggleValue() {
            if (props.disabled) {
                return;
            }

            modelValue.value = !modelValue.value;
        }

        function onContainerClick() {
            if (props.disabled) {
                return;
            }

            focusTargetRef.value?.focus();
            toggleValue();
        }

        return () => (
            <label onClick={prevented(onContainerClick)} class={['inline-flex items-center gap-1', props.disabled ? 'cursor-not-allowed' : 'cursor-pointer', props.class]}>
                <span class={['relative shrink-0', sizeClass.value]}>
                    <input
                        id={props.id}
                        value={modelValue.value}
                        onInput={(e: any) => (modelValue.value = e.target.value)}
                        type="checkbox"
                        disabled={props.disabled}
                        tabindex="-1"
                        class={['pointer-events-none absolute inset-0 m-0 opacity-0', sizeClass.value]}
                    />
                    <span
                        ref={focusTargetRef}
                        role="checkbox"
                        aria-checked={modelValue.value}
                        aria-disabled={props.disabled || undefined}
                        tabindex={props.disabled ? -1 : 0}
                        onKeydown={prevented(withKeys(toggleValue, ['space']))}
                        class={[
                            'flex items-center justify-center overflow-hidden border text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/80 focus-visible:ring-offset-1 focus-visible:ring-offset-x1',
                            [sizeClass.value, colorClasses.value],
                        ]}
                    >
                        {modelValue.value ? <i class={['icon icon-[mdi--check] aspect-square', textSizeClass.value]} /> : null}
                    </span>
                </span>
                {props.label ? <span class={['pointer-events-none', textSizeClass.value]}>{props.label}</span> : null}
            </label>
        );
    },
    { name: 'Checkbox', props: ensureAllTsxProps<Props>()(['disabled', 'small', 'smaller', 'class', 'id', 'label', 'modelValue', 'onChange']) }
);

export default Checkbox;
