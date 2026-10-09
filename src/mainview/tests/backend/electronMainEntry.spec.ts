// The Electron main process talks to the backend over HTTP (backend.cjs); importing
// the backend app for real pulled typeorm/mysql2/pg into main.cjs (~2.5 MB) and
// configured the app DB a second time in that dead copy. Guard the type-only import.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(join(process.cwd(), 'src', 'electron', 'main.ts'), 'utf8');

describe('electron main entry', () => {
    it('imports the backend app as a type and leaves the app DB to the backend', () => {
        expect(mainSource).toContain("import type { app as backendApp } from '../backend/app.ts';");
        expect(mainSource).not.toContain("from '../backend/db-app.ts'");
        expect(mainSource).not.toContain('configureDatabase');
    });
});
