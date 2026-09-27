import { componentGeneric, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useAttrs } from 'vue';
import { getFinalInputClass } from './useFormComponents';

type Props<T extends string | number> = {
    modelValue?: T | undefined | null;
    disabled?: boolean;
    placeholder?: string;
    id?: string;
    class?: string;
    small?: boolean;
    smaller?: boolean;
    invalid?: boolean;
} & {
    onInput?: (value: Event) => void;
    onChangeEvent?: (value: Event) => void;
    onChange?: (value: T) => void;
    onKeydown?: (value: KeyboardEvent) => void;
    onKeyup?: (value: KeyboardEvent) => void;
    onFocus?: (value: FocusEvent) => void;
    onBlur?: (value: FocusEvent) => void;
};

export const Input = componentGeneric(
    <T extends string | number>(props: Props<T>) => {
        const attrs = useAttrs();

        function handleInput(e: Event) {
            props.onInput?.(e);
            props.onChange?.((e.target as HTMLInputElement).value as T);
        }

        function handleChange(e: Event) {
            props.onChangeEvent?.(e);
            props.onChange?.((e.target as HTMLInputElement).value as T);
        }

        return () => (
            <input
                value={props.modelValue}
                {...attrs}
                disabled={props.disabled}
                placeholder={props.placeholder}
                id={props.id}
                onInput={handleInput}
                onChange={handleChange}
                onKeydown={(e) => props.onKeydown?.(e)}
                onKeyup={(e) => props.onKeyup?.(e)}
                onFocus={(e) => props.onFocus?.(e)}
                onBlur={(e) => props.onBlur?.(e)}
                class={getFinalInputClass(props)}
            />
        );
    },
    {
        name: 'Input',
        props: ensureAllTsxProps<Props<any>>()([
            'modelValue',
            'disabled',
            'placeholder',
            'id',
            'class',
            'small',
            'smaller',
            'invalid',
            'onInput',
            'onChangeEvent',
            'onChange',
            'onKeydown',
            'onKeyup',
            'onFocus',
            'onBlur',
        ]),
    }
);

export default Input;
