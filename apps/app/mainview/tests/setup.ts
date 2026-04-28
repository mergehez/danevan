if (typeof document !== 'undefined' && typeof (document as { queryCommandSupported?: unknown }).queryCommandSupported !== 'function') {
    (document as { queryCommandSupported: (command: string) => boolean }).queryCommandSupported = () => false;
}
