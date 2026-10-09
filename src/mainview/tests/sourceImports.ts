// Structural assertions about imports need a parser, not a substring search: a comment
// mentioning a module must not fail a bundling guard, and a differently formatted import
// must not pass one.
import { parse } from '@babel/parser';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type AstNode = { type: string } & Record<string, unknown>;

export type SourceImport = {
    /** Module specifier exactly as written in the source. */
    source: string;
    /** `import type` / `export type`: erased at build time, so it never pulls code in. */
    typeOnly: boolean;
    /** `import('...')` in an expression, which the bundler is free to split into its own chunk. */
    dynamic: boolean;
};

function walk(node: unknown, visit: (node: AstNode) => void) {
    if (!node || typeof node !== 'object') {
        return;
    }

    if (Array.isArray(node)) {
        node.forEach((child) => walk(child, visit));
        return;
    }

    const record = node as Record<string, unknown>;

    if (typeof record.type === 'string') {
        visit(record as AstNode);
    }

    Object.values(record).forEach((value) => walk(value, visit));
}

export function collectSourceImports(source: string, options: { jsx?: boolean } = {}): SourceImport[] {
    const imports: SourceImport[] = [];
    // `<T>(value: T) => …` is a type assertion in .ts but JSX in .tsx, so the plugins must match.
    const plugins: Array<'typescript' | 'jsx'> = options.jsx ? ['typescript', 'jsx'] : ['typescript'];

    walk(parse(source, { sourceType: 'module', plugins }), (node) => {
        if (node.type === 'ImportDeclaration') {
            const declaration = node as unknown as { importKind?: string; source: { value: string } };
            imports.push({ source: declaration.source.value, typeOnly: declaration.importKind === 'type', dynamic: false });
            return;
        }

        if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
            const declaration = node as unknown as { exportKind?: string; source: { value: string } };
            imports.push({ source: declaration.source.value, typeOnly: declaration.exportKind === 'type', dynamic: false });
            return;
        }

        // Babel 8 emits `ImportExpression`; older parsers use `CallExpression` with an `Import` callee.
        if (node.type === 'ImportExpression') {
            imports.push({ source: String((node.source as { value?: string } | undefined)?.value), typeOnly: false, dynamic: true });
            return;
        }

        if (node.type === 'CallExpression' && (node.callee as AstNode | undefined)?.type === 'Import') {
            const [specifier] = node.arguments as Array<{ value?: string }>;
            imports.push({ source: String(specifier?.value), typeOnly: false, dynamic: true });
        }
    });

    return imports;
}

export function readSourceImports(path: string) {
    return collectSourceImports(readFileSync(path, 'utf8'), { jsx: path.endsWith('.tsx') });
}

export function collectSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            return collectSourceFiles(path);
        }

        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}
