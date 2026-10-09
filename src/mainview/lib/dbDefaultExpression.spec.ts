import { describe, expect, it } from 'vitest';
import type { DbType } from '../../shared/types';
import { getDbDefaultExpressionFunctionNames, getDbDefaultExpressionOptions } from './dbDefaultExpression';

function findOption(driver: DbType | undefined, label: string) {
    const match = getDbDefaultExpressionOptions(driver).find((entry) => entry.label === label);

    if (!match) {
        throw new Error(`No default-expression option labelled "${label}"`);
    }

    return match;
}

describe('getDbDefaultExpressionOptions', () => {
    it('offers a base list for every dialect, defaulting to SQL Server', () => {
        expect(getDbDefaultExpressionOptions('mysql')[0]).toEqual({ label: 'NULL', value: 'NULL' });
        expect(getDbDefaultExpressionOptions('postgresql')[0]).toEqual({ label: 'NULL', value: 'NULL' });
        expect(getDbDefaultExpressionOptions('sqlite')[0]).toEqual({ label: 'NULL', value: 'NULL' });
        expect(getDbDefaultExpressionOptions('msaccess')[0]).toEqual({ label: 'NULL', value: 'NULL' });
        expect(getDbDefaultExpressionOptions(undefined)).toEqual(getDbDefaultExpressionOptions('sqlserver'));
    });

    it('strips type annotations from a signature and selects the first argument', () => {
        expect(findOption('mysql', 'ADDDATE(expr:date, days:int)')).toEqual({
            label: 'ADDDATE(expr:date, days:int)',
            value: 'ADDDATE(expr, days)',
            appliedText: 'ADDDATE(expr, days)',
            selectionStart: 8,
            selectionEnd: 12,
        });
        expect(findOption('mysql', 'UUID_TO_BIN(uuid_str:varchar)')).toEqual({
            label: 'UUID_TO_BIN(uuid_str:varchar)',
            value: 'UUID_TO_BIN(uuid_str)',
            appliedText: 'UUID_TO_BIN(uuid_str)',
            selectionStart: 12,
            selectionEnd: 20,
        });
        expect(findOption('sqlserver', 'JSON_OBJECT(key:value)')).toEqual({
            label: 'JSON_OBJECT(key:value)',
            value: 'JSON_OBJECT(key)',
            appliedText: 'JSON_OBJECT(key)',
            selectionStart: 12,
            selectionEnd: 15,
        });
    });

    it('keeps multi-word and untyped arguments untouched', () => {
        expect(findOption('mysql', 'DATE_ADD(date:date, INTERVAL expr unit)')).toEqual({
            label: 'DATE_ADD(date:date, INTERVAL expr unit)',
            value: 'DATE_ADD(date, INTERVAL expr unit)',
            appliedText: 'DATE_ADD(date, INTERVAL expr unit)',
            selectionStart: 9,
            selectionEnd: 13,
        });
        expect(findOption('mysql', 'EXTRACT(unit FROM date)')).toEqual({
            label: 'EXTRACT(unit FROM date)',
            value: 'EXTRACT(unit FROM date)',
            appliedText: 'EXTRACT(unit FROM date)',
            selectionStart: 8,
            selectionEnd: 22,
        });
        expect(findOption('sqlite', 'substr(text, start)')).toEqual({
            label: 'substr(text, start)',
            value: 'substr(text, start)',
            appliedText: 'substr(text, start)',
            selectionStart: 7,
            selectionEnd: 11,
        });
    });

    it('leaves plain expressions without an applied text or selection', () => {
        expect(findOption('sqlite', "strftime('%s','now')")).toEqual({ label: "strftime('%s','now')", value: "strftime('%s','now')" });
        expect(findOption('msaccess', 'Year(Date())')).toEqual({ label: 'Year(Date())', value: 'Year(Date())' });
    });

    it('does not prepend a current value that matches an option value or label', () => {
        const mysqlBase = getDbDefaultExpressionOptions('mysql');

        // CURRENT_TIMESTAMP is a plain option; the other two are the applied value and the label of UUID_TO_BIN.
        expect(getDbDefaultExpressionOptions('mysql', 'CURRENT_TIMESTAMP')).toEqual(mysqlBase);
        expect(getDbDefaultExpressionOptions('mysql', 'UUID_TO_BIN(uuid_str)')).toEqual(mysqlBase);
        expect(getDbDefaultExpressionOptions('mysql', 'UUID_TO_BIN(uuid_str:varchar)')).toEqual(mysqlBase);
        expect(getDbDefaultExpressionOptions('mysql', '  UUID_TO_BIN(uuid_str)  ')).toEqual(mysqlBase);
    });

    it('prepends an unrecognised current value, trimmed', () => {
        const options = getDbDefaultExpressionOptions('postgresql', "  date_trunc('day', now())  ");

        expect(options[0]).toEqual({ label: "date_trunc('day', now())", value: "date_trunc('day', now())" });
        expect(options.slice(1)).toEqual(getDbDefaultExpressionOptions('postgresql'));
    });

    it('returns the base list for a blank current value', () => {
        expect(getDbDefaultExpressionOptions('sqlite', '')).toEqual(getDbDefaultExpressionOptions('sqlite'));
        expect(getDbDefaultExpressionOptions('sqlite', '   ')).toEqual(getDbDefaultExpressionOptions('sqlite'));
        expect(getDbDefaultExpressionOptions('sqlite', null)).toEqual(getDbDefaultExpressionOptions('sqlite'));
        expect(getDbDefaultExpressionOptions('sqlite', undefined)).toEqual(getDbDefaultExpressionOptions('sqlite'));
    });
});

describe('getDbDefaultExpressionFunctionNames', () => {
    it('lists the SQL Server function names in list order, lower-cased and de-duplicated', () => {
        expect(getDbDefaultExpressionFunctionNames('sqlserver')).toEqual([
            'getdate',
            'sysdatetime',
            'sysutcdatetime',
            'newid',
            'newsequentialid',
            'suser_sname',
            'db_name',
            'host_name',
            'rand',
            'abs',
            'coalesce',
            'concat',
            'format',
            'lower',
            'upper',
            'ltrim',
            'rtrim',
            'trim',
            'json_object',
            'json_array',
        ]);
    });

    it('treats an unknown dialect as SQL Server', () => {
        expect(getDbDefaultExpressionFunctionNames(undefined)).toEqual(getDbDefaultExpressionFunctionNames('sqlserver'));
    });

    it('de-duplicates repeated functions and skips expressions that are not calls', () => {
        const mysqlFunctionNames = getDbDefaultExpressionFunctionNames('mysql');

        // UNIX_TIMESTAMP() and UNIX_TIMESTAMP(date:date) both yield unix_timestamp; bare NULL has no call.
        expect(mysqlFunctionNames.filter((name) => name === 'unix_timestamp')).toEqual(['unix_timestamp']);
        expect(mysqlFunctionNames).toContain('utc_timestamp');
        expect(mysqlFunctionNames).toContain('uuid_to_bin');
        expect(mysqlFunctionNames).toContain('date_add');
        // CURRENT_TIMESTAMP has no call and is skipped, while its parenthesised form is kept.
        expect(mysqlFunctionNames).toContain('current_timestamp');
        expect(mysqlFunctionNames).not.toContain('null');
    });
});
