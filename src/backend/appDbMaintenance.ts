import type { DatabaseClient } from '../electronUtils/useDatabase.ts';

type SettingsStore = Pick<DatabaseClient, 'exec' | 'prepare'>;

/**
 * Settings rows this build reads and writes. Anything else in `settings` is
 * either a cache written by an older build (deleted below) or a key this build
 * forgot to register — both are reported instead of silently accumulating.
 */
export const KNOWN_SETTING_KEYS = ['selectedServerId', 'selectedConnectionId', 'selectedScriptId', 'editorSettings', 'gridCustomFormatters'];
export const KNOWN_SETTING_PREFIXES = ['gridColumnFormatters:', 'serverSchemas:'];

/** Caches older builds wrote and nothing reads any more (the schema cache now
 *  lives in localStorage). On a long-lived app DB these are the bulk of the file. */
export const LEGACY_SETTING_PREFIXES = ['tableInfo:'];

export function isKnownSettingKey(key: string) {
    return KNOWN_SETTING_KEYS.includes(key) || KNOWN_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Keys in `settings` that no current code path reads or writes. */
export function findUnknownSettingKeys(db: SettingsStore): string[] {
    return db
        .prepare('SELECT key FROM settings')
        .all<{ key: string }>()
        .map((row) => row.key)
        .filter((key) => !isKnownSettingKey(key));
}

function countSettingsByPrefixes(db: SettingsStore, prefixes: string[], params: string[]) {
    const clauses = prefixes.map(() => 'key LIKE ?').join(' OR ');
    return db.prepare(`SELECT COUNT(*) AS count FROM settings WHERE ${clauses}`).get<{ count: number }>(...params)?.count ?? 0;
}

/**
 * Drops the orphaned settings caches and compacts the file once. Reports the
 * keys this build does not know, so a future stale cache is noticed instead of
 * being kept forever.
 */
export function cleanupLegacySettings(db: SettingsStore) {
    if (!LEGACY_SETTING_PREFIXES.length) {
        return { deleted: 0, unknownKeys: findUnknownSettingKeys(db) };
    }

    const params = LEGACY_SETTING_PREFIXES.map((prefix) => `${prefix}%`);
    const deleted = countSettingsByPrefixes(db, LEGACY_SETTING_PREFIXES, params);

    if (deleted > 0) {
        const clauses = LEGACY_SETTING_PREFIXES.map(() => 'key LIKE ?').join(' OR ');
        db.prepare(`DELETE FROM settings WHERE ${clauses}`).run(...params);
        // Rewrite the file without the freed pages. The app DB runs in WAL mode, so
        // VACUUM alone leaves the old file until the write-ahead log is truncated.
        db.exec('VACUUM;');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    }

    const unknownKeys = findUnknownSettingKeys(db);

    if (unknownKeys.length) {
        const shown = unknownKeys.slice(0, 10).join(', ');
        console.warn(`[appDb] settings keys not read by this build: ${shown}${unknownKeys.length > 10 ? ` (+${unknownKeys.length - 10} more)` : ''}`);
    }

    return { deleted, unknownKeys };
}
