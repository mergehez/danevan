// The SQL completion provider decides what the editor offers after `FROM`, inside a
// `WHERE` and at the start of a statement. Drive the real provider (real dt-sql-parser)
// with a minimal Monaco stand-in and assert the items the user sees.
import { describe, expect, it } from 'vitest';
import type * as MonacoEditorModule from 'monaco-editor';
import type { DbType } from '../../shared/types';
import { registerSqlAutocompleteContext, SQL_LANGUAGE_IDS, type SqlAutocompleteSchema } from './monaco';
import { configureSqlLanguageFeatures } from './monacoSqlLanguages';

type CompletionItem = {
    label: string;
    kind: number;
    detail?: string;
    insertText: string;
    sortText?: string;
    insertTextRules?: number;
    range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
};

type CompletionProvider = {
    triggerCharacters?: string[];
    provideCompletionItems: (
        model: {
            uri: { toString: () => string };
            getValue: () => string;
            getLineContent: (lineNumber: number) => string;
            getWordUntilPosition: (position: { column: number }) => { startColumn: number; endColumn: number };
        },
        position: { lineNumber: number; column: number }
    ) => Promise<{ suggestions: CompletionItem[] }>;
};

const completionKinds = {
    Snippet: 27,
    Keyword: 17,
    Interface: 7,
    Class: 5,
    Field: 3,
} as const;

function createMonacoDouble() {
    const providers = new Map<string, CompletionProvider>();
    const registeredLanguages: string[] = [];
    const configuredLanguages: string[] = [];
    const tokenizedLanguages: string[] = [];

    const monaco = {
        languages: {
            getLanguages: () => registeredLanguages.map((id) => ({ id })),
            register: (language: { id: string }) => {
                registeredLanguages.push(language.id);
            },
            setLanguageConfiguration: (languageId: string) => {
                configuredLanguages.push(languageId);
            },
            setMonarchTokensProvider: (languageId: string) => {
                tokenizedLanguages.push(languageId);
            },
            registerCompletionItemProvider: (languageId: string, provider: CompletionProvider) => {
                providers.set(languageId, provider);
                return { dispose: () => undefined };
            },
            CompletionItemKind: completionKinds,
            CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
    };

    return { monaco: monaco as unknown as typeof MonacoEditorModule, providers, registeredLanguages, configuredLanguages, tokenizedLanguages };
}

const monacoDouble = createMonacoDouble();

// `configureSqlLanguageFeatures` is idempotent per module instance, so the double is
// configured once and every test reuses the captured providers.
configureSqlLanguageFeatures(monacoDouble.monaco);

let uriCounter = 0;

async function getCompletions(sql: string, options: { languageId?: string; dialect?: DbType; schema?: SqlAutocompleteSchema } = {}) {
    const languageId = options.languageId ?? SQL_LANGUAGE_IDS.mysql;
    const uri = `inmemory://model/${(uriCounter += 1)}`;
    const schema = options.schema ?? { tables: [], columns: [] };

    registerSqlAutocompleteContext(uri, {
        dialect: options.dialect,
        getSchema: async () => schema,
    });

    const provider = monacoDouble.providers.get(languageId);

    if (!provider) {
        throw new Error(`No completion provider was registered for "${languageId}".`);
    }

    const position = { lineNumber: 1, column: sql.length + 1 };
    const model = {
        uri: { toString: () => uri },
        getValue: () => sql,
        getLineContent: () => sql,
        getWordUntilPosition: (caret: { column: number }) => {
            const wordStartMatch = /[\w$]*$/.exec(sql.slice(0, caret.column - 1));
            return {
                startColumn: caret.column - (wordStartMatch?.[0].length ?? 0),
                endColumn: caret.column,
            };
        },
    };

    const result = await provider.provideCompletionItems(model, position);

    return result.suggestions;
}

function labelsOfKind(suggestions: CompletionItem[], kind: number) {
    return suggestions.filter((item) => item.kind === kind).map((item) => item.label);
}

const schema: SqlAutocompleteSchema = {
    tables: [
        { name: 'users', type: 'table' },
        { name: 'orders', type: 'table' },
        { name: 'user_stats', type: 'view' },
        { name: 'my table', type: 'table' },
    ],
    columns: [
        { tableName: 'users', columnName: 'id' },
        { tableName: 'users', columnName: 'name' },
        { tableName: 'orders', columnName: 'total' },
    ],
};

describe('configureSqlLanguageFeatures', () => {
    it('registers both SQL grammars and their completion providers', () => {
        expect(monacoDouble.registeredLanguages).toEqual([SQL_LANGUAGE_IDS.mysql, SQL_LANGUAGE_IDS.pgsql]);
        expect(monacoDouble.configuredLanguages).toEqual([SQL_LANGUAGE_IDS.mysql, SQL_LANGUAGE_IDS.pgsql]);
        expect(monacoDouble.tokenizedLanguages).toEqual([SQL_LANGUAGE_IDS.mysql, SQL_LANGUAGE_IDS.pgsql]);
        expect([...monacoDouble.providers.keys()]).toEqual([SQL_LANGUAGE_IDS.mysql, SQL_LANGUAGE_IDS.pgsql]);
        expect(monacoDouble.providers.get(SQL_LANGUAGE_IDS.mysql)?.triggerCharacters).toEqual([' ', '.', '_']);
    });

    it('does nothing when it is called a second time', () => {
        const secondDouble = createMonacoDouble();

        configureSqlLanguageFeatures(secondDouble.monaco);

        expect(secondDouble.registeredLanguages).toEqual([]);
        expect(secondDouble.providers.size).toBe(0);
    });
});

describe('SQL table completions', () => {
    it('offers schema tables with MySQL quoting after FROM', async () => {
        const suggestions = await getCompletions('SELECT * FROM ', { dialect: 'mysql', schema });

        expect(labelsOfKind(suggestions, completionKinds.Class)).toEqual(['users', 'orders', 'my table']);
        expect(labelsOfKind(suggestions, completionKinds.Interface)).toEqual(['user_stats']);

        const usersItem = suggestions.find((item) => item.label === 'users')!;
        const viewItem = suggestions.find((item) => item.label === 'user_stats')!;
        const spacedItem = suggestions.find((item) => item.label === 'my table')!;

        expect(usersItem.insertText).toBe('`users`');
        expect(usersItem.detail).toBe('table');
        expect(usersItem.sortText).toBe('00000');
        expect(viewItem.insertText).toBe('`user_stats`');
        expect(viewItem.detail).toBe('view');
        expect(spacedItem.insertText).toBe('`my table`');
    });

    it('quotes per dialect and only brackets SQL Server identifiers that need it', async () => {
        const dialectSchema: SqlAutocompleteSchema = {
            tables: [
                { name: 'users', type: 'table' },
                { name: 'order', type: 'table' },
            ],
            columns: [],
        };

        const mysql = await getCompletions('SELECT * FROM ', { dialect: 'mysql', schema: dialectSchema });
        const postgres = await getCompletions('SELECT * FROM ', { dialect: 'postgresql', schema: dialectSchema });
        const sqlServer = await getCompletions('SELECT * FROM ', { dialect: 'sqlserver', schema: dialectSchema });
        const msAccess = await getCompletions('SELECT * FROM ', { dialect: 'msaccess', schema: dialectSchema });
        const sqlServerSchema: SqlAutocompleteSchema = { tables: [{ name: 'Users', type: 'table' }], columns: [] };
        const mixedCaseSqlServer = await getCompletions('SELECT * FROM ', { dialect: 'sqlserver', schema: sqlServerSchema });

        expect(mysql.map((item) => item.insertText).slice(0, 2)).toEqual(['`users`', '`order`']);
        expect(postgres.map((item) => item.insertText).slice(0, 2)).toEqual(['"users"', '"order"']);
        // `order` is a SQL Server keyword, so it must be bracketed; `users` must stay plain.
        expect(sqlServer.map((item) => item.insertText).slice(0, 2)).toEqual(['users', '[order]']);
        expect(mixedCaseSqlServer[0]!.insertText).toBe('Users');
        expect(msAccess.map((item) => item.insertText).slice(0, 2)).toEqual(['[users]', '[order]']);
    });

    it('offers nothing schema-shaped without a registered autocomplete context', async () => {
        const suggestions = await getCompletions('SELECT * FROM ', { dialect: 'mysql' });

        expect(labelsOfKind(suggestions, completionKinds.Class)).toEqual([]);
        expect(labelsOfKind(suggestions, completionKinds.Interface)).toEqual([]);
        expect(labelsOfKind(suggestions, completionKinds.Field)).toEqual([]);
        expect([...new Set(suggestions.map((item) => item.kind))]).toEqual([completionKinds.Keyword]);
        expect(labelsOfKind(suggestions, completionKinds.Keyword)).toContain('SELECT');
    });
});

describe('SQL column completions', () => {
    it('offers plain and qualified columns of the referenced table only', async () => {
        const suggestions = await getCompletions('SELECT * FROM users WHERE ', { dialect: 'mysql', schema });

        expect(labelsOfKind(suggestions, completionKinds.Field)).toEqual(['id', 'users.id', 'name', 'users.name']);

        const idItem = suggestions.find((item) => item.label === 'id')!;
        const qualifiedItem = suggestions.find((item) => item.label === 'users.id')!;

        expect(idItem.detail).toBe('column • users');
        expect(idItem.insertText).toBe('`id`');
        expect(qualifiedItem.insertText).toBe('`users`.`id`');
        expect(qualifiedItem.detail).toBe('qualified column');
    });

    it('resolves quoted table names before matching columns', async () => {
        const quotedSchema: SqlAutocompleteSchema = {
            tables: [{ name: 'my table', type: 'table' }],
            columns: [{ tableName: 'my table', columnName: 'label' }],
        };

        const suggestions = await getCompletions('SELECT * FROM `my table` WHERE ', { dialect: 'mysql', schema: quotedSchema });

        expect(labelsOfKind(suggestions, completionKinds.Field)).toEqual(['label', 'my table.label']);
        expect(suggestions.find((item) => item.label === 'label')!.insertText).toBe('`label`');
    });

    it('offers no columns while the caret sits in the table position', async () => {
        const suggestions = await getCompletions('SELECT * FROM ', { dialect: 'mysql', schema });

        expect(labelsOfKind(suggestions, completionKinds.Field)).toEqual([]);
    });

    it('maps a table alias qualifier back to the aliased table columns', async () => {
        const suggestions = await getCompletions('SELECT u.id FROM users u WHERE u.na', { dialect: 'mysql', schema });

        expect(labelsOfKind(suggestions, completionKinds.Field)).toEqual(['id', 'users.id', 'name', 'users.name']);
    });
});

describe('SQL keywords and snippets', () => {
    it('adds the MS Access keywords only for that dialect', async () => {
        const mysql = await getCompletions('SELECT * FROM ', { dialect: 'mysql', schema });
        const msAccess = await getCompletions('SELECT * FROM ', { dialect: 'msaccess', schema });

        expect(msAccess.find((item) => item.label === 'DISTINCTROW')?.kind).toBe(completionKinds.Keyword);
        expect(msAccess.find((item) => item.label === 'TOP')?.insertText).toBe('TOP');
        expect(mysql.some((item) => item.label === 'DISTINCTROW')).toBe(false);
    });

    it('adds the SQL Server keywords only for that dialect', async () => {
        const sqlServer = await getCompletions('SELECT * FROM ', { dialect: 'sqlserver', schema });
        const mysql = await getCompletions('SELECT * FROM ', { dialect: 'mysql', schema });

        expect(sqlServer.find((item) => item.label === 'NONCLUSTERED')?.kind).toBe(completionKinds.Keyword);
        expect(mysql.some((item) => item.label === 'NONCLUSTERED')).toBe(false);
    });

    it('offers snippets at the start of a statement and not in the middle', async () => {
        const atStart = await getCompletions('sel', { dialect: 'mysql', schema });
        const inTheMiddle = await getCompletions('SELECT * FROM users WHERE ', { dialect: 'mysql', schema });

        const snippetLabels = labelsOfKind(atStart, completionKinds.Snippet);

        expect(snippetLabels).toEqual(expect.arrayContaining(['select', 'insert', 'update', 'delete', 'create-table']));
        expect(atStart.find((item) => item.label === 'select')?.sortText).toBe('30000');
        expect(labelsOfKind(inTheMiddle, completionKinds.Snippet)).toEqual([]);
    });

    it('uses the dialect snippet set', async () => {
        const sqlServer = await getCompletions('sel', { dialect: 'sqlserver', schema });
        const msAccess = await getCompletions('sel', { dialect: 'msaccess', schema });

        expect(labelsOfKind(sqlServer, completionKinds.Snippet)).toEqual(['SELECT TOP', 'CTE Query', 'CREATE PROCEDURE', 'MERGE Statement']);
        expect(labelsOfKind(msAccess, completionKinds.Snippet)).toEqual(['SELECT TOP', 'SELECT DISTINCTROW', 'PARAMETERS Query']);
        expect(sqlServer.find((item) => item.label === 'CTE Query')?.insertTextRules).toBe(4);
    });

    it('replaces the typed word and keeps PostgreSQL snippet labels', async () => {
        const suggestions = await getCompletions('SELECT * FROM us', { dialect: 'postgresql', schema });
        const pgSnippets = await getCompletions('sel', { languageId: SQL_LANGUAGE_IDS.pgsql, dialect: 'postgresql', schema });

        expect(suggestions.find((item) => item.label === 'users')!.range).toEqual({
            startLineNumber: 1,
            endLineNumber: 1,
            startColumn: 15,
            endColumn: 17,
        });
        expect(labelsOfKind(pgSnippets, completionKinds.Snippet)).toEqual(expect.arrayContaining(['select', 'select-join']));
    });
});
