// The app DB accumulates settings rows written by older builds (the schema cache
// moved to localStorage). configureDatabase cleans them once and reports keys the
// current build does not know, so a future stale cache is noticed.
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupLegacySettings, findUnknownSettingKeys, isKnownSettingKey } from '../../../backend/appDbMaintenance';

let databasePath = '';
let file: Database.Database;

function createSettingsStore() {
    return {
        exec: (sql: string) => {
            file.exec(sql);
        },
        prepare: (sql: string) => ({
            run: (...params: unknown[]) => ({ lastInsertRowid: file.prepare(sql).run(...(params as never[])).lastInsertRowid }),
            get: (...params: unknown[]) => file.prepare(sql).get(...(params as never[])) as never,
            all: (...params: unknown[]) => file.prepare(sql).all(...(params as never[])) as never,
        }),
    } as unknown as Parameters<typeof cleanupLegacySettings>[0];
}

function seed(key: string, value: string) {
    file.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run(key, value);
}

function keys() {
    return (file.prepare('SELECT key FROM settings ORDER BY key').all() as Array<{ key: string }>).map((row) => row.key);
}

beforeEach(() => {
    databasePath = join(mkdtempSync(join(tmpdir(), 'danevan-appdb-')), 'app.sqlite');
    file = new Database(databasePath);
    file.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
});

afterEach(() => {
    file.close();
    rmSync(databasePath, { force: true });
    vi.restoreAllMocks();
});

describe('cleanupLegacySettings', () => {
    it('drops the orphaned tableInfo cache and keeps the live keys', () => {
        seed('selectedServerId', '1');
        seed('editorSettings', '{}');
        seed('gridColumnFormatters:1:people', '{}');
        seed('serverSchemas:1', '[]');
        seed('tableInfo:1:people', JSON.stringify({ huge: 'x'.repeat(5000) }));
        seed('tableInfo:1:orders', JSON.stringify({ huge: 'x'.repeat(5000) }));

        const result = cleanupLegacySettings(createSettingsStore());

        expect(result.deleted).toBe(2);
        expect(result.unknownKeys).toEqual([]);
        expect(keys()).toEqual(['editorSettings', 'gridColumnFormatters:1:people', 'selectedServerId', 'serverSchemas:1']);
    });

    it('compacts the file only when it actually deleted rows', () => {
        file.pragma('journal_mode = WAL');
        seed('tableInfo:1:people', 'x'.repeat(200_000));
        seed('selectedServerId', '1');

        const store = createSettingsStore();
        const exec = vi.spyOn(store, 'exec');
        // Flush the seeded rows so the on-disk size is the honest baseline.
        file.pragma('wal_checkpoint(TRUNCATE)');
        const sizeBefore = statSync(databasePath).size;
        const first = cleanupLegacySettings(store);

        expect(first.deleted).toBe(1);
        expect(exec).toHaveBeenCalledWith('VACUUM;');
        expect(exec).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE);');
        expect(file.pragma('freelist_count', { simple: true })).toBe(0);
        expect(statSync(databasePath).size).toBeLessThan(sizeBefore);

        exec.mockClear();
        const second = cleanupLegacySettings(store);

        expect(second.deleted).toBe(0);
        expect(exec).not.toHaveBeenCalled();
    });

    it('reports settings keys this build does not know instead of keeping them silently', () => {
        seed('tableInfo:1:people', '{}');
        seed('someFutureCache:1', '{}');
        seed('editorSettings', '{}');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = cleanupLegacySettings(createSettingsStore());

        expect(result.deleted).toBe(1);
        expect(result.unknownKeys).toEqual(['someFutureCache:1']);
        expect(warn).toHaveBeenCalledWith('[appDb] settings keys not read by this build: someFutureCache:1');
    });
});

describe('setting key bookkeeping', () => {
    it('accepts exact keys and per-entity prefixes only', () => {
        expect(isKnownSettingKey('selectedServerId')).toBe(true);
        expect(isKnownSettingKey('gridColumnFormatters:12:users')).toBe(true);
        expect(isKnownSettingKey('serverSchemas:3')).toBe(true);
        expect(isKnownSettingKey('tableInfo:1:users')).toBe(false);
        expect(isKnownSettingKey('gridCustomFormattersExtra')).toBe(false);
    });

    it('lists unknown keys from the store', () => {
        seed('editorSettings', '{}');
        seed('tableInfo:1:people', '{}');

        expect(findUnknownSettingKeys(createSettingsStore())).toEqual(['tableInfo:1:people']);
    });
});
