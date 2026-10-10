// A formatter template runs in a worker the composable keeps for the session. The request flow is
// what the grid's rendering depends on: a request must not be posted before the worker's script has
// run (the browser throws such a message away — a cold worker then never answered the first render),
// the answer fills the cache for the next render, and a template that never answers falls back to the
// raw value instead of freezing the grid. The worker itself is the process boundary this spec fakes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type PostedRequest = { requestId: number; template: string; value: string };

const worker = vi.hoisted(() => {
    const state = {
        instances: [] as Array<{ posted: PostedRequest[]; terminated: number }>,
        listeners: [] as Array<(event: { data: unknown }) => void>,
    };

    return state;
});

vi.mock('../../lib/gridFormatter.worker.ts?worker', () => ({
    default: class FakeFormatterWorker {
        posted: PostedRequest[] = [];
        terminated = 0;

        constructor() {
            worker.instances.push(this);
        }

        addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
            worker.listeners.push(listener);
        }

        postMessage(request: PostedRequest) {
            this.posted.push(request);
        }

        terminate() {
            this.terminated += 1;
        }
    },
}));

function lastWorker() {
    return worker.instances.at(-1)!;
}

function announceReady() {
    for (const listener of worker.listeners) {
        listener({ data: { ready: true } });
    }
}

function answer(request: { requestId: number }, text: string) {
    for (const listener of worker.listeners) {
        listener({ data: { requestId: request.requestId, ok: true, text } });
    }
}

const formatter = { id: 'f1', name: 'Length', template: 'function format(value) { return value.length; }', createdAt: '', updatedAt: 'v1' };

async function loadComposable() {
    vi.resetModules();
    worker.instances = [];
    worker.listeners = [];
    const { _useGridFormatters } = await import('../../composables/useGridFormatters');

    return _useGridFormatters();
}

describe('grid formatters worker handshake', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('holds a request until the worker says it is listening, then sends it', async () => {
        const state = await loadComposable();

        // The first render draws the raw value and asks the worker for the formatted one.
        expect(state.runTemplate(formatter, 'Ada')).toBe('Ada');
        expect(worker.instances).toHaveLength(1);
        expect(lastWorker().posted).toEqual([]);

        announceReady();

        expect(lastWorker().posted).toEqual([{ requestId: 1, template: formatter.template, value: 'Ada' }]);

        // The answer is what the next render draws.
        answer(lastWorker().posted[0]!, '3');
        expect(state.renderVersion).toBe(1);

        expect(state.runTemplate(formatter, 'Ada')).toBe('3');
    });

    it('sends later requests straight to the worker that is already listening', async () => {
        const state = await loadComposable();

        state.runTemplate(formatter, 'Ada');
        announceReady();
        state.runTemplate(formatter, 'Grace');

        expect(lastWorker().posted.map((request) => request.value)).toEqual(['Ada', 'Grace']);
    });

    it('keeps the raw value when the template never answers', async () => {
        vi.useFakeTimers();
        const state = await loadComposable();

        state.runTemplate(formatter, 'Ada');
        announceReady();
        vi.advanceTimersByTime(50);

        expect(lastWorker().terminated).toBe(1);
        expect(state.runTemplate(formatter, 'Ada')).toBe('Ada');
    });
});
