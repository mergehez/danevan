// The grid formatter worker compiles a user template into `format(value)` and posts the
// result back. jsdom's `window` stands in for the worker's `self`, so the real handler and
// the real template compiler run against the messages asserted here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FormatResponse = {
    requestId: number;
    ok: boolean;
    text?: string;
    error?: string;
};

type WorkerMessage = FormatResponse | { ready: true };

let posted: FormatResponse[] = [];
let readyMessages = 0;

function format(template: string, value: string) {
    self.onmessage!({ data: { requestId: 42, template, value } } as unknown as MessageEvent);
}

describe('grid formatter worker', () => {
    beforeEach(async () => {
        vi.resetModules();
        posted = [];
        readyMessages = 0;
        (self as unknown as { postMessage: (message: WorkerMessage) => void }).postMessage = (message) => {
            if ('ready' in message) {
                readyMessages += 1;
                return;
            }

            posted.push(message);
        };

        await import('./gridFormatter.worker');
    });

    it('announces that it is listening before any request arrives', () => {
        expect(readyMessages).toBe(1);
        expect(posted).toEqual([]);
    });

    it('runs the template and posts the formatted text', () => {
        format('function format(value) { return value.toUpperCase(); }', 'active');

        expect(posted).toEqual([{ requestId: 42, ok: true, text: 'ACTIVE' }]);
    });

    it('stringifies object results as JSON', () => {
        format('function format(value) { return { value, label: "row" }; }', '5');

        expect(posted).toEqual([{ requestId: 42, ok: true, text: '{"value":"5","label":"row"}' }]);
    });

    it('renders nullish results as an empty string', () => {
        format('function format(value) { return value === "missing" ? null : value; }', 'missing');

        expect(posted).toEqual([{ requestId: 42, ok: true, text: '' }]);
    });

    it('stringifies non-string results', () => {
        format('function format(value) { return Number(value) * 2; }', '21');

        expect(posted).toEqual([{ requestId: 42, ok: true, text: '42' }]);
    });

    it('reports a template that never defines format', () => {
        format('const notAFormatter = true;', 'active');

        expect(posted).toEqual([{ requestId: 42, ok: false, error: 'Formatter template must define function format(value).' }]);
    });

    it('reports a template that throws for this value', () => {
        format('function format(value) { return value.nope.deeper; }', 'active');

        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ requestId: 42, ok: false });
        expect(posted[0]!.error).toContain('Cannot read properties of');
    });

    it('reuses the compiled formatter for the same template', () => {
        const template = 'function format(value) { return `${value}:${value.length}`; }';

        format(template, 'abc');
        format(template, 'de');

        expect(posted).toEqual([
            { requestId: 42, ok: true, text: 'abc:3' },
            { requestId: 42, ok: true, text: 'de:2' },
        ]);
    });
});
