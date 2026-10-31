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

// Node >= 26 defines an experimental `localStorage` as a getter that resolves to `undefined` unless
// the process was started with `--localstorage-file`, and it shadows the one jsdom would install:
// every spec that persisted grid or panel state saw `localStorage` as undefined. A per-environment
// Storage is what those specs relied on, so that is what is installed when nothing usable is there.
// The `Storage` class goes with it, or a spec could not spy on the method the app calls.
// The descriptor is read instead of the property: reading Node's getter is what prints its warning.
if (!Object.getOwnPropertyDescriptor(globalThis, 'localStorage')?.value) {
    class MemoryStorage implements Storage {
        private entries = new Map<string, string>();

        get length() {
            return this.entries.size;
        }

        clear() {
            this.entries.clear();
        }

        getItem(key: string) {
            return this.entries.get(String(key)) ?? null;
        }

        key(index: number) {
            return [...this.entries.keys()][index] ?? null;
        }

        removeItem(key: string) {
            this.entries.delete(String(key));
        }

        setItem(key: string, value: string) {
            this.entries.set(String(key), String(value));
        }
    }

    Object.defineProperty(globalThis, 'Storage', { value: MemoryStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
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
