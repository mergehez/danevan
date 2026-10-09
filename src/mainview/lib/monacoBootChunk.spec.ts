// Monaco's SQL grammars and dt-sql-parser are several megabytes (and the grammar
// package statically imports monaco-editor). They must only be reachable from the
// dynamic import in `configureMonaco`, or they land in the app's entry chunk again.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const monacoPath = join(sourceRoot, 'mainview', 'lib', 'monaco.ts');
const monacoSource = readFileSync(monacoPath, 'utf8');

function collectSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            return collectSourceFiles(path);
        }

        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

describe('Monaco boot chunk', () => {
    it('keeps the parser and grammar packages out of static imports', () => {
        expect(monacoSource).not.toMatch(/^import\s[^\n]*from 'dt-sql-parser/m);
        expect(monacoSource).not.toMatch(/^import\s[^\n]*from 'monaco-sql-languages/m);
        expect(monacoSource).toContain("await import('./monacoSqlLanguages.ts')");
    });

    it('is the only module that references the lazily loaded SQL languages', () => {
        const importers = collectSourceFiles(sourceRoot)
            .filter((path) => !path.endsWith('.spec.ts') && !path.endsWith('monacoSqlLanguages.ts'))
            .filter((path) => readFileSync(path, 'utf8').includes('monacoSqlLanguages'));

        expect(importers).toEqual([monacoPath]);
    });
});
