export type FormatValueOptions = {
    mode?: 'display' | 'sql';
    binaryMode?: 'json' | 'hex';
    functionMode?: 'name' | 'empty';
    nullText?: string;
};

function bytesToHex(value: Uint8Array) {
    return Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function escapeSqlString(value: string) {
    return value.replaceAll("'", "''");
}

export function formatValue(value: unknown, options: FormatValueOptions = {}) {
    const mode = options.mode ?? 'display';

    if (value == null) {
        return options.nullText ?? 'NULL';
    }

    if (mode === 'sql') {
        if (typeof value === 'number' || typeof value === 'bigint') {
            return String(value);
        }

        if (value instanceof Uint8Array) {
            return `X'${bytesToHex(value)}'`;
        }

        if (typeof value === 'object') {
            return `'${escapeSqlString(JSON.stringify(value))}'`;
        }

        const text =
            typeof value === 'function'
                ? options.functionMode === 'empty'
                    ? ''
                    : value.name || '[function]'
                : typeof value === 'string' || typeof value === 'boolean' || typeof value === 'symbol'
                  ? value.toString()
                  : '';
        return `'${escapeSqlString(text)}'`;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
        return value.toString();
    }

    if (value instanceof Uint8Array) {
        return options.binaryMode === 'hex' ? `0x${bytesToHex(value)}` : JSON.stringify(value);
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    if (typeof value === 'function') {
        return options.functionMode === 'empty' ? '' : value.name || '[function]';
    }

    return '';
}
