// import type { MonacoEditor } from '@guolao/vue-monaco-editor';
import { getDbDefaultExpressionFunctionNames } from '@lib/dbDefaultExpression';
import { fileIconAndLanguageByPath } from '@lib/utils';
import { DbType } from '@utils/appClient';
import { quoteSqlIdentifier, unquoteSqlIdentifier } from '@utils/sqlIdentifiers';
import { AttrName, type EntityContext } from 'dt-sql-parser/dist/parser/common/entityCollector';
import { EntityContextType, type CaretPosition, type Suggestions } from 'dt-sql-parser/dist/parser/common/types';
import { MySQL } from 'dt-sql-parser/dist/parser/mysql';
import { PostgreSQL } from 'dt-sql-parser/dist/parser/postgresql';
import type * as MonacoEditorModule from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { LanguageIdEnum } from 'monaco-sql-languages';
import { conf as mysqlConf, language as mysqlLanguage } from 'monaco-sql-languages/esm/languages/mysql/mysql';
import { conf as pgsqlConf, language as pgsqlLanguage } from 'monaco-sql-languages/esm/languages/pgsql/pgsql';
import type { CompletionSnippetOption } from 'monaco-sql-languages/esm/monaco.contribution';
import { mysqlSnippets, pgsqlSnippets } from 'monaco-sql-languages/esm/snippets';

let monacoConfigured = false;
let monacoEnvironmentConfigured = false;
let monacoModulePromise: Promise<MonacoModule> | undefined = undefined;

type MonacoModule = typeof import('monaco-editor');
type MonacoWorkerFactory = new () => Worker;
type SqlParser = MySQL | PostgreSQL;
export type MonacoDiagnosticMarker = {
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    source?: string;
};
export type SqlAutocompleteSchema = {
    tables: Array<{
        name: string;
        type: 'table' | 'view';
    }>;
    columns: Array<{
        tableName: string;
        columnName: string;
    }>;
};

type SqlAutocompleteContext = {
    dialect?: DbType;
    getSchema: () => Promise<SqlAutocompleteSchema>;
};

const sqlAutocompleteContexts = new Map<string, SqlAutocompleteContext>();
let sqlLanguageFeaturesConfigured = false;
export const APP_MONACO_THEME = 'danevan-dark';
const mysqlParser = new MySQL();
const postgreSqlParser = new PostgreSQL();
const msAccessKeywords = [
    'TOP',
    'DISTINCTROW',
    'PARAMETERS',
    'TRANSFORM',
    'PIVOT',
    'IIF',
    'NZ',
    'MID',
    'LEFT',
    'RIGHT',
    'LEN',
    'FORMAT',
    'SWITCH',
    'YESNO',
    'COUNTER',
    'LONGTEXT',
    'DATETIME',
    'CURRENCY',
    'MEMO',
    'OLEOBJECT',
];
const sqlServerKeywords = [
    'ADD',
    'ALTER',
    'AS',
    'BACKUP',
    'BEGIN',
    'BREAK',
    'BROWSE',
    'BULK',
    'BY',
    'CASE',
    'CHECK',
    'CLUSTERED',
    'COLUMN',
    'COMMIT',
    'CONSTRAINT',
    'CONTAINS',
    'CREATE',
    'CROSS',
    'CURRENT_TIMESTAMP',
    'DATABASE',
    'DBCC',
    'DECLARE',
    'DEFAULT',
    'DELETE',
    'DESC',
    'DISTINCT',
    'DROP',
    'ELSE',
    'END',
    'EXEC',
    'EXISTS',
    'FROM',
    'FULL',
    'FUNCTION',
    'GROUP',
    'HAVING',
    'IDENTITY',
    'INDEX',
    'INNER',
    'INSERT',
    'INTERSECT',
    'INTO',
    'JOIN',
    'KEY',
    'LEFT',
    'LIKE',
    'MERGE',
    'NONCLUSTERED',
    'NULL',
    'ON',
    'OR',
    'ORDER',
    'OUTER',
    'OVER',
    'PERCENT',
    'PRIMARY',
    'PROC',
    'PROCEDURE',
    'REFERENCES',
    'RETURN',
    'RIGHT',
    'ROLLBACK',
    'ROWCOUNT',
    'SELECT',
    'SET',
    'TABLE',
    'THEN',
    'TOP',
    'TRAN',
    'TRANSACTION',
    'TRIGGER',
    'TRUNCATE',
    'UNION',
    'UNIQUE',
    'UPDATE',
    'USE',
    'USER',
    'VALUES',
    'VIEW',
    'WHEN',
    'WHERE',
    'WITH',
];
const msAccessSnippets: CompletionSnippetOption[] = [
    {
        label: 'SELECT TOP',
        prefix: 'select top',
        body: ['SELECT TOP ${1:10} *', 'FROM ${2:[table_name]};'],
        description: 'MS Access SELECT TOP query',
    },
    {
        label: 'SELECT DISTINCTROW',
        prefix: 'select distinctrow',
        body: ['SELECT DISTINCTROW ${1:*}', 'FROM ${2:[table_name]};'],
        description: 'MS Access DISTINCTROW query',
    },
    {
        label: 'PARAMETERS Query',
        prefix: 'parameters',
        body: ['PARAMETERS ${1:paramName} ${2:Text};', 'SELECT *', 'FROM ${3:[table_name]}', 'WHERE ${4:[column_name]} = [${1:paramName}];'],
        description: 'MS Access parameterized query',
    },
];
const sqlServerSnippets: CompletionSnippetOption[] = [
    {
        label: 'SELECT TOP',
        prefix: 'select top',
        body: ['SELECT TOP (${1:100}) ${2:*}', 'FROM ${3:dbo.TableName}', 'ORDER BY ${4:Id} DESC;'],
        description: 'SQL Server SELECT TOP query',
    },
    {
        label: 'CTE Query',
        prefix: 'with cte',
        body: ['WITH ${1:cte_name} AS (', '    SELECT ${2:*}', '    FROM ${3:dbo.TableName}', ')', 'SELECT *', 'FROM ${1:cte_name};'],
        description: 'SQL Server common table expression',
    },
    {
        label: 'CREATE PROCEDURE',
        prefix: 'create procedure',
        body: ['CREATE PROCEDURE ${1:dbo.usp_name}', '    @${2:Id} INT', 'AS', 'BEGIN', '    SET NOCOUNT ON;', '', '    SELECT ${3:*}', '    FROM ${4:dbo.TableName};', 'END;'],
        description: 'SQL Server stored procedure template',
    },
    {
        label: 'MERGE Statement',
        prefix: 'merge',
        body: [
            'MERGE ${1:dbo.TargetTable} AS target',
            'USING ${2:dbo.SourceTable} AS source',
            'ON target.${3:Id} = source.${3:Id}',
            'WHEN MATCHED THEN',
            '    UPDATE SET ${4:target.Name} = source.${5:Name}',
            'WHEN NOT MATCHED THEN',
            '    INSERT (${6:Id}, ${7:Name})',
            '    VALUES (source.${6:Id}, source.${7:Name});',
        ],
        description: 'SQL Server MERGE template',
    },
];

function registerSqlLanguage(
    monaco: typeof MonacoEditorModule,
    languageId: LanguageIdEnum,
    aliases: string[],
    extensions: string[],
    configuration: MonacoEditorModule.languages.LanguageConfiguration,
    monarchLanguage: MonacoEditorModule.languages.IMonarchLanguage
) {
    if (!monaco.languages.getLanguages().some((language) => language.id === languageId)) {
        monaco.languages.register({
            id: languageId,
            aliases,
            extensions,
        });
    }

    monaco.languages.setLanguageConfiguration(languageId, configuration);
    monaco.languages.setMonarchTokensProvider(languageId, monarchLanguage);
}

function getSnippetCompletionItems(monaco: typeof MonacoEditorModule, snippets: CompletionSnippetOption[]) {
    return snippets.map((snippet, index) => ({
        label: snippet.label || snippet.prefix,
        kind: monaco.languages.CompletionItemKind.Snippet,
        filterText: snippet.prefix,
        insertText: typeof snippet.body === 'string' ? snippet.body : snippet.body.join('\n'),
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `3${index.toString().padStart(4, '0')}`,
        detail: snippet.description || 'SQL snippet',
        documentation: typeof snippet.body === 'string' ? snippet.body : snippet.body.join('\n'),
    }));
}

function getKeywordCompletionItems(monaco: typeof MonacoEditorModule, keywords: string[]) {
    return keywords.map((keyword, index) => ({
        label: keyword,
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: 'keyword',
        insertText: keyword,
        sortText: `2${index.toString().padStart(4, '0')}`,
    }));
}

function getSqlParser(languageId: LanguageIdEnum): SqlParser {
    return languageId === LanguageIdEnum.PG ? postgreSqlParser : mysqlParser;
}

function getSqlDialect(languageId: LanguageIdEnum): DbType {
    return languageId === LanguageIdEnum.PG ? 'postgresql' : 'mysql';
}

function getSqlAutocompleteDialect(languageId: LanguageIdEnum, context: SqlAutocompleteContext | undefined): DbType {
    if (context?.dialect) {
        return context.dialect;
    }

    return getSqlDialect(languageId);
}

function getCaretPosition(position: MonacoEditorModule.Position): CaretPosition {
    return {
        lineNumber: position.lineNumber,
        column: position.column,
    };
}

function getCurrentStatementEntities(entities: EntityContext[] | null | undefined) {
    return (entities || []).filter((entity) => entity.belongStmt.isContainCaret);
}

function getReferencedTableNames(entities: EntityContext[] | null | undefined) {
    const tableNames = new Set<string>();

    for (const entity of getCurrentStatementEntities(entities)) {
        if (entity.entityContextType !== EntityContextType.TABLE && entity.entityContextType !== EntityContextType.VIEW) {
            continue;
        }

        tableNames.add(entity.text);
        tableNames.add(unquoteSqlIdentifier(entity.text));
        const alias = entity[AttrName.alias]?.text;

        if (alias) {
            tableNames.add(alias);
            tableNames.add(unquoteSqlIdentifier(alias));
        }
    }

    return tableNames;
}

function getQualifierBeforeCursor(model: MonacoEditorModule.editor.ITextModel, position: MonacoEditorModule.Position) {
    const linePrefix = model.getLineContent(position.lineNumber).slice(0, Math.max(0, position.column - 1));
    const quotedQualifierMatch = /((?:\[(?:[^\]]|\]\])+\]|`(?:[^`]|``)+`|"(?:[^"]|"")+")|[A-Za-z_][\w$]*)\.[[`"A-Za-z_\w$]*$/i.exec(linePrefix);
    return quotedQualifierMatch?.[1] ? unquoteSqlIdentifier(quotedQualifierMatch[1]) : undefined;
}

function getActiveSyntaxTypes(suggestions: Suggestions | null | undefined) {
    return new Set((suggestions?.syntax || []).map((item) => item.syntaxContextType));
}

function getSchemaCompletionItems(
    monaco: typeof MonacoEditorModule,
    dialect: DbType,
    schema: SqlAutocompleteSchema,
    suggestions: Suggestions | null | undefined,
    entities: EntityContext[] | null | undefined,
    qualifier: string | undefined,
    reservedKeywords: Set<string>
) {
    const syntaxTypes = getActiveSyntaxTypes(suggestions);
    const wantsTables = Array.from(syntaxTypes).some(
        (type) => type === EntityContextType.TABLE || type === EntityContextType.TABLE_CREATE || type === EntityContextType.VIEW || type === EntityContextType.VIEW_CREATE
    );
    const wantsColumns = Array.from(syntaxTypes).some((type) => type === EntityContextType.COLUMN || type === EntityContextType.COLUMN_CREATE);
    const referencedTables = getReferencedTableNames(entities);
    const resolvedQualifier = qualifier && referencedTables.has(qualifier) ? qualifier : undefined;
    const filteredColumns = schema.columns.filter((column) => {
        if (resolvedQualifier) {
            return column.tableName === resolvedQualifier;
        }

        if (wantsColumns && referencedTables.size > 0) {
            return referencedTables.has(column.tableName);
        }

        return !wantsTables;
    });

    if (wantsTables) {
        return schema.tables.map((table, index) => ({
            label: table.name,
            kind: table.type === 'view' ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Class,
            detail: table.type,
            insertText: formatSchemaCompletionIdentifier(table.name, dialect, reservedKeywords),
            sortText: `0${index.toString().padStart(4, '0')}`,
        }));
    }

    if (!wantsColumns && !resolvedQualifier) {
        return [];
    }

    return filteredColumns.flatMap((column, index) => [
        {
            label: column.columnName,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `column • ${column.tableName}`,
            insertText: formatSchemaCompletionIdentifier(column.columnName, dialect, reservedKeywords),
            sortText: `1${index.toString().padStart(4, '0')}`,
        },
        {
            label: `${column.tableName}.${column.columnName}`,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: 'qualified column',
            insertText: `${formatSchemaCompletionIdentifier(column.tableName, dialect, reservedKeywords)}.${formatSchemaCompletionIdentifier(column.columnName, dialect, reservedKeywords)}`,
            sortText: `1q${index.toString().padStart(4, '0')}`,
        },
    ]);
}

function needsQuotedSqlServerCompletionPart(identifierPart: string, reservedKeywords: Set<string>) {
    const normalizedPart = unquoteSqlIdentifier(identifierPart);

    if (!/^[A-Za-z_][\w$]*$/u.test(normalizedPart)) {
        return true;
    }

    return reservedKeywords.has(normalizedPart.toUpperCase());
}

function formatSchemaCompletionIdentifier(identifier: string, dialect: DbType, reservedKeywords: Set<string>) {
    if (dialect !== 'sqlserver') {
        return quoteSqlIdentifier(identifier, dialect);
    }

    return identifier
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (needsQuotedSqlServerCompletionPart(part, reservedKeywords) ? quoteSqlIdentifier(unquoteSqlIdentifier(part), dialect) : unquoteSqlIdentifier(part)))
        .join('.');
}

function getSqlSnippets(languageId: LanguageIdEnum, dialect: DbType) {
    if (dialect === 'msaccess') {
        return msAccessSnippets;
    }

    if (dialect === 'sqlserver') {
        return sqlServerSnippets;
    }

    if (languageId === LanguageIdEnum.PG) {
        return pgsqlSnippets;
    }

    return mysqlSnippets;
}

function getSqlKeywords(parserKeywords: string[], dialect: DbType) {
    if (dialect === 'msaccess') {
        return [...new Set([...parserKeywords, ...msAccessKeywords])];
    }

    if (dialect === 'sqlserver') {
        return [...new Set([...parserKeywords, ...sqlServerKeywords])];
    }

    return parserKeywords;
}

function registerSqlCompletionProvider(monaco: typeof MonacoEditorModule, languageId: LanguageIdEnum) {
    return monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: [' ', '.', '_'],
        provideCompletionItems: async (model, position) => {
            const context = sqlAutocompleteContexts.get(model.uri.toString());
            const schema = context ? await context.getSchema() : { tables: [], columns: [] };
            const parser = getSqlParser(languageId);
            const dialect = getSqlAutocompleteDialect(languageId, context);
            const caretPosition = getCaretPosition(position);
            const parserSuggestions = parser.getSuggestionAtCaretPosition(model.getValue(), caretPosition);
            const entities = parser.getAllEntities(model.getValue(), caretPosition);
            const semanticContext = parser.getSemanticContextAtCaretPosition(model.getValue(), caretPosition);
            const qualifier = getQualifierBeforeCursor(model, position);
            const keywordList = getSqlKeywords(parserSuggestions?.keywords || [], dialect);
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const suggestions = [
                ...getSchemaCompletionItems(monaco, dialect, schema, parserSuggestions, entities, qualifier, new Set(keywordList.map((keyword) => keyword.toUpperCase()))),
                ...getKeywordCompletionItems(monaco, keywordList),
                ...(semanticContext?.isStatementBeginning ? getSnippetCompletionItems(monaco, getSqlSnippets(languageId, dialect)) : []),
            ].map((item) => ({
                ...item,
                range,
            }));

            return { suggestions };
        },
    });
}

function configureSqlLanguageFeatures(monaco: typeof MonacoEditorModule) {
    if (sqlLanguageFeaturesConfigured) {
        return;
    }

    sqlLanguageFeaturesConfigured = true;

    registerSqlLanguage(monaco, LanguageIdEnum.MYSQL, ['MySQL', 'mysql'], ['.mysql'], mysqlConf, mysqlLanguage);
    registerSqlLanguage(monaco, LanguageIdEnum.PG, ['PgSQL', 'postgresql', 'PostgreSQL'], ['.pgsql'], pgsqlConf, pgsqlLanguage);

    registerSqlCompletionProvider(monaco, LanguageIdEnum.MYSQL);
    registerSqlCompletionProvider(monaco, LanguageIdEnum.PG);
}

function getSqlLanguageId(dialect: DbType | undefined) {
    if (dialect === 'postgresql') {
        return LanguageIdEnum.PG;
    }

    return LanguageIdEnum.MYSQL;
}

function stripTrailingSemicolon(sql: string) {
    return sql.replace(/;\s*$/u, '');
}

function findMatchingClosingParen(sql: string, openParenIndex: number) {
    let depth = 0;
    let quote: string | undefined;

    for (let index = openParenIndex; index < sql.length; index += 1) {
        const char = sql[index];
        const nextChar = sql[index + 1];

        if (quote) {
            if (char === quote) {
                if ((quote === "'" || quote === '"' || quote === '`') && nextChar === quote) {
                    index += 1;
                    continue;
                }

                quote = undefined;
            }

            continue;
        }

        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            continue;
        }

        if (char === '(') {
            depth += 1;
            continue;
        }

        if (char !== ')') {
            continue;
        }

        depth -= 1;

        if (depth === 0) {
            return index;
        }
    }

    return -1;
}

function padReplacement(width: number, replacement: string) {
    return replacement.length >= width ? replacement.slice(0, width) : `${replacement}${' '.repeat(width - replacement.length)}`;
}

function sanitizeKnownDefaultFunctions(sql: string, dialect: DbType | undefined) {
    const knownFunctions = new Set(getDbDefaultExpressionFunctionNames(dialect));

    if (knownFunctions.size === 0) {
        return sql;
    }

    const matches = [...sql.matchAll(/\bDEFAULT\s+([A-Za-z_][\w$]*)\s*\(/giu)];

    if (matches.length === 0) {
        return sql;
    }

    let sanitizedSql = sql;

    for (const match of matches.reverse()) {
        const functionName = match[1]?.toLowerCase();
        const fullMatch = match[0];
        const matchIndex = match.index;

        if (!functionName || matchIndex === undefined || !knownFunctions.has(functionName)) {
            continue;
        }

        const functionNameIndex = matchIndex + fullMatch.lastIndexOf(match[1]);
        const openParenIndex = matchIndex + fullMatch.length - 1;
        const closeParenIndex = findMatchingClosingParen(sanitizedSql, openParenIndex);

        if (closeParenIndex < 0) {
            continue;
        }

        sanitizedSql = `${sanitizedSql.slice(0, functionNameIndex)}${padReplacement(closeParenIndex + 1 - functionNameIndex, '0')}${sanitizedSql.slice(closeParenIndex + 1)}`;
    }

    return sanitizedSql;
}

function normalizeSqlForDiagnostics(sql: string, dialect: DbType | undefined) {
    return sanitizeKnownDefaultFunctions(stripTrailingSemicolon(sql), dialect);
}

export function getSqlDiagnosticMarkers(sql: string, dialect: DbType | undefined): MonacoDiagnosticMarker[] {
    if (!sql.trim()) {
        return [];
    }

    return getSqlParser(getSqlLanguageId(dialect))
        .validate(normalizeSqlForDiagnostics(sql, dialect))
        .map((error) => ({
            message: error.message,
            severity: 'error',
            startLineNumber: Math.max(1, error.startLine),
            startColumn: Math.max(1, error.startColumn),
            endLineNumber: Math.max(1, error.endLine),
            endColumn: Math.max(error.endColumn, error.startColumn + 1),
            source: 'sql',
        }));
}

export function registerSqlAutocompleteContext(modelUri: string, context: SqlAutocompleteContext | undefined) {
    if (!context) {
        sqlAutocompleteContexts.delete(modelUri);
        return () => undefined;
    }

    sqlAutocompleteContexts.set(modelUri, context);

    return () => {
        if (sqlAutocompleteContexts.get(modelUri) === context) {
            sqlAutocompleteContexts.delete(modelUri);
        }
    };
}

export function configureMonacoEnvironment() {
    if (monacoEnvironmentConfigured || typeof globalThis === 'undefined') {
        return;
    }

    const workerFactories: Record<string, MonacoWorkerFactory> = {
        json: jsonWorker,
        css: cssWorker,
        scss: cssWorker,
        less: cssWorker,
        html: htmlWorker,
        handlebars: htmlWorker,
        razor: htmlWorker,
        typescript: tsWorker,
        javascript: tsWorker,
    };

    Object.assign(globalThis, {
        MonacoEnvironment: {
            getWorker(_workerId: string, label: string) {
                const WorkerFactory = workerFactories[label] ?? editorWorker;

                return new WorkerFactory();
            },
        },
    });

    monacoEnvironmentConfigured = true;
}

export async function getMonacoModule() {
    configureMonacoEnvironment();

    if (!monacoModulePromise) {
        monacoModulePromise = import('monaco-editor');
    }

    return await monacoModulePromise;
}

// monaco: MonacoEditor | MonacoModule
export function configureMonaco(monaco: typeof MonacoEditorModule) {
    if (monacoConfigured) {
        return;
    }

    monacoConfigured = true;

    monaco.editor.defineTheme(APP_MONACO_THEME, {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#151f27',
            'editorWarning.foreground': '#ffae0024',
            'editorError.foreground': 'red',
        },
    });

    monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
    });
    monaco.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.typescript.ScriptTarget.ES2015,
        allowNonTsExtensions: true,
    });

    monaco.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemaValidation: 'error',
    });

    configureSqlLanguageFeatures(monaco);
}

export function getMonacoLanguage(language: string | undefined, pathForLanguage: string | undefined, sqlDialect?: DbType) {
    if (language === 'sql') {
        return getSqlLanguageId(sqlDialect);
    }

    if (!pathForLanguage) {
        return language ?? 'plaintext';
    }

    return fileIconAndLanguageByPath(pathForLanguage.toLowerCase()).lang;
}

export function createMonacoOptions(params: { readonly?: boolean; fontSize?: number }): MonacoEditorModule.editor.IStandaloneEditorConstructionOptions {
    return {
        automaticLayout: true,
        formatOnType: true,
        formatOnPaste: true,
        readOnly: params.readonly ?? false,
        renderValidationDecorations: 'on',
        fontSize: params.fontSize ?? 12,
        codeLens: false,
        minimap: {
            enabled: false,
        },
        glyphMargin: false,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbersMinChars: 3,
        showFoldingControls: 'always',
        fixedOverflowWidgets: true,
    };
}
