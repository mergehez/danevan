import { afterEach, describe, expect, it, vi } from 'vitest';
import { withMinLifetime } from './useMinLifetime';

describe('withMinLifetime', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the wrapped result', async () => {
        vi.useFakeTimers();

        await expect(withMinLifetime(async () => 'loaded', 0)).resolves.toBe('loaded');
    });

    it('holds a fast result for the remaining lifetime', async () => {
        vi.useFakeTimers();
        const settled = vi.fn();
        const pending = withMinLifetime(async () => 'loaded', 500).then(settled);

        await vi.advanceTimersByTimeAsync(499);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(settled).toHaveBeenCalledWith('loaded');
    });

    it('adds no extra wait when the work already outlasts the lifetime', async () => {
        vi.useFakeTimers();
        const work = withMinLifetime(async () => {
            await new Promise((resolve) => setTimeout(resolve, 900));
            return 'slow';
        }, 500);

        await vi.advanceTimersByTimeAsync(900);

        await expect(work).resolves.toBe('slow');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates a rejection without holding it', async () => {
        vi.useFakeTimers();
        const failure = withMinLifetime(async () => {
            throw new Error('query failed');
        }, 0);

        await expect(failure).rejects.toThrow('query failed');
    });
});
