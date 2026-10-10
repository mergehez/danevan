// A SQL literal has to be written for the dialect that will read it back: MySQL treats a
// backslash as an escape (and only under the default sql_mode), while SQLite, PostgreSQL and
// SQL Server keep it, so `C:\temp` must not be escaped for all of them alike.
import { describe, expect, it } from 'vitest';
import { formatValue } from './valueFormatting';

describe('formatValue SQL literals', () => {
    it('doubles the backslashes MySQL reads as escapes', () => {
        expect(formatValue('C:\\temp', { mode: 'sql', dialect: 'mysql' })).toBe("'C:\\\\temp'");
        expect(formatValue('C:\\temp\\', { mode: 'sql', dialect: 'mysql' })).toBe("'C:\\\\temp\\\\'");
        expect(formatValue("it's", { mode: 'sql', dialect: 'mysql' })).toBe("'it''s'");
        expect(formatValue({ path: 'C:\\temp' }, { mode: 'sql', dialect: 'mysql' })).toBe('\'{"path":"C:\\\\\\\\temp"}\'');
    });

    it('leaves a backslash alone for the drivers that keep it', () => {
        expect(formatValue('C:\\temp', { mode: 'sql', dialect: 'sqlite' })).toBe("'C:\\temp'");
        expect(formatValue('C:\\temp', { mode: 'sql', dialect: 'postgresql' })).toBe("'C:\\temp'");
        expect(formatValue('C:\\temp', { mode: 'sql' })).toBe("'C:\\temp'");
    });

    it('writes numbers and NULL without quoting', () => {
        expect(formatValue(42, { mode: 'sql', dialect: 'mysql' })).toBe('42');
        expect(formatValue(null, { mode: 'sql', dialect: 'mysql' })).toBe('NULL');
    });

    it('leaves the display text untouched', () => {
        expect(formatValue('C:\\temp', { dialect: 'mysql' })).toBe('C:\\temp');
        expect(formatValue("it's")).toBe("it's");
    });
});
