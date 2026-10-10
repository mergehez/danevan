// The MS Access bridge protocol. Values, frames and runtime checks cross into a Java process, so a
// mistake here is invisible until a user's table reads back wrong — these drive the real functions.
import { describe, expect, it } from 'vitest';
import {
    decodeQueryRows,
    drainWorkerResponseBuffer,
    encodeBase64Utf8,
    encodeSqlValue,
    encodeWorkerRequest,
    getMsAccessInboundForeignKeyError,
    getMsAccessWorkerKey,
    getWorkerErrorMessage,
    handleWorkerResponseLine,
    normalizeMsAccessReferencingForeignKeys,
    parseJavaMajorVersion,
    quoteMsAccessIdentifier,
    rejectActiveWorkerRequest,
    type MsAccessWorkerFrames,
} from './msAccessProtocol.ts';

function workerStub(op = 'runQuery') {
    const settled: Array<{ kind: 'resolve'; value: unknown } | { kind: 'reject'; error: Error }> = [];
    const worker: MsAccessWorkerFrames = {
        responseBuffer: '',
        activeRequest: {
            op,
            resolve: (value) => settled.push({ kind: 'resolve', value }),
            reject: (error) => settled.push({ kind: 'reject', error }),
        },
    };

    return { worker, settled };
}

const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

describe('encodeSqlValue', () => {
    it('tags every kind of value so the bridge can rebuild it', () => {
        expect(encodeSqlValue(null)).toBe('null:');
        expect(encodeSqlValue(42)).toBe('number:42');
        expect(encodeSqlValue(-1.5)).toBe('number:-1.5');
        expect(encodeSqlValue(12n)).toBe('bigint:12');
        expect(encodeSqlValue('Ada')).toBe(`string:${base64('Ada')}`);
        expect(encodeSqlValue(''.concat('42'))).toBe(`string:${base64('42')}`);
    });

    it('encodes binary values as base64 bytes', () => {
        expect(encodeSqlValue(Uint8Array.from([1, 2, 255]))).toBe(`bytes:${Buffer.from([1, 2, 255]).toString('base64')}`);
        expect(encodeSqlValue(Buffer.from('hi', 'utf8'))).toBe(`bytes:${Buffer.from('hi', 'utf8').toString('base64')}`);
    });

    it('keeps the frame valid for numbers that cannot be represented', () => {
        expect(encodeSqlValue(Number.NaN)).toBe('number:0');
        expect(encodeSqlValue(Number.POSITIVE_INFINITY)).toBe('number:0');
    });

    it('encodes SQL text the same way it encodes arguments', () => {
        expect(encodeBase64Utf8('SELECT * FROM [t]')).toBe(base64('SELECT * FROM [t]'));
    });
});

describe('decodeQueryRows', () => {
    it('passes rows through with their column order', () => {
        expect(decodeQueryRows([{ id: 1, name: 'Ada' }])).toEqual([{ id: 1, name: 'Ada' }]);
    });

    it('turns booleans into the 0/1 the grid expects', () => {
        expect(decodeQueryRows([{ active: true, deleted: false }])).toEqual([{ active: 1, deleted: 0 }]);
    });

    it('answers an empty list for anything that is not an array', () => {
        expect(decodeQueryRows(undefined)).toEqual([]);
        expect(decodeQueryRows(null)).toEqual([]);
        expect(decodeQueryRows({ id: 1 })).toEqual([]);
        expect(decodeQueryRows('nope')).toEqual([]);
    });

    it('keeps a row that came back as a non-object usable', () => {
        expect(decodeQueryRows([null, 7, 'x', { id: 2 }])).toEqual([{}, {}, {}, { id: 2 }]);
    });
});

describe('quoteMsAccessIdentifier', () => {
    it('brackets every part of a name', () => {
        expect(quoteMsAccessIdentifier('orders')).toBe('[orders]');
        expect(quoteMsAccessIdentifier('shop.orders')).toBe('[shop].[orders]');
        expect(quoteMsAccessIdentifier('order items.id')).toBe('[order items].[id]');
    });

    it('escapes a closing bracket inside a name', () => {
        expect(quoteMsAccessIdentifier('we]ird')).toBe('[we]]ird]');
    });

    it('drops empty parts and trims the rest', () => {
        expect(quoteMsAccessIdentifier(' a . b ')).toBe('[a].[b]');
        expect(quoteMsAccessIdentifier('a..b')).toBe('[a].[b]');
    });
});

describe('encodeWorkerRequest', () => {
    it('writes base64 arguments tab-separated', () => {
        expect(encodeWorkerRequest(['runQuery', 'SELECT 1', 'number:2'])).toBe(`${base64('runQuery')}\t${base64('SELECT 1')}\t${base64('number:2')}`);
    });

    it('writes an empty frame for no arguments', () => {
        expect(encodeWorkerRequest([])).toBe('');
    });
});

describe('getWorkerErrorMessage', () => {
    it('prefers a non-empty message from the bridge', () => {
        expect(getWorkerErrorMessage('bridge exploded', 'fallback')).toBe('bridge exploded');
        expect(getWorkerErrorMessage(new Error('bad SQL'), 'fallback')).toBe('bad SQL');
    });

    it('falls back when the bridge said nothing usable', () => {
        expect(getWorkerErrorMessage('   ', 'fallback')).toBe('fallback');
        expect(getWorkerErrorMessage(new Error('  '), 'fallback')).toBe('fallback');
        expect(getWorkerErrorMessage(undefined, 'fallback')).toBe('fallback');
        expect(getWorkerErrorMessage({ message: 'not an Error' }, 'fallback')).toBe('fallback');
    });
});

describe('worker response frames', () => {
    it('resolves the pending request with the frame result', () => {
        const { worker, settled } = workerStub();

        handleWorkerResponseLine(worker, '{"ok":true,"result":{"columns":["id"],"rows":[{"id":1}]}}');

        expect(settled).toEqual([{ kind: 'resolve', value: { columns: ['id'], rows: [{ id: 1 }] } }]);
        expect(worker.activeRequest).toBeUndefined();
    });

    it('rejects with the error the bridge reported', () => {
        const { worker, settled } = workerStub();

        handleWorkerResponseLine(worker, '{"ok":false,"error":"table is locked"}');

        expect(settled).toHaveLength(1);
        expect(settled[0]!.kind).toBe('reject');
        expect((settled[0] as { error: Error }).error.message).toBe('table is locked');
    });

    it('rejects an invalid frame with the operation named', () => {
        const { worker, settled } = workerStub('modifyTable');

        handleWorkerResponseLine(worker, 'not json at all');

        expect((settled[0] as { error: Error }).error.message).toContain('MS Access worker returned invalid JSON during modifyTable');
        expect(worker.activeRequest).toBeUndefined();
    });

    it('rejects a frame that reports no result without an error message', () => {
        const { worker, settled } = workerStub('runQuery');

        handleWorkerResponseLine(worker, '{"ok":false}');

        expect((settled[0] as { error: Error }).error.message).toContain('MS Access worker request failed during runQuery');
    });

    it('ignores a blank line and a frame with nothing pending', () => {
        const { worker, settled } = workerStub();

        handleWorkerResponseLine(worker, '');
        expect(settled).toEqual([]);
        expect(worker.activeRequest).toBeDefined();

        worker.activeRequest = undefined;
        handleWorkerResponseLine(worker, '{"ok":true,"result":1}');
        expect(settled).toEqual([]);
    });

    it('rejects the pending request when the worker dies', () => {
        const { worker, settled } = workerStub('listTables');

        rejectActiveWorkerRequest(worker, new Error('worker exited'));

        expect((settled[0] as { error: Error }).error.message).toBe('worker exited');
        expect(worker.activeRequest).toBeUndefined();
    });

    it('leaves nothing to reject twice', () => {
        const { worker, settled } = workerStub();

        rejectActiveWorkerRequest(worker, new Error('first'));
        rejectActiveWorkerRequest(worker, new Error('second'));

        expect(settled).toHaveLength(1);
    });
});

describe('drainWorkerResponseBuffer', () => {
    it('handles every complete line in order', () => {
        const { worker, settled } = workerStub();

        worker.responseBuffer = '{"ok":true,"result":1}\n';

        // The driver serialises requests: it arms the next one only after the previous settled.
        const armNext = () => {
            worker.activeRequest = { op: 'runQuery', resolve: (value) => settled.push({ kind: 'resolve', value }), reject: (error) => settled.push({ kind: 'reject', error }) };
        };

        drainWorkerResponseBuffer(worker);
        expect(settled).toEqual([{ kind: 'resolve', value: 1 }]);

        armNext();
        worker.responseBuffer += '{"ok":true,"result":2}\n';
        drainWorkerResponseBuffer(worker);

        expect(settled).toEqual([
            { kind: 'resolve', value: 1 },
            { kind: 'resolve', value: 2 },
        ]);
        expect(worker.responseBuffer).toBe('');
    });

    it('waits for the rest of a partial line', () => {
        const { worker, settled } = workerStub();

        worker.responseBuffer = '{"ok":true,"resu';
        drainWorkerResponseBuffer(worker);

        expect(settled).toEqual([]);

        worker.responseBuffer += 'lt":7}\n';
        drainWorkerResponseBuffer(worker);

        expect(settled).toEqual([{ kind: 'resolve', value: 7 }]);
        expect(worker.responseBuffer).toBe('');
    });

    it('handles a final fragment when the stream says it is done', () => {
        const { worker, settled } = workerStub();

        worker.responseBuffer = '{"ok":true,"result":"tail"}';
        drainWorkerResponseBuffer(worker, true);

        expect(settled).toEqual([{ kind: 'resolve', value: 'tail' }]);
        expect(worker.responseBuffer).toBe('');
    });

    it('skips blank lines and tolerates CRLF', () => {
        const { worker, settled } = workerStub();

        worker.responseBuffer = '\r\n{"ok":true,"result":1}\r\n\n';
        drainWorkerResponseBuffer(worker);

        expect(settled).toEqual([{ kind: 'resolve', value: 1 }]);
    });
});

describe('getMsAccessWorkerKey', () => {
    it('keys a worker by the absolute database path', () => {
        expect(getMsAccessWorkerKey('./data/app.mdb')).toBe(process.cwd() + '/data/app.mdb');
        expect(getMsAccessWorkerKey('/tmp/app.mdb')).toBe('/tmp/app.mdb');
    });
});

describe('parseJavaMajorVersion', () => {
    it.each([
        ['openjdk version "17.0.9" 2023-10-17', 17],
        ['java version "1.8.0_392"', 1],
        ['openjdk 21.0.1 2023-10-17', 21],
        ['version "11"', 11],
        ['java version "23"', 23],
    ])('reads %s as major version %i', (output, expected) => {
        expect(parseJavaMajorVersion(output)).toBe(expected);
    });

    it('reports nothing it cannot parse', () => {
        expect(parseJavaMajorVersion('command not found')).toBeUndefined();
        expect(parseJavaMajorVersion('')).toBeUndefined();
    });
});

describe('normalizeMsAccessReferencingForeignKeys', () => {
    it('keeps only what the rebuild guard needs', () => {
        expect(
            normalizeMsAccessReferencingForeignKeys([
                { name: 'fk_one', table: 'orders', from: 'owner_id', to: 'id', extra: 'ignored' },
                { table: 'teams', from: 'team_id', to: 'id' },
            ])
        ).toEqual([
            { name: 'fk_one', table: 'orders', from: 'owner_id', to: 'id' },
            { name: undefined, table: 'teams', from: 'team_id', to: 'id' },
        ]);
    });

    it('drops entries without a table and anything that is not an array', () => {
        expect(normalizeMsAccessReferencingForeignKeys([{ name: 'nameless' }, null, 'x'])).toEqual([]);
        expect(normalizeMsAccessReferencingForeignKeys(undefined)).toEqual([]);
        expect(normalizeMsAccessReferencingForeignKeys({ table: 'orders' })).toEqual([]);
    });
});

describe('getMsAccessInboundForeignKeyError', () => {
    it('says nothing when no other table references this one', () => {
        expect(getMsAccessInboundForeignKeyError('orders', [])).toBeUndefined();
    });

    it('names each referencing constraint and column pair', () => {
        const message = getMsAccessInboundForeignKeyError('orders', [{ name: 'fk_orders', table: 'items', from: 'order_id', to: 'id' }]);

        expect(message).toBe(
            'MS Access cannot rebuild table orders while it is referenced by foreign keys from other tables: fk_orders on items (items.order_id -> orders.id). Remove those referencing constraints first, then retry the rebuild.'
        );
    });

    it('falls back for an unnamed constraint or unknown table and lists several', () => {
        const message = getMsAccessInboundForeignKeyError('orders', [
            { table: 'items', from: 'order_id', to: 'id' },
            { name: 'fk_other', table: 'shipments' },
        ]);

        expect(message).toContain('(unnamed constraint) on items (items.order_id -> orders.id)');
        expect(message).toContain('fk_other on shipments');
    });
});
