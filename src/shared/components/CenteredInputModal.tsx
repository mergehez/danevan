import { ref, computed, watch, nextTick, withKeys } from 'vue';
import { Button } from './Button.tsx';
import { CenteredModal } from './CenteredModal.tsx';
import { component, ensureAllTsxProps, vModel } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    title: string;
    inputLabel: string;
    canSubmit: boolean;
    isLoading: boolean;
    submit: () => void;
    close?: () => void;
    submitLabel?: string;
} & {
    open: boolean;
    onOpenChange?: (val: boolean) => unknown;
    value: string;
    onValueChange?: (val: string) => unknown;
};

export const CenteredInputModal = component(
    (props: Props) => {
        const value = computed({
            get: () => props.value,
            set: (value) => props.onValueChange?.(value),
        });
        const open = computed({
            get: () => props.open,
            set: (value) => props.onOpenChange?.(value),
        });

        const inputRef = ref<HTMLInputElement>();

        watch(open, async (isOpen) => {
            if (!isOpen) {
                return;
            }

            await nextTick();
            inputRef.value?.focus();
            inputRef.value?.select();
        });

        function onClose() {
            if (props.close) {
                props.close();
            } else {
                open.value = false;
            }
        }

        return () => (
            <CenteredModal {...vModel(open, 'value', 'open')} title={props.title} contentClass="max-w-lg">
                <div class="space-y-4 px-4 py-3">
                    <div class="space-y-2">
                        <label for="centered-input-modal-field" class="text-sm font-medium text-white">
                            {props.inputLabel}
                        </label>
                        <input
                            ref={inputRef}
                            id="centered-input-modal-field"
                            value={value.value}
                            onInput={(e: any) => (value.value = e.target.value)}
                            type="text"
                            placeholder={props.inputLabel}
                            onKeydown={withKeys(props.submit, ['enter'])}
                            class="w-full rounded-lg border border-white/10 bg-x0 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-x7 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/20"
                        />
                    </div>
                </div>
                <div class="flex items-center justify-end gap-3 border-t border-white/10 px-4 py-3">
                    <Button severity="light" onClick={onClose}>
                        {' '}
                        Cancel{' '}
                    </Button>
                    <Button severity="primary" disabled={!props.canSubmit} v-loading={props.isLoading} onClick={props.submit}>
                        {props.submitLabel ?? 'Submit'}
                    </Button>
                </div>
            </CenteredModal>
        );
    },
    {
        name: 'CenteredInputModal',
        props: ensureAllTsxProps<Props>()(['title', 'inputLabel', 'canSubmit', 'isLoading', 'submit', 'close', 'submitLabel', 'open', 'onOpenChange', 'value', 'onValueChange']),
    }
);

export default CenteredInputModal;
