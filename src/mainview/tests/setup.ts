if (typeof document !== 'undefined' && typeof (document as { queryCommandSupported?: unknown }).queryCommandSupported !== 'function') {
    (document as { queryCommandSupported: (command: string) => boolean }).queryCommandSupported = () => false;
}

// jsdom lacks these browser APIs that components (Popover, modal drag/resize,
// Monaco layout) rely on at mount time.
if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof globalThis.matchMedia !== 'function') {
    globalThis.matchMedia = (query: string) =>
        ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }) as MediaQueryList;
}
