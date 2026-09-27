import { computed } from 'vue';
import { Button, type TButtonSeverity } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { component, ensureAllTsxProps, tsxWithDefaults } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    severity?: TButtonSeverity;
    icon: `icon-\[${string}`;
    smaller?: boolean;
    disabled?: boolean;
};

export const IconButton = component(
    (_props: Props) => {
        const props = tsxWithDefaults(_props, { severity: 'light' });

        const finalClass = computed(() => (props.smaller ? 'p-0.5 text-2xs' : 'p-1 text-sm'));

        return () => (
            <Button severity={props.severity} disabled={props.disabled} class={finalClass.value}>
                <Icon icon={props.icon} />
            </Button>
        );
    },
    { name: 'IconButton', props: ensureAllTsxProps<Props>()(['severity', 'icon', 'smaller', 'disabled']) }
);

export default IconButton;
