import { computed } from 'vue';
import { uniqueId } from '../utils/utils';
import { getFinalInputClass, getInputSizedClasses } from './useFormComponents';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    modelValue: string | number | undefined | null;
    options: { label: string; value: string | number }[] | string[];
    disabled?: boolean;
    placeholder?: string;
    class?: string;
    small?: boolean;
    smaller?: boolean;
} & {
    onChange?: (value: string) => void;
};

export const Select = component(
    (props: Props) => {
        const finalOptions = computed(() => {
            if (typeof props.options[0] === 'string') {
                return (props.options as string[]).map((o) => ({ label: o, value: o }));
            }
            return props.options as { label: string; value: string | number }[];
        });

        const id = uniqueId();

        return () => (
            <label for={id} class={['relative', [getFinalInputClass(props), 'has-focus-within:border-blue-400']]}>
                <span class={['absolute inset-0 flex items-center', getInputSizedClasses(props)]}>{props.modelValue}</span>
                <select
                    value={props.modelValue}
                    disabled={props.disabled}
                    id={id}
                    onChange={(e) => props.onChange?.((e.target as HTMLSelectElement).value)}
                    class="opacity-0 w-full h-full"
                >
                    {props.placeholder !== undefined ? (
                        <option value="" disabled={true}>
                            {props.placeholder}
                        </option>
                    ) : null}
                    {finalOptions.value.map((option) => (
                        <option value={option.value} key={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
        );
    },
    { name: 'Select', props: ensureAllTsxProps<Props>()(['modelValue', 'options', 'disabled', 'placeholder', 'class', 'small', 'smaller', 'onChange']) }
);

export default Select;
