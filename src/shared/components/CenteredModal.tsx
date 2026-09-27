import { computed } from 'vue';
import { Popover } from './Popover.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    title?: string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    compactHeader?: boolean;
    localStorageKey?: string;
    modalMarginToScreenEdges?: number;
    contentClass?: string;
} & {
    open: boolean;
    onOpenChange?: (val: boolean) => unknown;
    slots?: { title?: () => unknown; default?: () => unknown };
};

export const CenteredModal = component(
    (props: Props) => {
        const open = computed({
            get: () => props.open,
            set: (value) => props.onOpenChange?.(value),
        });

        return () => (
            <Popover
                open={open.value}
                center={true}
                backdrop={true}
                headerDataTestid="centered-modal-header"
                data-testid="centered-modal-surface"
                title={props.title}
                surfaceClass={props.contentClass}
                compactHeader={props.compactHeader}
                localStorageKey={props.localStorageKey}
                minWidth={props.minWidth}
                maxWidth={props.maxWidth}
                minHeight={props.minHeight}
                maxHeight={props.maxHeight}
                modalMarginToScreenEdges={props.modalMarginToScreenEdges}
                showHeader={true}
                resizable={true}
                closable={true}
                onUpdateOpen={(nextOpen) => (open.value = nextOpen)}
                slots={{
                    default: () => <>{props.slots?.default?.()}</>,
                    title: () => <>{props.slots?.title?.() ?? <span class="font-semibold text-default">{props.title}</span>}</>,
                }}
            />
        );
    },
    {
        name: 'CenteredModal',
        props: ensureAllTsxProps<Props>()([
            'title',
            'minWidth',
            'minHeight',
            'maxWidth',
            'maxHeight',
            'compactHeader',
            'localStorageKey',
            'modalMarginToScreenEdges',
            'contentClass',
            'open',
            'onOpenChange',
            'slots',
        ]),
    }
);

export default CenteredModal;
