export type ConfirmActionOptions = {
    title: string;
    message: string;
    detail?: string;
    confirmLabel?: string;
};

export async function confirmAction(options: ConfirmActionOptions) {
    const suffix = options.detail ? `\n\n${options.detail}` : '';
    return window.confirm(`${options.title}\n\n${options.message}${suffix}`);
}
