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

    it('keeps semicolons inside double-quoted identifiers', () => {
        expect(splitSqlStatements('SELECT "a;b" FROM t; SELECT 2;')).toEqual(['SELECT "a;b" FROM t', 'SELECT 2']);
    });

    it('keeps semicolons after doubled quotes inside identifiers and literals', () => {
        expect(splitSqlStatements('SELECT "a""b;c" FROM t; SELECT 2;')).toEqual(['SELECT "a""b;c" FROM t', 'SELECT 2']);
        expect(splitSqlStatements("SELECT 'it''s; ok' AS a; SELECT 2;")).toEqual(["SELECT 'it''s; ok' AS a", 'SELECT 2']);
        expect(splitSqlStatements('SELECT `a``b;c` FROM t; SELECT 2;')).toEqual(['SELECT `a``b;c` FROM t', 'SELECT 2']);
    });

    it('ignores quote characters of another style inside a quoted block', () => {
        expect(splitSqlStatements(`SELECT "a'b;c" FROM t;`)).toEqual([`SELECT "a'b;c" FROM t`]);
        expect(splitSqlStatements(`SELECT 'a"b;c' FROM t;`)).toEqual([`SELECT 'a"b;c' FROM t`]);
        expect(splitSqlStatements("SELECT 'a`b;c' FROM t;")).toEqual(["SELECT 'a`b;c' FROM t"]);
    });

    it('keeps semicolons inside an unterminated block comment', () => {
        expect(splitSqlStatements('SELECT 1 /* unterminated')).toEqual(['SELECT 1 /* unterminated']);
        expect(splitSqlStatements('SELECT 1; /* unterminated')).toEqual(['SELECT 1']);
        expect(splitSqlStatements('/* unterminated')).toEqual([]);
    });

    it('keeps semicolons inside an unterminated string literal', () => {
        expect(splitSqlStatements("SELECT 'abc; DEF")).toEqual(["SELECT 'abc; DEF"]);
    });

    it('drops empty statements and whitespace-only input', () => {
        expect(splitSqlStatements('SELECT 1;;SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
        expect(splitSqlStatements(';;;')).toEqual([]);
        expect(splitSqlStatements('   \n  ')).toEqual([]);
        expect(splitSqlStatements('SELECT 1;\n\n')).toEqual(['SELECT 1']);
    });

    it('does not treat a single slash or minus as a comment', () => {
        expect(splitSqlStatements('SELECT 4 / 2;')).toEqual(['SELECT 4 / 2']);
        expect(splitSqlStatements('SELECT 1 - 2;')).toEqual(['SELECT 1 - 2']);
    });

    it('trims multiline statements and drops comment-only segments', () => {
        expect(splitSqlStatements('\n\nSELECT 1\nFROM t\n;\nSELECT 2\n')).toEqual(['SELECT 1\nFROM t', 'SELECT 2']);
        expect(splitSqlStatements('/* c */; SELECT 1;')).toEqual(['SELECT 1']);
        expect(splitSqlStatements('# c\nSELECT 1')).toEqual(['# c\nSELECT 1']);
    });
});
