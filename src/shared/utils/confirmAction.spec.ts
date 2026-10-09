import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmAction } from './confirmAction';

describe('confirmAction', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows the title, the message and the detail on separate lines', () => {
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);

        const accepted = confirmAction({ title: 'Delete table', message: 'Drop "users"?', detail: 'This cannot be undone.', confirmLabel: 'Delete' });

        expect(confirm).toHaveBeenCalledWith('Delete table\n\nDrop "users"?\n\nThis cannot be undone.');
        return expect(accepted).resolves.toBe(true);
    });

    it('omits the detail block when there is none', async () => {
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);

        await expect(confirmAction({ title: 'Reload', message: 'Discard pending changes?' })).resolves.toBe(false);

        expect(confirm).toHaveBeenCalledWith('Reload\n\nDiscard pending changes?');
    });
});
