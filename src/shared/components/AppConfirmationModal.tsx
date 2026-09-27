import { confirmation } from '../utils/useConfirmation';
import { Button } from './Button.tsx';
import { CenteredModal } from './CenteredModal.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {};

export const AppConfirmationModal = component(
    (_: Props) => {
        function onOpenChange(isOpen: boolean) {
            if (!isOpen && confirmation.state.isOpen) {
                confirmation.cancel();
            }
        }

        return () => (
            <CenteredModal open={confirmation.state.isOpen} title="Confirmation required" contentClass="max-w-xl" onOpenChange={onOpenChange}>
                <div class="space-y-5 px-6 py-5">
                    <div class="space-y-3">
                        <div>
                            <p class="text-base font-semibold text-white">{confirmation.state.title}</p>
                            <p class="mt-2 text-sm leading-6 text-white/75">{confirmation.state.message}</p>
                        </div>
                        {confirmation.state.detail ? (
                            <p class="rounded-xl border border-white/10 bg-x0/60 px-4 py-3 text-sm leading-6 text-white/65">{confirmation.state.detail}</p>
                        ) : null}
                    </div>
                    <div class="flex items-center justify-end gap-3 border-t border-x3 pt-4">
                        <Button severity="light" onClick={() => confirmation.cancel()}>
                            {confirmation.state.cancelLabel}
                        </Button>
                        <Button severity="warning" onClick={() => confirmation.confirm()}>
                            {confirmation.state.confirmLabel}
                        </Button>
                    </div>
                </div>
            </CenteredModal>
        );
    },
    { name: 'AppConfirmationModal', props: ensureAllTsxProps<Props>()([]) }
);

export default AppConfirmationModal;
