// @vitest-environment node
// The MS Access path only works if the Java bridge really compiles, really starts and really talks
// to a .mdb. Everything else about it (protocol frames, runtime discovery, DDL planning) is covered
// by unit specs; this is the only one that spawns the JVM.
//
// It needs three things that must be present rather than skipped: the fixture, the runtime jars and
// a JDK 11+. Set DANEVAN_MSACCESS_RUNTIME_DIR to a runtime whose `lib` holds every artifact (the app
// caches one under its data directory after the first Access use) to avoid downloading them.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useAppDb } from '../../../backend/db-app.ts';
import { dbTools } from '../../../backend/db-tools.ts';
import { MS_ACCESS_RUNTIME_LIB_FOLDER_NAME, getMsAccessRuntimeJarName, msAccessRuntimeArtifacts } from '../../../backend/msAccessRuntimeManifest.ts';
import { normalizeMsAccessColumnType } from '../../../backend/useMsAccessDriver.ts';
import { getDbColumnDataTypeOptions } from '../../lib/dbColumnDataType.ts';

const ACCESS_FIXTURE = resolve(process.cwd(), 'assets/test-access-db.mdb');
const CACHED_RUNTIME_DIR = join(homedir(), 'Library', 'Application Support', 'danevan', 'msaccess-runtime');

function hasEveryJar(runtimeDir: string) {
    const libDir = join(runtimeDir, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);
    return existsSync(libDir) && msAccessRuntimeArtifacts.every((artifact) => existsSync(join(libDir, getMsAccessRuntimeJarName(artifact))));
}

let tempDir = '';
let connectionId = 0;

/** The runtime the bridge compiles into, and the jars it loads, must exist before this spec runs. */
function requireBridgeRuntime() {
    if (!existsSync(ACCESS_FIXTURE)) {
        throw new Error(`The MS Access fixture is missing: ${ACCESS_FIXTURE}`);
    }

    const candidates = [process.env.DANEVAN_MSACCESS_RUNTIME_DIR, CACHED_RUNTIME_DIR].filter((value): value is string => Boolean(value));
    const runtimeDir = candidates.find(hasEveryJar);

    if (!runtimeDir) {
        throw new Error(
            [
                'No MS Access runtime jars are available, so the Java bridge cannot be tested.',
                `Looked in: ${candidates.join(', ')}.`,
                'Open the app once with an Access source (it downloads and caches them), or set DANEVAN_MSACCESS_RUNTIME_DIR.',
            ].join('\n')
        );
    }

    process.env.DANEVAN_MSACCESS_RUNTIME_DIR = runtimeDir;
}

beforeAll(() => {
    requireBridgeRuntime();

    tempDir = mkdtempSync(join(tmpdir(), 'danevan-msaccess-bridge-'));
    const databasePath = join(tempDir, 'bridge.mdb');
    copyFileSync(ACCESS_FIXTURE, databasePath);

    // The app database is what dbTools resolves connections from; it points at the temp copy.
    const appDb = useAppDb();
    appDb.configureDatabase(tempDir);

    const serverId = appDb.createServer({
        name: 'msaccess-bridge-spec',
        kind: 'file',
        driver: 'msaccess',
        filePath: databasePath,
        host: undefined,
        port: undefined,
        username: undefined,
    });
    connectionId = appDb.createConnection({
        serverId,
        name: 'msaccess-bridge-spec',
        host: undefined,
        port: undefined,
        databaseName: undefined,
        readonly: undefined,
    });
});

afterAll(async () => {
    if (connectionId) {
        await dbTools.disconnectConnection(connectionId);
    }

    rmSync(tempDir, { recursive: true, force: true });
});

describe('the MS Access Java bridge', () => {
    it('creates a table, reads its metadata and its rows back', async () => {
        const tableName = 'e2e_bridge_probe';

        // The Access spellings the column editor offers, straight through the bridge.
        await dbTools.runQuery(connectionId, `CREATE TABLE [${tableName}] ([id] COUNTER PRIMARY KEY, [label] TEXT(255), [note] MEMO, [amount] CURRENCY, [made_at] DATETIME)`);
        await dbTools.runQuery(connectionId, `INSERT INTO [${tableName}] ([label], [note]) VALUES ('bridge probe', 'a memo')`);

        // The table list is the bridge's own metadata, not a catalog guess.
        const tables = await dbTools.getTablesFresh(connectionId);
        const probe = tables.find((table) => table.name === tableName);

        expect(probe).toMatchObject({ name: tableName, type: 'table', rowCount: 1 });

        // Access type mapping survives the round trip.
        const tableInfo = await dbTools.getTableInfoFresh(connectionId, tableName);
        const typesByName = Object.fromEntries(tableInfo.columns.map((column) => [column.name, column.type]));

        // UCanAccess accepts the Access names in DDL and reports HSQLDB's own names back.
        // CURRENCY answers as DECIMAL(8,4) or DECIMAL(100,4) depending on which metadata path
        // replies, so only its shape is stable (recorded as a finding in TESTS-AUDIT.md).
        expect(typesByName).toEqual({
            id: 'AUTOINCREMENT',
            label: 'VARCHAR(255)',
            note: 'VARCHAR(16777216)',
            amount: expect.stringMatching(/^DECIMAL\(\d+,4\)$/),
            made_at: 'TIMESTAMP',
        });
        expect(tableInfo.columns.find((column) => column.name === 'id')).toMatchObject({ isPrimaryKey: true, isAutoIncrement: true });

        // And the values come back through the worker's result transport.
        const result = await dbTools.runQuery(connectionId, `SELECT TOP 5 [id], [label], [note] FROM [${tableName}]`);

        expect(result.kind).toBe('rows');
        expect(result.kind === 'rows' ? result.columns : []).toEqual(['id', 'label', 'note']);
        expect(result.kind === 'rows' ? result.rows : []).toEqual([{ id: 1, label: 'bridge probe', note: 'a memo' }]);
    }, 10_000);
});

// The column editor offers these, so the bridge has to be able to create them. UCanAccess refuses
// eight Access spellings; the list dropped them and the driver maps them for older drafts.
describe('the Access column types', () => {
    it('creates every type the column editor offers', async () => {
        const offered = getDbColumnDataTypeOptions('msaccess').map((option) => option.value);
        const rejected: Array<{ type: string; message: string }> = [];

        for (const [index, type] of offered.entries()) {
            try {
                await dbTools.runQuery(connectionId, `CREATE TABLE [e2e_type_${index}] ([c] ${type})`);
            } catch (error) {
                rejected.push({ type, message: (error as Error).message });
            }
        }

        expect(rejected).toEqual([]);
        expect(offered).toContain('CURRENCY');
    }, 10_000);

    it('creates the types it maps for older drafts', async () => {
        const legacyTypes = ['LONGCHAR', 'NTEXT', 'MONEY', 'SMALLDATETIME', 'LONGBINARY', 'IMAGE', 'OLEOBJECT', 'UNIQUEIDENTIFIER'];
        const rejected: Array<{ type: string; mapped: string; message: string }> = [];

        for (const [index, type] of legacyTypes.entries()) {
            const mapped = normalizeMsAccessColumnType(type);

            try {
                await dbTools.runQuery(connectionId, `CREATE TABLE [e2e_mapped_${index}] ([c] ${mapped})`);
            } catch (error) {
                rejected.push({ type, mapped, message: (error as Error).message });
            }
        }

        expect(rejected).toEqual([]);
    }, 10_000);
});

// A runtime whose `lib` is missing jars would silently fall back to downloading them mid-test.
describe('the runtime this spec uses', () => {
    it('holds every artifact the manifest lists', () => {
        const libDir = join(process.env.DANEVAN_MSACCESS_RUNTIME_DIR!, MS_ACCESS_RUNTIME_LIB_FOLDER_NAME);

        expect(msAccessRuntimeArtifacts.map((artifact) => getMsAccessRuntimeJarName(artifact)).filter((jar) => !readdirSync(libDir).includes(jar))).toEqual([]);
    });
});
