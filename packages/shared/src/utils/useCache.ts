import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

type CacheStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

type UseCacheOptions<T> = {
    key: MaybeRefOrGetter<string | undefined>;
    initialValue: T | (() => T);
    parse?: (rawValue: string) => T;
    serialize?: (value: T) => string;
    storage?: CacheStorage;
};

// type CacheEntry<T> = {
//     state: Ref<T>;
//     reload: () => void;
// };

function resolveInitialValue<T>(initialValue: T | (() => T)) {
    return typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
}

function getDefaultStorage(): CacheStorage | undefined {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function _useCache<T>({ key, initialValue, parse, serialize, storage = getDefaultStorage() }: UseCacheOptions<T>) {
    const state = ref(resolveInitialValue(initialValue)) as Ref<T>;

    function reload() {
        const cacheKey = toValue(key);

        if (!cacheKey || !storage) {
            state.value = resolveInitialValue(initialValue);
            return;
        }

        const rawValue = storage.getItem(cacheKey);

        if (!rawValue) {
            state.value = resolveInitialValue(initialValue);
            return;
        }

        try {
            state.value = parse ? parse(rawValue) : (JSON.parse(rawValue) as T);
        } catch {
            state.value = resolveInitialValue(initialValue);
        }
    }

    watch(
        () => toValue(key),
        () => {
            reload();
        },
        { immediate: true }
    );

    watch(
        state,
        (value) => {
            const cacheKey = toValue(key);

            if (!cacheKey || !storage) {
                return;
            }

            storage.setItem(cacheKey, serialize ? serialize(value) : JSON.stringify(value));
        },
        { deep: true }
    );

    return { state: state, reload: reload };
}

const cacheSingletons = new Map<string, ReturnType<typeof _useCache<any>>>();

export function resetCacheState(key: string, storage = getDefaultStorage()) {
    storage?.removeItem(key);
    cacheSingletons.get(key)?.reload();
}

export function useCache<T>(options: UseCacheOptions<T>): ReturnType<typeof _useCache<T>> {
    const cacheKey = toValue(options.key);

    if (!cacheKey) {
        return _useCache(options);
    }

    if (!cacheSingletons.has(cacheKey)) {
        cacheSingletons.set(cacheKey, _useCache(options));
    }

    return cacheSingletons.get(cacheKey)! as ReturnType<typeof _useCache<T>>;
}
