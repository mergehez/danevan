import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinNativePath, writeClipboardText } from './nativePaths';

describe('joinNativePath', () => {
    it('joins POSIX paths with a single separator', () => {
        expect(joinNativePath('/Users/me/tables', 'users.sql')).toBe('/Users/me/tables/users.sql');
    });

    it('keeps Windows separators when the base path uses them', () => {
        expect(joinNativePath('C:\\Users\\me\\tables', 'users.sql')).toBe('C:\\Users\\me\\tables\\users.sql');
    });

    it('collapses trailing and leading separators on both sides', () => {
        expect(joinNativePath('/Users/me/tables///', '//exports//users.sql')).toBe('/Users/me/tables/exports/users.sql');
        expect(joinNativePath('C:\\tables\\', '\\exports\\users.sql')).toBe('C:\\tables\\exports\\users.sql');
    });

    it('returns the base path untouched for an empty relative path', () => {
        expect(joinNativePath('/Users/me/tables', '')).toBe('/Users/me/tables');
    });
});

describe('writeClipboardText', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses the async clipboard when the platform allows it', async () => {
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });

        await writeClipboardText('SELECT 1;');

        expect(writeText).toHaveBeenCalledWith('SELECT 1;');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back to a DOM copy when the async clipboard rejects', async () => {
        const writeText = vi.fn(async () => {
            throw new Error('denied');
        });
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const execCommand = vi.fn(() => true);
        document.execCommand = execCommand;

        await writeClipboardText('SELECT 2;');

        expect(writeText).toHaveBeenCalledWith('SELECT 2;');
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back to a DOM copy when the platform has no async clipboard', async () => {
        vi.stubGlobal('navigator', {});
        const execCommand = vi.fn(() => true);
        document.execCommand = execCommand;

        await writeClipboardText('SELECT 3;');

        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
    });
});
