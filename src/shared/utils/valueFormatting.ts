import type { DbType } from '../types';

export type FormatValueOptions = {
    mode?: 'display' | 'sql';
    binaryMode?: 'json' | 'hex';
    functionMode?: 'name' | 'empty';
    nullText?: string;
    /** The dialect the literal is written for. MySQL reads a backslash as an escape, the
     *  standard-conforming drivers do not, so `C:\temp` only survives one of them unescaped. */
    dialect?: DbType;
};

function bytesToHex(value: Uint8Array) {
    return Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function escapeSqlString(value: string, dialect: DbType | undefined) {
    const escapedBackslashes = dialect === 'mysql' ? value.replaceAll('\\', '\\\\') : value;

    return escapedBackslashes.replaceAll("'", "''");
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
            return `'${escapeSqlString(JSON.stringify(value), options.dialect)}'`;
        }

        const text =
            typeof value === 'function'
                ? options.functionMode === 'empty'
                    ? ''
                    : value.name || '[function]'
                : typeof value === 'string' || typeof value === 'boolean' || typeof value === 'symbol'
                  ? value.toString()
                  : '';
        return `'${escapeSqlString(text, options.dialect)}'`;
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
