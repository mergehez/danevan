import { type ClassNameValue, twMerge } from 'tailwind-merge';
import { component, ensureAllTsxProps, type SingleChildSlot, renderSlot, Component } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    icon: `icon-\[${string}` | undefined;
    loading?: boolean;
    as?: string;
    class?: ClassNameValue;
} & {
    slots?: SingleChildSlot;
};

export const Icon = component(
    (props: Props) => {
        return () => (
            <Component
                is={props.as || 'i'}
                class={twMerge(props.icon || props.loading ? 'icon' : undefined, 'text-lg', props.loading ? 'icon-[mingcute--loading-fill] animate-spin' : props.icon, props.class)}
            >
                {renderSlot(props.slots)}
            </Component>
        );
    },
    { name: 'Icon', props: ensureAllTsxProps<Props>()(['icon', 'loading', 'as', 'class', 'slots']) }
);

export default Icon;
