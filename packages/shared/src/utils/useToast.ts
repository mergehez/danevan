import { reactive } from 'vue';

export type ToastSeverity = 'success' | 'danger' | 'warning';
function _useToast() {
    let toastHandle: number | undefined = undefined;

    return reactive({
        message: undefined as string | undefined,
        severity: 'success' as ToastSeverity,
        showToast(message: string, severity: ToastSeverity = 'success') {
            this.message = message;
            this.severity = severity;

            if (toastHandle !== undefined) {
                window.clearTimeout(toastHandle);
            }

            toastHandle = window.setTimeout(() => {
                this.message = undefined;
                toastHandle = undefined;
            }, 3200);
        },
        dismissToast() {
            if (toastHandle !== undefined) {
                window.clearTimeout(toastHandle);
                toastHandle = undefined;
            }

            this.message = undefined;
        },
    });
}

export const toast = _useToast();
