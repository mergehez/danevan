export function uniqueId(len = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

export function formatNumber(value: number) {
    if (value >= 1_000_000) {
        return `${Math.round(value / 1_000_000)}M`;
    }

    if (value >= 1_000) {
        return `${Math.round(value / 1_000)}K`;
    }

    return String(value);
}

export function strToNumber(str: string) {
    // convert any string to a number that is consistent across runs. strToNumber('aa') === strToNumber('aa') but strToNumber('aa') !== strToNumber('ab')
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) % 1_000_000_000;
    }
    return hash;
}

export function tryCatch<T>(tryFn: () => T, catchFn: (error: unknown) => T): T {
    try {
        return tryFn();
    } catch (error) {
        return catchFn(error);
    }
}
