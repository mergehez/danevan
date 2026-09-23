import { describe, expect, it } from 'vitest';
import { hasSuspiciousSqlWhitespace, normalizeSqlInputWhitespace } from './sqlTextNormalization';

describe('normalizeSqlInputWhitespace', () => {
    it('preserves newlines so line comments survive', () => {
        const input = '#drop table `posts`;\ndrop table `seos`;\n#drop table `sliders`;';

        expect(normalizeSqlInputWhitespace(input)).toBe(input);
    });

    it('collapses spaces/tabs but keeps line breaks', () => {
        expect(normalizeSqlInputWhitespace('select  1\t\t;\n  from t')).toBe('select 1 ;\n from t');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeSqlInputWhitespace('  SELECT 1  ')).toBe('SELECT 1');
    });
});

describe('hasSuspiciousSqlWhitespace', () => {
    it('detects unicode/zero-width whitespace', () => {
        expect(hasSuspiciousSqlWhitespace('select\u00A01')).toBe(true);
        expect(hasSuspiciousSqlWhitespace('select 1')).toBe(false);
    });
});
