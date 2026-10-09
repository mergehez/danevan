import { describe, expect, it } from 'vitest';
import type { DbType } from '../types';
import { quoteSqlIdentifier, unquoteSqlIdentifier } from './sqlIdentifiers';

describe('quoteSqlIdentifier', () => {
    it('uses backticks for MySQL', () => {
        expect(quoteSqlIdentifier('users', 'mysql')).toBe('`users`');
        expect(quoteSqlIdentifier('select', 'mysql')).toBe('`select`');
    });

    it('uses double quotes for PostgreSQL and SQLite', () => {
        expect(quoteSqlIdentifier('users', 'postgresql')).toBe('"users"');
        expect(quoteSqlIdentifier('users', 'sqlite')).toBe('"users"');
    });

    it('uses brackets for SQL Server and MS Access', () => {
        expect(quoteSqlIdentifier('users', 'sqlserver')).toBe('[users]');
        expect(quoteSqlIdentifier('users', 'msaccess')).toBe('[users]');
    });

    it('escapes the dialect quote character inside an identifier', () => {
        expect(quoteSqlIdentifier('we`ird', 'mysql')).toBe('`we``ird`');
        expect(quoteSqlIdentifier('we"ird', 'postgresql')).toBe('"we""ird"');
        expect(quoteSqlIdentifier('we"ird', 'sqlite')).toBe('"we""ird"');
        expect(quoteSqlIdentifier('we]ird', 'sqlserver')).toBe('[we]]ird]');
        expect(quoteSqlIdentifier('we]ird', 'msaccess')).toBe('[we]]ird]');
    });

    it('quotes every part of a qualified name', () => {
        expect(quoteSqlIdentifier('app.users', 'mysql')).toBe('`app`.`users`');
        expect(quoteSqlIdentifier('app.public.users', 'postgresql')).toBe('"app"."public"."users"');
        expect(quoteSqlIdentifier('app.dbo.users', 'sqlserver')).toBe('[app].[dbo].[users]');
    });

    it('trims parts and drops empty ones', () => {
        expect(quoteSqlIdentifier('  app . users  ', 'mysql')).toBe('`app`.`users`');
        expect(quoteSqlIdentifier('app..users', 'mysql')).toBe('`app`.`users`');
        expect(quoteSqlIdentifier('.users.', 'mysql')).toBe('`users`');
        expect(quoteSqlIdentifier('', 'mysql')).toBe('');
        expect(quoteSqlIdentifier('   ', 'mysql')).toBe('');
        expect(quoteSqlIdentifier('.', 'mysql')).toBe('');
    });

    it('keeps spaces inside an identifier', () => {
        expect(quoteSqlIdentifier('my table', 'mysql')).toBe('`my table`');
        expect(quoteSqlIdentifier('my table', 'sqlserver')).toBe('[my table]');
    });
});

describe('unquoteSqlIdentifier', () => {
    it('strips each supported quoting style', () => {
        expect(unquoteSqlIdentifier('`users`')).toBe('users');
        expect(unquoteSqlIdentifier('"users"')).toBe('users');
        expect(unquoteSqlIdentifier('[users]')).toBe('users');
    });

    it('unescapes the doubled quote character', () => {
        expect(unquoteSqlIdentifier('`we``ird`')).toBe('we`ird');
        expect(unquoteSqlIdentifier('"we""ird"')).toBe('we"ird');
        expect(unquoteSqlIdentifier('[we]]ird]')).toBe('we]ird');
    });

    it('trims and leaves unquoted or mismatched input alone', () => {
        expect(unquoteSqlIdentifier('  users  ')).toBe('users');
        expect(unquoteSqlIdentifier('  `users`  ')).toBe('users');
        expect(unquoteSqlIdentifier('  [users]  ')).toBe('users');
        expect(unquoteSqlIdentifier('`users')).toBe('`users');
        expect(unquoteSqlIdentifier('users`')).toBe('users`');
        expect(unquoteSqlIdentifier('"users`')).toBe('"users`');
        expect(unquoteSqlIdentifier('`')).toBe('`');
        expect(unquoteSqlIdentifier('"')).toBe('"');
        expect(unquoteSqlIdentifier('[')).toBe('[');
        expect(unquoteSqlIdentifier('[]')).toBe('');
        expect(unquoteSqlIdentifier('')).toBe('');
    });
});

describe('quoteSqlIdentifier / unquoteSqlIdentifier round trip', () => {
    const dialects: DbType[] = ['mysql', 'postgresql', 'sqlite', 'sqlserver', 'msaccess'];
    const identifiers = ['users', 'user id', 'select', 'we`ird', 'we"ird', 'we]ird', 'we`ird "quoted" [bracketed]'];

    it.each(dialects)('restores a single-part identifier for %s', (dialect) => {
        for (const identifier of identifiers) {
            expect(unquoteSqlIdentifier(quoteSqlIdentifier(identifier, dialect))).toBe(identifier);
        }
    });

    it('does not restore a qualified identifier, because unquote only strips the outer pair', () => {
        expect(unquoteSqlIdentifier(quoteSqlIdentifier('app.users', 'mysql'))).toBe('app`.`users');
        expect(unquoteSqlIdentifier(quoteSqlIdentifier('app.users', 'postgresql'))).toBe('app"."users');
        expect(unquoteSqlIdentifier(quoteSqlIdentifier('app.users', 'sqlserver'))).toBe('app].[users');
    });
});
