/**
 * The MS Access bridge protocol: how a value crosses into the Java bridge and comes back, how the
 * line-delimited worker frames are written and read, and the runtime checks that decide whether the
 * bridge can start at all. Pure functions (the frame handlers take the worker's buffer and pending
 * request), so the protocol is asserted without spawning Java.
 */
import { resolve } from 'path';
import type { SqlValue } from '../shared/types';

export function encodeBase64Utf8(value: string) {
    return Buffer.from(value, 'utf8').toString('base64');
}

type MsAccessWorkerResponse<T> = {
    ok?: unknown;
    result?: T;
    error?: unknown;
};

export type MsAccessReferencingForeignKey = {
    name?: string;
    table?: string;
    from?: string;
    to?: string;
};

export type MsAccessWorkerRequest = {
    op: string;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
};

/** The part of a worker the frame handlers touch. */
export type MsAccessWorkerFrames = {
    responseBuffer: string;
    activeRequest?: MsAccessWorkerRequest;
};

export function encodeSqlValue(value: SqlValue) {
    if (value == null) {
        return 'null:';
    }

    if (typeof value === 'bigint') {
        return `bigint:${value.toString()}`;
    }

    if (typeof value === 'number') {
        return `number:${Number.isFinite(value) ? value.toString() : '0'}`;
    }

    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return `bytes:${Buffer.from(value).toString('base64')}`;
    }

    return `string:${encodeBase64Utf8(String(value))}`;
}

export function decodeQueryRows(rows: unknown): Array<Record<string, SqlValue>> {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map((row) => {
        if (!row || typeof row !== 'object') {
            return {} as Record<string, SqlValue>;
        }

        return Object.fromEntries(
            Object.entries(row).map(([key, value]) => {
                if (typeof value === 'boolean') {
                    return [key, value ? 1 : 0];
                }

                return [key, value as SqlValue];
            })
        ) as Record<string, SqlValue>;
    });
}

export function quoteMsAccessIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `[${part.replaceAll(']', ']]')}]`)
        .join('.');
}

export function normalizeMsAccessReferencingForeignKeys(value: unknown) {
    if (!Array.isArray(value)) {
        return [] as MsAccessReferencingForeignKey[];
    }

    return value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
            name: typeof entry.name === 'string' ? entry.name : undefined,
            table: typeof entry.table === 'string' ? entry.table : undefined,
            from: typeof entry.from === 'string' ? entry.from : undefined,
            to: typeof entry.to === 'string' ? entry.to : undefined,
        }))
        .filter((entry) => !!entry.table);
}

export function getMsAccessInboundForeignKeyError(tableName: string, foreignKeys: MsAccessReferencingForeignKey[]) {
    if (foreignKeys.length === 0) {
        return undefined;
    }

    const details = foreignKeys
        .map((foreignKey) => {
            const name = foreignKey.name?.trim() || '(unnamed constraint)';
            const table = foreignKey.table?.trim() || '(unknown table)';
            const from = foreignKey.from?.trim();
            const to = foreignKey.to?.trim();
            const columnDetails = from && to ? ` (${table}.${from} -> ${tableName}.${to})` : '';
            return `${name} on ${table}${columnDetails}`;
        })
        .join(', ');

    return `MS Access cannot rebuild table ${tableName} while it is referenced by foreign keys from other tables: ${details}. Remove those referencing constraints first, then retry the rebuild.`;
}

export function getMsAccessWorkerKey(databasePath: string) {
    return resolve(databasePath);
}

export function encodeWorkerRequest(args: string[]) {
    return args.map((value) => encodeBase64Utf8(value)).join('\t');
}

export function getWorkerErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'string' && error.trim()) {
        return error;
    }

    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    return fallback;
}

export function rejectActiveWorkerRequest(worker: MsAccessWorkerFrames, error: unknown) {
    if (!worker.activeRequest) {
        return;
    }

    const activeRequest = worker.activeRequest;
    worker.activeRequest = undefined;
    activeRequest.reject(new Error(getWorkerErrorMessage(error, `MS Access worker request failed during ${activeRequest.op}.`)));
}

/** Every frame this protocol writes starts with this, nothing else on the bridge's stdout does. */
export const MS_ACCESS_FRAME_PREFIX = '{"ok":';

/**
 * The JVM and its libraries also write to stdout (log4j reports a missing logging provider there),
 * so only our own frames may settle a pending request. A line like
 * `2026-10-10T00:08:02Z main ERROR ...` would otherwise parse as the number 2026 and fail the query
 * it happened to arrive during.
 */
export function handleWorkerResponseLine(worker: MsAccessWorkerFrames, line: string) {
    if (!line.startsWith(MS_ACCESS_FRAME_PREFIX)) {
        return;
    }

    const activeRequest = worker.activeRequest;

    if (!activeRequest) {
        return;
    }

    try {
        const response = JSON.parse(line) as MsAccessWorkerResponse<unknown>;
        worker.activeRequest = undefined;

        if (response.ok !== true) {
            activeRequest.reject(new Error(getWorkerErrorMessage(response.error, `MS Access worker request failed during ${activeRequest.op}.`)));
            return;
        }

        activeRequest.resolve(response.result);
    } catch (error) {
        worker.activeRequest = undefined;
        // The parser's message alone would not say which operation produced the bad frame.
        const detail = getWorkerErrorMessage(error, '');
        activeRequest.reject(new Error(`MS Access worker returned invalid JSON during ${activeRequest.op}.${detail ? ` ${detail}` : ''}`));
    }
}

/** Finds the protocol frame in a stdout stream that may also carry JVM logging. */
export function parseWorkerFrameFromOutput(output: string) {
    const frameLine = output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith(MS_ACCESS_FRAME_PREFIX));

    if (!frameLine) {
        throw new Error('MS Access bridge produced no response frame.');
    }

    return JSON.parse(frameLine) as MsAccessWorkerResponse<unknown>;
}

export function drainWorkerResponseBuffer(worker: MsAccessWorkerFrames, flush = false) {
    let newlineIndex = worker.responseBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
        const line = worker.responseBuffer.slice(0, newlineIndex).trim();
        worker.responseBuffer = worker.responseBuffer.slice(newlineIndex + 1);
        handleWorkerResponseLine(worker, line);
        newlineIndex = worker.responseBuffer.indexOf('\n');
    }

    if (flush) {
        const remaining = worker.responseBuffer.trim();
        worker.responseBuffer = '';

        if (remaining) {
            handleWorkerResponseLine(worker, remaining);
        }
    }
}

export function parseJavaMajorVersion(versionOutput: string) {
    const match = versionOutput.match(/version\s+"(\d+)(?:\.(\d+))?/i) ?? versionOutput.match(/openjdk\s+(\d+)(?:\.(\d+))?/i);

    if (!match) {
        return undefined;
    }

    return Number(match[1]);
}
