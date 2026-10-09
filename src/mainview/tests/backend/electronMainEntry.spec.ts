// The Electron main process talks to the backend over HTTP (backend.cjs); importing
// the backend app for real pulled typeorm/mysql2/pg into main.cjs (~2.5 MB) and
// configured the app DB a second time in that dead copy. Guard the type-only import.
// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSourceImports } from '../sourceImports';

const mainPath = join(process.cwd(), 'src', 'electron', 'main.ts');
const mainImports = readSourceImports(mainPath);

describe('electron main entry', () => {
    it('imports the backend app as a type', () => {
        const backendAppImports = mainImports.filter((entry) => entry.source.endsWith('/backend/app.ts'));

        expect(backendAppImports).toEqual([{ source: '../backend/app.ts', typeOnly: true, dynamic: false }]);
    });

    it('leaves the app DB to the backend process', () => {
        // `db-app.ts` owns configureDatabase; pulling it in (by any import form) is the regression.
        expect(mainImports.filter((entry) => /(?:^|\/)(?:db-app|useDatabase)\.ts$/.test(entry.source))).toEqual([]);
    });
});
