import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './sqlStatements';

describe('splitSqlStatements', () => {
    it('splits multiple statements on top-level semicolons', () => {
        expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('keeps semicolons inside single-quoted string literals', () => {
        expect(splitSqlStatements("SELECT 'a;b' FROM t; SELECT 2;")).toEqual(["SELECT 'a;b' FROM t", 'SELECT 2']);
    });

    it('keeps semicolons inside backtick identifiers', () => {
        expect(splitSqlStatements('SELECT `a;b` FROM t;')).toEqual(['SELECT `a;b` FROM t']);
    });

    it('ignores semicolons inside line comments', () => {
        expect(splitSqlStatements('SELECT 1; -- comment;\nSELECT 2;')).toEqual(['SELECT 1', '-- comment;\nSELECT 2']);
    });

    it('ignores semicolons inside hash comments', () => {
        expect(splitSqlStatements('SELECT 1; # comment;\nSELECT 2;')).toEqual(['SELECT 1', '# comment;\nSELECT 2']);
        expect(splitSqlStatements('SELECT 1; # comment;')).toEqual(['SELECT 1']);
    });

    it('ignores semicolons inside block comments', () => {
        expect(splitSqlStatements('/* block; comment */ SELECT 1;')).toEqual(['/* block; comment */ SELECT 1']);
    });

    it('keeps a trailing statement without a semicolon', () => {
        expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']);
    });

    it('drops comment-only statements', () => {
        expect(splitSqlStatements('-- only comment')).toEqual([]);
        expect(splitSqlStatements('/* only block */')).toEqual([]);
        expect(splitSqlStatements('')).toEqual([]);
    });
});
