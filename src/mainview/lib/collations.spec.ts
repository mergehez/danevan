import { describe, expect, it } from 'vitest';
import { getDbCollationOptions, getDbCollationOptionsQuery, normalizeDbCollationOptions } from './collations';

describe('getDbCollationOptionsQuery', () => {
    it('returns the catalog query for each supported driver', () => {
        expect(getDbCollationOptionsQuery('mysql')).toBe('SHOW COLLATION;');
        expect(getDbCollationOptionsQuery('postgresql')).toBe('SELECT collname AS name FROM pg_collation ORDER BY collname;');
        expect(getDbCollationOptionsQuery('sqlite')).toBe('PRAGMA collation_list;');
    });

    it('returns undefined for drivers without a collation catalog', () => {
        expect(getDbCollationOptionsQuery('sqlserver')).toBeUndefined();
        expect(getDbCollationOptionsQuery('msaccess')).toBeUndefined();
        expect(getDbCollationOptionsQuery(undefined)).toBeUndefined();
    });
});

describe('normalizeDbCollationOptions', () => {
    it('reads the MySQL Collation column and falls back to the lowercase spelling', () => {
        expect(
            normalizeDbCollationOptions('mysql', [
                { Collation: 'utf8mb4_bin' },
                { collation: 'latin1_swedish_ci' },
                { Collation: null, collation: 'utf8mb4_general_ci' },
            ])
        ).toEqual(['latin1_swedish_ci', 'utf8mb4_bin', 'utf8mb4_general_ci']);
    });

    it('treats an empty Collation cell as empty instead of falling back', () => {
        // `??` only skips nullish cells, so a blank primary column wins over the fallback key.
        expect(
            normalizeDbCollationOptions('mysql', [
                { Collation: '', collation: 'utf8mb4_bin' },
                { Collation: '   ', collation: 'latin1_bin' },
            ])
        ).toEqual([]);
    });

    it('coerces scalar cells to text and drops objects and arrays', () => {
        expect(
            normalizeDbCollationOptions('mysql', [{ Collation: 45 }, { Collation: 46n }, { Collation: true }, { Collation: false }, { Collation: {} }, { Collation: ['x'] }])
        ).toEqual(['45', '46', 'false', 'true']);
    });

    it('reads name, then collname, for PostgreSQL rows', () => {
        expect(normalizeDbCollationOptions('postgresql', [{ name: 'C' }, { collname: 'en_US.utf8' }, { name: 'C' }, { name: 'POSIX' }])).toEqual([
            'C',
            'en_US.utf8',
            'POSIX',
        ]);
    });

    it('reads name, then seqname, for SQLite rows', () => {
        expect(
            normalizeDbCollationOptions('sqlite', [
                { name: 'BINARY' },
                { seqname: 'NOCASE' },
                { name: null, seqname: 'RTRIM' },
                { name: '', seqname: 'IGNORED' },
            ])
        ).toEqual(['BINARY', 'NOCASE', 'RTRIM']);
    });

    it('returns an empty list for drivers without collations or without rows', () => {
        expect(normalizeDbCollationOptions('sqlserver', [{ name: 'x' }, { Collation: 'y' }])).toEqual([]);
        expect(normalizeDbCollationOptions('msaccess', [{ name: 'x' }])).toEqual([]);
        expect(normalizeDbCollationOptions(undefined, [{ name: 'x' }])).toEqual([]);
        expect(normalizeDbCollationOptions('mysql', [])).toEqual([]);
    });
});

describe('getDbCollationOptions', () => {
    it('maps base options to value/label pairs', () => {
        expect(getDbCollationOptions(['utf8mb4_bin', 'latin1_swedish_ci'])).toEqual([
            { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
            { value: 'latin1_swedish_ci', label: 'latin1_swedish_ci' },
        ]);
    });

    it('prepends an unknown current value', () => {
        expect(getDbCollationOptions(['utf8mb4_bin'], 'utf8mb4_0900_ai_ci')).toEqual([
            { value: 'utf8mb4_0900_ai_ci', label: 'utf8mb4_0900_ai_ci' },
            { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
        ]);
    });

    it('does not duplicate a current value already offered, and trims before comparing', () => {
        expect(getDbCollationOptions(['utf8mb4_bin', 'latin1_bin'], 'utf8mb4_bin')).toEqual([
            { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
            { value: 'latin1_bin', label: 'latin1_bin' },
        ]);
        expect(getDbCollationOptions(['utf8mb4_bin'], '  utf8mb4_bin  ')).toEqual([{ value: 'utf8mb4_bin', label: 'utf8mb4_bin' }]);
    });

    it('ignores a blank current value and compares case-sensitively', () => {
        expect(getDbCollationOptions(['utf8mb4_bin'], '')).toEqual([{ value: 'utf8mb4_bin', label: 'utf8mb4_bin' }]);
        expect(getDbCollationOptions(['utf8mb4_bin'], null)).toEqual([{ value: 'utf8mb4_bin', label: 'utf8mb4_bin' }]);
        expect(getDbCollationOptions(['utf8mb4_bin'], 'UTF8MB4_BIN')).toEqual([
            { value: 'UTF8MB4_BIN', label: 'UTF8MB4_BIN' },
            { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
        ]);
    });

    it('offers only the current value when there are no base options', () => {
        expect(getDbCollationOptions([], 'BINARY')).toEqual([{ value: 'BINARY', label: 'BINARY' }]);
        expect(getDbCollationOptions([])).toEqual([]);
    });
});
