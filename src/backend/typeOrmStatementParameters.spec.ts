import { describe, expect, it } from 'vitest';
import { prepareTypeOrmParameterizedStatement } from './typeOrmStatementParameters';

// The placeholder callbacks match the drivers' call sites.
const postgres = (index: number) => `$${index + 1}`;
const sqlServer = (index: number) => `@${index}`;
const named = (index: number) => `@p${index + 1}`;

describe('prepareTypeOrmParameterizedStatement', () => {
    it('leaves SQL without placeholders untouched', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT 1 FROM users', postgres)).toEqual({ sql: 'SELECT 1 FROM users', paramCount: 0 });
        expect(prepareTypeOrmParameterizedStatement('', postgres)).toEqual({ sql: '', paramCount: 0 });
    });

    it('rewrites placeholders one-based for the PostgreSQL style', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT * FROM users WHERE email = ? AND tenant_id = ?', postgres)).toEqual({
            sql: 'SELECT * FROM users WHERE email = $1 AND tenant_id = $2',
            paramCount: 2,
        });
    });

    it('rewrites placeholders zero-based for the SQL Server style', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT * FROM [dbo].[users] WHERE email = ? AND tenant_id = ?', sqlServer)).toEqual({
            sql: 'SELECT * FROM [dbo].[users] WHERE email = @0 AND tenant_id = @1',
            paramCount: 2,
        });
    });

    it('supports a named placeholder style', () => {
        expect(prepareTypeOrmParameterizedStatement('UPDATE users SET name = ? WHERE id = ?', named)).toEqual({
            sql: 'UPDATE users SET name = @p1 WHERE id = @p2',
            paramCount: 2,
        });
    });

    it('passes placeholder indexes in source order', () => {
        const seen: number[] = [];
        const prepared = prepareTypeOrmParameterizedStatement('SELECT ?, ?, ?', (index) => {
            seen.push(index);
            return `:${index}`;
        });

        expect(seen).toEqual([0, 1, 2]);
        expect(prepared).toEqual({ sql: 'SELECT :0, :1, :2', paramCount: 3 });
    });

    it('keeps question marks inside single-quoted literals', () => {
        expect(prepareTypeOrmParameterizedStatement("SELECT '?' AS marker, ? FROM t WHERE note = 'a?b'", postgres)).toEqual({
            sql: "SELECT '?' AS marker, $1 FROM t WHERE note = 'a?b'",
            paramCount: 1,
        });
    });

    it('handles doubled single quotes inside literals', () => {
        expect(prepareTypeOrmParameterizedStatement("SELECT 'it''s ?' AS a, ? FROM t", postgres)).toEqual({
            sql: "SELECT 'it''s ?' AS a, $1 FROM t",
            paramCount: 1,
        });
    });

    it('keeps question marks inside double-quoted identifiers', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT "a?b", "a""b", ? FROM t', postgres)).toEqual({
            sql: 'SELECT "a?b", "a""b", $1 FROM t',
            paramCount: 1,
        });
    });

    it('keeps question marks inside bracket identifiers', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT [a?b], [a]]?b] FROM t WHERE c = ?', sqlServer)).toEqual({
            sql: 'SELECT [a?b], [a]]?b] FROM t WHERE c = @0',
            paramCount: 1,
        });
    });

    it('keeps question marks inside line comments', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT ? -- keep ? here\nFROM t WHERE b = ?', postgres)).toEqual({
            sql: 'SELECT $1 -- keep ? here\nFROM t WHERE b = $2',
            paramCount: 2,
        });
        expect(prepareTypeOrmParameterizedStatement('SELECT ? -- trailing ?', postgres)).toEqual({
            sql: 'SELECT $1 -- trailing ?',
            paramCount: 1,
        });
    });

    it('keeps question marks inside block comments', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT /* ? */ ? FROM t', postgres)).toEqual({
            sql: 'SELECT /* ? */ $1 FROM t',
            paramCount: 1,
        });
    });

    it('does not open a comment or identifier inside a literal', () => {
        expect(prepareTypeOrmParameterizedStatement("SELECT '-- ?', '/* ? */', '[?]', ? FROM t", postgres)).toEqual({
            sql: "SELECT '-- ?', '/* ? */', '[?]', $1 FROM t",
            paramCount: 1,
        });
    });

    it('does not treat single operators as comments', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT a - b / c, ? FROM t', postgres)).toEqual({
            sql: 'SELECT a - b / c, $1 FROM t',
            paramCount: 1,
        });
    });

    it('leaves everything from an unterminated literal untouched', () => {
        expect(prepareTypeOrmParameterizedStatement("SELECT 'abc ? , ?", postgres)).toEqual({ sql: "SELECT 'abc ? , ?", paramCount: 0 });
        expect(prepareTypeOrmParameterizedStatement('SELECT "abc ? , ?', postgres)).toEqual({ sql: 'SELECT "abc ? , ?', paramCount: 0 });
    });

    it('leaves everything from an unterminated bracket identifier untouched', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT [a? FROM t WHERE b = ?', sqlServer)).toEqual({ sql: 'SELECT [a? FROM t WHERE b = ?', paramCount: 0 });
    });

    it('rewrites placeholders before an unterminated block comment', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT ? /* ?', postgres)).toEqual({ sql: 'SELECT $1 /* ?', paramCount: 1 });
    });

    it('handles consecutive placeholders and a trailing placeholder', () => {
        expect(prepareTypeOrmParameterizedStatement('SELECT ??', postgres)).toEqual({ sql: 'SELECT $1$2', paramCount: 2 });
        expect(prepareTypeOrmParameterizedStatement('?', named)).toEqual({ sql: '@p1', paramCount: 1 });
    });
});
