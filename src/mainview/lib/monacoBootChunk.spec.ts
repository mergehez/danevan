// Monaco's SQL grammars and dt-sql-parser are several megabytes (and the grammar
// package statically imports monaco-editor). They must only be reachable from the
// dynamic import in `configureMonaco`, or they land in the app's entry chunk again.
// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readSourceImports } from '../tests/sourceImports';

const sourceRoot = join(process.cwd(), 'src');
const monacoPath = join(sourceRoot, 'mainview', 'lib', 'monaco.ts');
const monacoImports = readSourceImports(monacoPath);

describe('Monaco boot chunk', () => {
    it('loads the parser and grammar packages dynamically, never statically', () => {
        const heavyPackages = monacoImports.filter((entry) => !entry.dynamic && /^(dt-sql-parser|monaco-sql-languages)/.test(entry.source));

        expect(heavyPackages).toEqual([]);
        expect(monacoImports.filter((entry) => entry.dynamic).map((entry) => entry.source)).toContain('./monacoSqlLanguages.ts');
    });

    it('is the only module that imports the lazily loaded SQL languages', () => {
        const importers = collectSourceFiles(sourceRoot)
            .filter((path) => !path.endsWith('.spec.ts') && !path.endsWith('monacoSqlLanguages.ts'))
            .filter((path) => readSourceImports(path).some((entry) => entry.source.includes('monacoSqlLanguages')));

        expect(importers).toEqual([monacoPath]);
    });
});
