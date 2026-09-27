import { computed } from 'vue';
import { twMerge } from 'tailwind-merge';
import { component, ensureAllTsxProps, type SingleChildSlot, renderSlot, Component } from '#shared/utils/tsxHelpers.tsx';

export type TButtonSeverity = 'primary' | 'raised' | 'secondary' | 'light' | 'success' | 'info' | 'warning' | 'danger';

type Props = {
    severity?: TButtonSeverity;
    as?: any;
    small?: boolean;
    smaller?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    class?: string | string[];
} & {
    slots?: SingleChildSlot;
};

export const Button = component(
    (props: Props) => {
        const severityClass = computed(() => {
            if (!props.severity) return '';
            return {
                primary: 'btn-primary',
                raised: 'btn-raised',
                secondary: 'btn-secondary',
                light: 'btn-light',
                success: 'btn-success',
                info: 'btn-info',
                warning: 'btn-warning',
                danger: 'btn-danger',
            }[props.severity];
        });

        const sizeClass = computed(() => {
            if (props.smaller) return 'btn-xs rounded-sm';
            if (props.small) return 'btn-sm rounded-sm';
            return '';
        });

        const disabledClass = computed(() => (props.disabled ? 'opacity-80 cursor-not-allowed' : ''));

        return () => (
            <Component
                is={props.as || 'button'}
                type={props.type}
                disabled={props.disabled}
                class={['btn', twMerge(severityClass.value, sizeClass.value, disabledClass.value, props.class)]}
            >
                {renderSlot(props.slots)}
            </Component>
        );
    },
    { name: 'Button', props: ensureAllTsxProps<Props>()(['severity', 'as', 'small', 'smaller', 'disabled', 'type', 'class', 'slots']) }
);

export default Button;
