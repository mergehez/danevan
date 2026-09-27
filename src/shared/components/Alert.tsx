import { ref, computed, Transition } from 'vue';
import { twMerge } from 'tailwind-merge';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { component, ensureAllTsxProps, type SingleChildSlot, renderSlot, prevented } from '#shared/utils/tsxHelpers.tsx';

export type TAlertSeverity = 'primary' | 'secondary' | 'light' | 'success' | 'info' | 'warning' | 'danger';

type Props = {
    severity?: TAlertSeverity;
    closable?: boolean;
    small?: boolean;
    smaller?: boolean;
} & {
    slots?: SingleChildSlot;
    class?: unknown;
};

export const Alert = component(
    (props: Props) => {
        const severityClass = computed(() => {
            if (!props.severity) return '';
            return {
                primary: 'alert-primary',
                secondary: 'alert-secondary',
                light: 'alert-secondary',
                success: 'alert-success',
                info: 'alert-info',
                warning: 'alert-warning',
                danger: 'alert-danger',
            }[props.severity];
        });

        const sizeClass = computed(() => {
            if (props.smaller) return 'text-2xs rounded-sm';
            if (props.small) return 'text-xs rounded-sm';
            return '';
        });

        const show = ref(true);

        return () => (
            <Transition leaveActiveClass="transition ease-in duration-500" leaveFromClass="transform opacity-100 scale-100" leaveToClass="transform opacity-0 scale-95">
                {show.value ? (
                    <div class={twMerge('alert relative', severityClass.value, sizeClass.value, props.class as any)}>
                        {renderSlot(props.slots)}
                        {props.closable ? (
                            <Button small={true} onClick={prevented(() => (show.value! = false))} class="absolute right-0 p-1.5 hover:opacity-70">
                                <Icon icon="icon-[mdi--close]" />
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </Transition>
        );
    },
    { name: 'Alert', props: ensureAllTsxProps<Props>()(['severity', 'closable', 'small', 'smaller', 'slots', 'class']) }
);

export default Alert;
