async function fallbackCopyText(text: string) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.append(textarea);
    textarea.select();

    try {
        document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}

export function joinNativePath(basePath: string, relativePath: string) {
    if (!relativePath) {
        return basePath;
    }

    const separator = basePath.includes('\\') ? '\\' : '/';
    const normalizedBasePath = basePath.replace(/[\\/]+$/, '');
    const normalizedRelativePath = relativePath.replace(/[\\/]+/g, separator).replace(new RegExp(`^\\${separator}+`), '');

    return `${normalizedBasePath}${separator}${normalizedRelativePath}`;
}

export async function writeClipboardText(text: string) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall through to the DOM copy path when the platform denies async clipboard access.
        }
    }

    await fallbackCopyText(text);
}
