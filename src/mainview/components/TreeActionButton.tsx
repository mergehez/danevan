import { Button } from '../../shared/components/Button.tsx';
import { Icon } from '../../shared/components/Icon.tsx';
import type { FileTreeAction } from '../../shared/utils/useFileTree';
import { component, ensureAllTsxProps, prevented } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    action: FileTreeAction;
};

export const TreeActionButton = component(
    (props: Props) => {
        return () => (
            <Button
                severity={props.action.icon ? 'raised' : 'secondary'}
                disabled={props.action.disabled}
                smaller={true}
                v-tooltip={props.action.icon ? props.action.title : undefined}
                onClick={prevented(props.action.onClick)}
                class={['text-2xs', props.action.icon ? 'p-0.5' : 'px-1 py-0.5']}
            >
                {props.action.icon ? <Icon icon={props.action.icon} /> : <span class="text-2xs">{props.action.title}</span>}
            </Button>
        );
    },
    { name: 'TreeActionButton', props: ensureAllTsxProps<Props>()(['action']) }
);

export default TreeActionButton;
