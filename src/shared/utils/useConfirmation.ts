import { reactive } from 'vue';

type ConfirmationParams = {
    title: string;
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
};

type PendingConfirmation = {
    params: ConfirmationParams;
    resolve: (value: boolean) => void;
};

function _useConfirmation() {
    const queue: PendingConfirmation[] = [];
    let activeConfirmation: PendingConfirmation | undefined;

    const state = reactive({
        isOpen: false,
        title: '',
        message: '',
        detail: undefined as string | undefined,
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
    });

    function applyParams(params: ConfirmationParams) {
        state.title = params.title;
        state.message = params.message;
        state.detail = params.detail;
        state.confirmLabel = params.confirmLabel ?? 'Continue';
        state.cancelLabel = params.cancelLabel ?? 'Cancel';
        state.isOpen = true;
    }

    function clearState() {
        state.isOpen = false;
        state.title = '';
        state.message = '';
        state.detail = undefined;
        state.confirmLabel = 'Continue';
        state.cancelLabel = 'Cancel';
    }

    function showNextConfirmation() {
        if (activeConfirmation || queue.length === 0) {
            return;
        }

        activeConfirmation = queue.shift();
        if (!activeConfirmation) {
            return;
        }

        applyParams(activeConfirmation.params);
    }

    function resolveActiveConfirmation(value: boolean) {
        const currentConfirmation = activeConfirmation;

        activeConfirmation = undefined;
        clearState();
        currentConfirmation?.resolve(value);
        showNextConfirmation();
    }

    return reactive({
        state,
        async request(params: ConfirmationParams) {
            return await new Promise<boolean>((resolve) => {
                queue.push({ params, resolve });
                showNextConfirmation();
            });
        },
        confirm() {
            resolveActiveConfirmation(true);
        },
        cancel() {
            resolveActiveConfirmation(false);
        },
    });
}

export const confirmation = _useConfirmation();
