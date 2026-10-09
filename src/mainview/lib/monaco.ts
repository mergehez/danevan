// Generic Monaco setup: environment, theme, options and the language id for a
// path or SQL dialect. It must stay free of parser/grammar imports so the app
// entry chunk does not pull them in — the SQL language support lives in
// `monacoSqlLanguages.ts` and is imported dynamically by `configureMonaco`.

import type * as MonacoEditorModule from 'monaco-editor';
import type { DbType } from '../../shared/types';
import { fileIconAndLanguageByPath } from './utils';

let monacoConfigurationPromise: Promise<void> | undefined;
let monacoEnvironmentConfigured = false;
let monacoModulePromise: Promise<MonacoModule> | undefined = undefined;

type MonacoModule = typeof import('monaco-editor');

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

export type SqlAutocompleteContext = {
    dialect?: DbType;
    getSchema: () => Promise<SqlAutocompleteSchema>;
};

const sqlAutocompleteContexts = new Map<string, SqlAutocompleteContext>();
export const APP_MONACO_THEME = 'danevan-dark';

/** Language ids registered by `monacoSqlLanguages.ts`. */
export const SQL_LANGUAGE_IDS = {
    mysql: 'mysql',
    pgsql: 'pgsql',
} as const;
export type SqlLanguageId = (typeof SQL_LANGUAGE_IDS)[keyof typeof SQL_LANGUAGE_IDS];

export function getSqlAutocompleteContext(modelUri: string) {
    return sqlAutocompleteContexts.get(modelUri);
}

function getSqlLanguageId(dialect: DbType | undefined): SqlLanguageId {
    return dialect === 'postgresql' ? SQL_LANGUAGE_IDS.pgsql : SQL_LANGUAGE_IDS.mysql;
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

    Object.assign(globalThis, {
        MonacoEnvironment: {
            getWorker(_workerId: string, label: string) {
                const getWorkerModule = (moduleUrl: string, workerLabel: string) => new Worker(new URL(moduleUrl, import.meta.url), { name: workerLabel, type: 'module' });

                switch (label) {
                    case 'json':
                        return getWorkerModule('monaco-editor/esm/vs/language/json/json.worker', label);
                    case 'css':
                    case 'scss':
                    case 'less':
                        return getWorkerModule('monaco-editor/esm/vs/language/css/css.worker', label);
                    case 'html':
                    case 'handlebars':
                    case 'razor':
                        return getWorkerModule('monaco-editor/esm/vs/language/html/html.worker', label);
                    case 'typescript':
                    case 'javascript':
                        return getWorkerModule('monaco-editor/esm/vs/language/typescript/ts.worker', label);
                    default:
                        return getWorkerModule('monaco-editor/esm/vs/editor/editor.worker', label);
                }
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

/**
 * Configures Monaco and registers the SQL languages. Async because the SQL
 * grammars and parsers are a separate, lazily loaded chunk.
 */
export function configureMonaco(monaco: typeof MonacoEditorModule) {
    monacoConfigurationPromise ??= (async () => {
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

        if (monaco.typescript?.javascriptDefaults) {
            monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: true,
                noSyntaxValidation: false,
            });
            monaco.typescript.javascriptDefaults.setCompilerOptions({
                target: monaco.typescript.ScriptTarget.ES2015,
                allowNonTsExtensions: true,
            });
        }

        if (monaco.json?.jsonDefaults) {
            monaco.json.jsonDefaults.setDiagnosticsOptions({
                validate: true,
                allowComments: true,
                schemaValidation: 'error',
            });
        }

        const { configureSqlLanguageFeatures } = await import('./monacoSqlLanguages.ts');
        configureSqlLanguageFeatures(monaco);
    })().catch((error) => {
        // Let the next mount retry instead of caching a rejected configuration.
        monacoConfigurationPromise = undefined;
        throw error;
    });

    return monacoConfigurationPromise;
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
