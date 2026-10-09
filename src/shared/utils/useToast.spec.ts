import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from './useToast';

describe('toast', () => {
    afterEach(() => {
        toast.dismissToast();
        vi.useRealTimers();
    });

    it('shows a success message by default', () => {
        toast.showToast('Table saved');

        expect(toast.message).toBe('Table saved');
        expect(toast.severity).toBe('success');
    });

    it('keeps the requested severity for failures', () => {
        toast.showToast('Could not save the row', 'danger');

        expect(toast.message).toBe('Could not save the row');
        expect(toast.severity).toBe('danger');
    });

    it('replaces the previous message and restarts its lifetime', () => {
        vi.useFakeTimers();
        toast.showToast('First');
        vi.advanceTimersByTime(3000);
        toast.showToast('Second');
        vi.advanceTimersByTime(3000);

        expect(toast.message).toBe('Second');

        vi.advanceTimersByTime(200);
        expect(toast.message).toBeUndefined();
    });

    it('hides the message on its own after 3.2 seconds', () => {
        vi.useFakeTimers();
        toast.showToast('Copied');

        vi.advanceTimersByTime(3199);
        expect(toast.message).toBe('Copied');

        vi.advanceTimersByTime(1);
        expect(toast.message).toBeUndefined();
    });

    it('dismisses immediately and cancels the pending timer', () => {
        vi.useFakeTimers();
        toast.showToast('Copied');
        toast.dismissToast();

        expect(toast.message).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});
