import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTableDdlRun = vi.fn<(params: { connectionId: number; tableName: string }) => Promise<string>>();
const formatSqlRun = vi.fn<(params: { sql: string; dialect?: string }) => Promise<string>>();
const formatSqlClearError = vi.fn<() => void>();
const writeClipboardText = vi.fn<(text: string) => Promise<void>>();
const clipboardWrite = vi.fn<(items: ClipboardItem[]) => Promise<void>>();

vi.mock('@composables/useTasks', () => ({
    tasks: {
        getTableDdl: {
            run: getTableDdlRun,
        },
        formatSql: {
            run: formatSqlRun,
            clearError: formatSqlClearError,
        },
    },
}));

vi.mock('../../lib/nativePaths', () => ({
    writeClipboardText,
}));

class MockClipboardItem {
    private readonly payloads: Record<string, Promise<Blob>>;

    constructor(payloads: Record<string, Blob | Promise<Blob>>) {
        this.payloads = Object.fromEntries(Object.entries(payloads).map(([type, value]) => [type, Promise.resolve(value)]));
    }

    get types() {
        return Object.keys(this.payloads);
    }

    async getType(type: string) {
        const payload = this.payloads[type];

        if (!payload) {
            throw new Error(`Unknown clipboard type: ${type}`);
        }

        return await payload;
    }
}

describe('copyTableAsDdl', () => {
    beforeEach(() => {
        getTableDdlRun.mockReset();
        formatSqlRun.mockReset();
        formatSqlClearError.mockReset();
        writeClipboardText.mockReset();
        clipboardWrite.mockReset();

        vi.stubGlobal('navigator', {
            clipboard: {
                write: clipboardWrite,
            },
        });
        vi.stubGlobal('ClipboardItem', MockClipboardItem);
    });

    it('starts the browser clipboard write before the ddl promise resolves and copies formatted sql', async () => {
        let resolveDdl: (value: string) => void = () => undefined;
        const ddlPromise = new Promise<string>((resolve) => {
            resolveDdl = resolve;
        });
        let copiedText = '';

        getTableDdlRun.mockReturnValueOnce(ddlPromise);
        formatSqlRun.mockImplementationOnce(async ({ sql }) => `FORMATTED:\n${sql}`);
        clipboardWrite.mockImplementationOnce(async (items) => {
            const blob = await items[0]!.getType('text/plain');
            copiedText = await blob.text();
        });

        const { copyTableAsDdl } = await import('../../apps/app/mainview/composables/useCopyTableDdl');
        const copyPromise = copyTableAsDdl(7, 'users', 'sqlite');

        expect(clipboardWrite).toHaveBeenCalledTimes(1);
        expect(writeClipboardText).not.toHaveBeenCalled();

        resolveDdl('CREATE TABLE users (id INTEGER PRIMARY KEY);');

        await copyPromise;

        expect(formatSqlRun).toHaveBeenCalledWith({
            sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
            dialect: 'sqlite',
        });
        expect(copiedText).toBe('FORMATTED:\nCREATE TABLE users (id INTEGER PRIMARY KEY);');
    });

    it('falls back to raw ddl when formatting fails', async () => {
        getTableDdlRun.mockResolvedValueOnce('CREATE TABLE users (id INTEGER PRIMARY KEY);');
        formatSqlRun.mockRejectedValueOnce(new Error('Formatting is disabled while SQL still has parser or database errors.'));

        let copiedText = '';
        clipboardWrite.mockImplementationOnce(async (items) => {
            const blob = await items[0]!.getType('text/plain');
            copiedText = await blob.text();
        });

        const { copyTableAsDdl } = await import('../../apps/app/mainview/composables/useCopyTableDdl');

        await copyTableAsDdl(7, 'users', 'sqlite');

        expect(formatSqlClearError).toHaveBeenCalledTimes(1);
        expect(copiedText).toBe('CREATE TABLE users (id INTEGER PRIMARY KEY);');
    });

    it('normalizes malformed mysql ddl before formatting and fallback copy', async () => {
        getTableDdlRun.mockResolvedValueOnce(
            "CREATE TABLE `troops` (`resource_type` enum COLLATE \"utf8mb4_unicode_ci\" ('gold', 'elixir') NOT NULL, `created_at` bigint UNSIGNED NOT NULL DEFAULT 'unix_timestamp()');"
        );
        formatSqlRun.mockRejectedValueOnce(new Error('Formatting is disabled while SQL still has parser or database errors.'));

        let copiedText = '';
        clipboardWrite.mockImplementationOnce(async (items) => {
            const blob = await items[0]!.getType('text/plain');
            copiedText = await blob.text();
        });

        const { copyTableAsDdl } = await import('../../apps/app/mainview/composables/useCopyTableDdl');

        await copyTableAsDdl(7, 'troops', 'mysql');

        expect(formatSqlRun).toHaveBeenCalledWith({
            sql: "CREATE TABLE `troops` (`resource_type` enum('gold', 'elixir') COLLATE utf8mb4_unicode_ci NOT NULL, `created_at` bigint UNSIGNED NOT NULL DEFAULT (unix_timestamp()));",
            dialect: 'mysql',
        });
        expect(copiedText).toBe(
            "CREATE TABLE `troops` (`resource_type` enum('gold', 'elixir') COLLATE utf8mb4_unicode_ci NOT NULL, `created_at` bigint UNSIGNED NOT NULL DEFAULT (unix_timestamp()));"
        );
    });
});
