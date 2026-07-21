import {
    ApplyTableChangesResult,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlValue,
    TableData,
    TableForeignKeyInfo,
    TableIndexInfo,
    TableInfo,
    TableSummary,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '@shared/utils/appClient.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DriverTools, NormalizedApplyTableChanges, type SortOrder } from './db-tools.ts';
import { MsAccessServerRecord, type MsAccessConnectionRecord } from './useMsAccessDriver.ts';
import { ModifySchemaPlan } from './useSqliteDriver.ts';

type MsAccessWindowsDriverToolsDeps = {
    getConnection: (connectionId: number) => MsAccessConnectionRecord | undefined;
    getServer: (serverId: number) => MsAccessServerRecord | undefined;
    listConnections: (serverId: number) => MsAccessConnectionRecord[];
    getUserDataDir: () => string;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
};

// function getMsAccessDatabasePath(deps: MsAccessWindowsDriverToolsDeps, connectionId: number) {
//     const connection = deps.getConnection(connectionId);
//     if (!connection) throw new Error('The selected connection could not be found.');
//     const server = deps.getServer(connection.server_id);
//     if (!server) throw new Error('The selected server could not be found.');
//     if (server.driver !== 'msaccess') throw new Error(`The '${server.driver}' driver is not implemented here.`);
//     if (server.kind !== 'file') throw new Error('MS Access connections must use a file-based source.');

//     const filePath = server.file_path?.trim();
//     if (!filePath) throw new Error('The selected MS Access source is missing its file path.');
//     if (!existsSync(filePath)) throw new Error(`The MS Access file does not exist: ${filePath}`);

//     return filePath;
// }

/**
 * Execute queries natively via PowerShell using the .NET System.Data.OleDb Managed Provider.
 * This completely bypasses the Click-to-Run COM virtualization bugs that break traditional
 * scripting hosts like cscript.exe (node-adodb).
 */

const PS_LOG_DIR = 'Z:\\danevan\\ps-logs';
let scriptCounter = 0;

function logPsScript(script: string, label: string) {
    try {
        mkdirSync(PS_LOG_DIR, { recursive: true });
        const name = `${String(++scriptCounter).padStart(3, '0')}-${label}.ps1`;
        writeFileSync(`${PS_LOG_DIR}\\${name}`, script, 'utf8');
    } catch {}
}

let cachedProvider: string | null = null;
let cachedPsPath: string | null = null;
let providerPromise: Promise<void> | null = null;

function getDefaultPsPaths(windir: string | undefined): string[] {
    const paths: string[] = [];
    const native = windir ? `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x64 = windir ? `${windir}\\SysArm32\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x86 = windir ? `${windir}\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe` : null;
    const x64Cmd = windir ? `${windir}\\SysArm32\\cmd.exe` : null; // x64 cmd → launches x64 powershell
    if (native && existsSync(native)) paths.push(native);
    if (x64 && existsSync(x64)) paths.push(x64);
    if (x86 && existsSync(x86)) paths.push(x86);
    if (x64Cmd && existsSync(x64Cmd)) paths.push(`CMD_WRAPPER:${x64Cmd}`); // special prefix
    paths.push('powershell.exe');
    return paths;
}

/** Spawns a PowerShell script. Tries all known paths + PATH fallback. */
function spawnPowerShell(script: string, psPaths: string[]): Promise<any[]> {
    const tmpDir = `${tmpdir()}\\danevan-ps-${Date.now()}`;
    const scriptPath = `${tmpDir}\\script.ps1`;
    const resultPath = `${tmpDir}\\result.json`;

    // Replace stdout WriteLine with file output — avoids all stdout/stderr reliability issues
    const fileScript = script
        .replaceAll('[System.Console]::WriteLine($json)', `$json | Out-File -Encoding UTF8 '${resultPath.replace(/'/g, "''")}'`)
        .replaceAll('[System.Console]::WriteLine($errObjJson)', `$errObjJson | Out-File -Encoding UTF8 '${resultPath.replace(/'/g, "''")}'`)
        .replaceAll('[System.Console]::WriteLine($outputJson)', `$outputJson | Out-File -Encoding UTF8 '${resultPath.replace(/'/g, "''")}'`)
        .replaceAll(
            '[System.Console]::WriteLine($output | ConvertTo-Json -Depth 5)',
            `($output | ConvertTo-Json -Depth 5) | Out-File -Encoding UTF8 '${resultPath.replace(/'/g, "''")}'`
        );

    try {
        mkdirSync(tmpDir, { recursive: true });
        writeFileSync(scriptPath, fileScript, 'utf8');
    } catch {}

    const errors: Error[] = [];

    function cleanup() {
        for (const p of [scriptPath, resultPath, tmpDir]) {
            try {
                writeFileSync(p, '');
            } catch {}
            try {
                unlinkSync(p);
            } catch {}
        }
    }

    function tryOne(psPath: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const isCmdWrapper = psPath.startsWith('CMD_WRAPPER:');
            const exePath = isCmdWrapper ? psPath.slice('CMD_WRAPPER:'.length) : psPath;
            const args = isCmdWrapper
                ? ['/c', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
                : ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
            const ps = spawn(exePath, args);
            let stderr = '';
            ps.stderr.on('data', (d) => (stderr += d.toString()));
            ps.on('close', (code) => {
                // Read result from file instead of stdout
                let content = '';
                try {
                    content = readFileSync(resultPath, 'utf8');
                } catch {}
                cleanup();
                if (!content) {
                    if (stderr.includes('progress') || stderr.includes('CLIXML')) return reject(new Error('__TRANSIENT__'));
                    return reject(new Error(`PowerShell exited with code ${code}: ${stderr || '(no output)'}`));
                }
                try {
                    const result = JSON.parse(content.trim());
                    if (result.success) resolve(result.data || []);
                    else reject(new Error(result.error));
                } catch (e) {
                    reject(new Error(`Failed to parse result. Content: ${content.slice(0, 200)}`));
                }
            });
        });
    }

    async function tryAll(): Promise<any[]> {
        for (const psPath of psPaths) {
            try {
                return await tryOne(psPath);
            } catch (err: any) {
                if (err.message === '__TRANSIENT__') {
                    try {
                        return await tryOne(psPath);
                    } catch (e2: any) {
                        errors.push(e2);
                    }
                } else {
                    errors.push(err);
                }
            }
        }
        throw new Error(`All PowerShell paths failed. Last error: ${errors[errors.length - 1]?.message}`);
    }

    return tryAll();
}

/**
 * Probes for a working OLEDB provider once and caches it.
 * This is a self-contained PowerShell script — does NOT use psConnectPreamble
 * because that hardcodes the cached provider (circular dependency).
 */
async function ensureProvider(dbPath: string): Promise<void> {
    if (cachedProvider) return;
    if (providerPromise) return providerPromise;

    const dbEscaped = dbPath.replace(/'/g, "''");

    const probeScript = `
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"
$DbPath = '${dbEscaped}'
$candidates = @("Microsoft.ACE.OLEDB.16.0", "Microsoft.ACE.OLEDB.12.0")
$result = @{ tried = @() }
foreach ($candidate in $candidates) {
    try {
        $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=$candidate;Data Source=$DbPath;Persist Security Info=False;")
        $conn.Open()
        $conn.Close()
        $result.provider = $candidate
        break
    } catch {
        $result.tried += @{ provider = $candidate; error = $_.Exception.Message }
        if ($conn) { $conn.Dispose(); $conn = $null }
    }
}
if (-not $result.provider) { throw "No working Access OLEDB provider. Tried: $($result.tried | ConvertTo-Json -Depth 5 -Compress)" }
$output = @{ success = $true; data = $result }
$outputJson = $output | ConvertTo-Json -Depth 5
[System.Console]::WriteLine($outputJson)
`;

    logPsScript(probeScript, 'probe');

    const psPaths = getDefaultPsPaths(process.env.windir);

    async function tryAllPaths(): Promise<any> {
        for (const psPath of psPaths) {
            try {
                const data = await spawnPowerShell(probeScript, [psPath]);
                const result = Array.isArray(data) ? data[0] : data;
                if (result?.provider) {
                    cachedPsPath = psPath;
                    console.log(`[ps-probe] ${psPath} → ${result.provider}`);
                    return result;
                }
            } catch (err) {
                console.log(`[ps-probe] ${psPath} failed:`, String(err));
            }
        }
        return null;
    }

    providerPromise = tryAllPaths()
        .then((data) => {
            if (!data) throw new Error('No working Access OLEDB provider found.');
            console.log('[ps-probe] Result:', JSON.stringify(data));
            cachedProvider = typeof data === 'object' && !Array.isArray(data) ? data.provider || null : null;
            if (!cachedProvider) throw new Error('No working Access OLEDB provider found.');
        })
        .finally(() => {
            providerPromise = null;
        });

    return providerPromise;
}

/** Shared preamble: connects to the database using the cached OLEDB provider */
function psConnectPreamble(dbPath: string): string {
    const provider = cachedProvider || 'Microsoft.ACE.OLEDB.16.0';
    const escaped = dbPath.replace(/'/g, "''");
    return `
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"
$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=${provider};Data Source=${escaped};Persist Security Info=False;")
$conn.Open()`;
}

/** Shared footer: wraps result in JSON and closes connection */
const psOutputFooter = `
$conn.Close()
$output = @{ success = $true; data = $result }
$json = $output | ConvertTo-Json -Depth 10
[System.Console]::WriteLine($json)
`;

/** Shared error handler */
const psErrorFooter = `catch {
    $errObj = @{ success = $false; error = $_.Exception.Message }
    $errObjJson = $errObj | ConvertTo-Json -Depth 5
    [System.Console]::WriteLine($errObjJson)
}`;

/**
 * Runs a PowerShell script body (which has access to $conn) and returns parsed JSON data.
 * Handles provider probing, bitness fallback, and JSON parsing.
 */
async function runPowerShellScript(dbPath: string, scriptBody: string): Promise<any[]> {
    await ensureProvider(dbPath);
    return runPowerShellRaw(dbPath, scriptBody);
}

/** Runs a PowerShell script (without provider probing — assumes ensureProvider was already called) */
function runPowerShellRaw(dbPath: string, scriptBody: string): Promise<any[]> {
    const fullScript = `
try {
${psConnectPreamble(dbPath)}
${scriptBody}
${psOutputFooter}
} ${psErrorFooter}`;

    logPsScript(fullScript, 'query');

    // Use cached PowerShell path from probe, or try all paths
    const psPaths = cachedPsPath ? [cachedPsPath] : getDefaultPsPaths(process.env.windir);
    return spawnPowerShell(fullScript, psPaths);
}

function executePowerShellOleDb(filePath: string, queries: string[] = []): Promise<any[]> {
    const queriesJson = JSON.stringify(queries).replace(/'/g, "''");

    const scriptBody = `
    $QueriesJson = '${queriesJson}'
    $queries = $QueriesJson | ConvertFrom-Json
    $results = @()
    if ($null -ne $queries -and $queries.Length -gt 0) {
        foreach ($q in $queries) {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = $q
            if ($q.Trim().ToUpper().StartsWith("SELECT")) {
                $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
                $dt = New-Object System.Data.DataTable
                $adapter.Fill($dt) | Out-Null
                $rows = @()
                foreach ($row in $dt.Rows) {
                    $obj = New-Object PSObject
                    foreach ($col in $dt.Columns) {
                        $val = $row[$col.ColumnName]
                        if ($val -is [System.DBNull]) { $val = $null }
                        $obj | Add-Member -MemberType NoteProperty -Name $col.ColumnName -Value $val
                    }
                    $rows += $obj
                }
                $results += ,$rows
            } else {
                $affected = $cmd.ExecuteNonQuery()
                $results += @{ affectedRows = $affected }
            }
        }
    }
    $result = $results
  `;

    return runPowerShellScript(filePath, scriptBody);
}

function quoteMsAccessName(name: string): string {
    return `[${name.replaceAll(']', ']]')}]`;
}

/**
 * Execute OleDb schema introspection via PowerShell.
 * mode: "tables" | "columns" | "indexes" | "foreign-keys"
 */
function executePowerShellOleDbSchema(filePath: string, mode: 'tables' | 'columns' | 'indexes' | 'foreign-keys', tableName?: string): Promise<any[]> {
    const escTable = (tableName ?? '').replace(/'/g, "''");

    const schemas: Record<string, { guid: string; mapper: string; restrictions: string }> = {
        tables: {
            guid: '[System.Data.OleDb.OleDbSchemaGuid]::Tables',
            restrictions: '[System.Array]::CreateInstance([object], 4)',
            mapper: `
        foreach ($row in $schemaTable.Rows) {
            $type = $row["TABLE_TYPE"]
            if ($type -eq "TABLE" -or $type -eq "VIEW") {
                $result += @{ name = [string]$row["TABLE_NAME"]; type = if ($type -eq "VIEW") { "view" } else { "table" } }
            }
        }`,
        },
        columns: {
            guid: '[System.Data.OleDb.OleDbSchemaGuid]::Columns',
            restrictions: tableName?.trim() ? `$r = [System.Array]::CreateInstance([object], 4); $r[2] = '${escTable}'; $r` : '[System.Array]::CreateInstance([object], 4)',
            mapper: `
        foreach ($row in $schemaTable.Rows) {
            $result += @{ name = [string]$row["COLUMN_NAME"]; type = [string]$row["DATA_TYPE"]; isNullable = ($row["IS_NULLABLE"] -eq $true) }
        }`,
        },
        indexes: {
            guid: '[System.Data.OleDb.OleDbSchemaGuid]::Indexes',
            restrictions: '$null', // MS Access doesn't support restrictions on Indexes
            mapper: `
        foreach ($row in $schemaTable.Rows) {
            $result += @{ indexName = [string]$row["INDEX_NAME"]; columnName = [string]$row["COLUMN_NAME"]; primaryKey = ($row["PRIMARY_KEY"] -eq $true); unique = ($row["UNIQUE"] -eq $true) }
        }`,
        },
        'foreign-keys': {
            guid: '[System.Data.OleDb.OleDbSchemaGuid]::Foreign_Keys',
            restrictions: '$null', // MS Access doesn't support restrictions on Foreign_Keys
            mapper: `
        foreach ($row in $schemaTable.Rows) {
            $result += @{ fkName = [string]$row["FK_NAME"]; pkTable = [string]$row["PK_TABLE_NAME"]; fkColumn = [string]$row["FK_COLUMN_NAME"]; pkColumn = [string]$row["PK_COLUMN_NAME"] }
        }`,
        },
    };

    const s = schemas[mode];
    const restrictions = tableName?.trim()
        ? `$restrictions = ${s.restrictions}; $schemaTable = $conn.GetOleDbSchemaTable(${s.guid}, $restrictions)`
        : `$schemaTable = $conn.GetOleDbSchemaTable(${s.guid}, ${s.restrictions})`;

    const scriptBody = `
    $result = @()
    ${restrictions}
    ${s.mapper}
    $result = $result
  `;

    return runPowerShellScript(filePath, scriptBody);
}

function mapOleDbDataType(dataType: number): string {
    // Map ADO data types to SQL type names
    const typeMap: Record<number, string> = {
        2: 'SMALLINT',
        3: 'INTEGER',
        4: 'REAL',
        5: 'FLOAT',
        6: 'MONEY',
        7: 'DATETIME',
        11: 'BIT',
        14: 'DECIMAL',
        16: 'TINYINT',
        17: 'BYTE',
        20: 'BIGINT',
        72: 'GUID',
        128: 'BINARY',
        129: 'CHAR',
        130: 'NCHAR',
        131: 'NTEXT',
        132: 'IMAGE',
        133: 'DATETIME',
        134: 'SMALLDATETIME',
        135: 'TIMESTAMP',
        200: 'VARCHAR',
        201: 'NVARCHAR',
        202: 'VARCHAR',
        203: 'NTEXT',
        204: 'VARBINARY',
        205: 'IMAGE',
    };
    return typeMap[dataType] || 'VARCHAR';
}

function getMsAccessDatabasePath(deps: MsAccessWindowsDriverToolsDeps, connectionId: number): string {
    const connection = deps.getConnection(connectionId);
    if (!connection) throw new Error('The selected connection could not be found.');
    const server = deps.getServer(connection.server_id);
    if (!server) throw new Error('The selected server could not be found.');
    if (server.driver !== 'msaccess') throw new Error(`The '${server.driver}' driver is not implemented here.`);
    if (server.kind !== 'file') throw new Error('MS Access connections must use a file-based source.');

    const filePath = server.file_path?.trim();
    if (!filePath) throw new Error('The selected MS Access source is missing its file path.');
    if (!existsSync(filePath)) throw new Error(`The MS Access file does not exist: ${filePath}`);

    return filePath;
}

export function useMsAccessWindowsDriverTools(deps: MsAccessWindowsDriverToolsDeps): DriverTools {
    async function getTablesFresh(connectionId: number): Promise<TableSummary[]> {
        const databasePath = getMsAccessDatabasePath(deps, connectionId);

        // Single PowerShell script: get tables + row counts in one connection
        const scriptBody = `
    $schemaTable = $conn.GetOleDbSchemaTable([System.Data.OleDb.OleDbSchemaGuid]::Tables, [System.Array]::CreateInstance([object], 4))
    $result = @()
    foreach ($row in $schemaTable.Rows) {
        $type = $row["TABLE_TYPE"]
        if ($type -eq "TABLE" -or $type -eq "VIEW") {
            $tblName = [string]$row["TABLE_NAME"]
            $qName = "[$($tblName.Replace(']', ']]'))]"
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "SELECT COUNT(*) AS cnt FROM $qName"
            $cnt = 0
            try {
                $reader = $cmd.ExecuteReader()
                if ($reader.Read()) { $cnt = [long]$reader["cnt"] }
                $reader.Close()
            } catch { }
            $result += @{ name = $tblName; type = if ($type -eq "VIEW") { "view" } else { "table" }; rowCount = $cnt }
        }
    }
    $result = $result
  `;

        return await runPowerShellScript(databasePath, scriptBody);
    }

    async function getTableInfoFresh(connectionId: number, tableName: string): Promise<TableInfo> {
        const databasePath = getMsAccessDatabasePath(deps, connectionId);

        // Get columns
        const rawColumns = await executePowerShellOleDbSchema(databasePath, 'columns', tableName);
        // Get indexes
        const rawIndexes = await executePowerShellOleDbSchema(databasePath, 'indexes', tableName);
        // Get foreign keys
        const rawForeignKeys = await executePowerShellOleDbSchema(databasePath, 'foreign-keys', tableName);
        // Get row count
        let rowCount = 0;
        try {
            const countResult = await executePowerShellOleDb(databasePath, [`SELECT COUNT(*) AS rowCount FROM ${quoteMsAccessName(tableName)}`]);
            if (countResult.length > 0 && countResult[0].length > 0) {
                rowCount = Number(countResult[0][0].rowCount) || 0;
            }
        } catch {
            // leave as 0
        }

        // Map primary key info from indexes
        const pkColumns = new Map<string, number>();
        const pkIndexNames = new Set<string>();
        for (const idx of rawIndexes) {
            if (idx.primaryKey) {
                pkIndexNames.add(idx.indexName);
            }
        }
        let pkOrdinal = 1;
        for (const idx of rawIndexes) {
            if (pkIndexNames.has(idx.indexName)) {
                if (!pkColumns.has(idx.columnName)) {
                    pkColumns.set(idx.columnName, pkOrdinal++);
                }
            }
        }

        const columns = rawColumns.map((col: any, i: number) => ({
            cid: i,
            name: col.name,
            type: mapOleDbDataType(Number(col.type) || 0),
            notNull: !col.isNullable,
            defaultValue: null,
            isPrimaryKey: pkColumns.has(col.name),
            primaryKeyOrdinal: pkColumns.get(col.name) ?? null,
            isAutoIncrement: false,
            comment: null,
            collation: null,
            onUpdate: null,
        }));

        // Group indexes by name
        const indexMap = new Map<string, { name: string; isUnique: boolean; columns: string[] }>();
        for (const idx of rawIndexes) {
            if (idx.primaryKey) continue; // Skip PK indexes (they're handled above)
            if (!indexMap.has(idx.indexName)) {
                indexMap.set(idx.indexName, { name: idx.indexName, isUnique: !!idx.unique, columns: [] });
            }
            indexMap.get(idx.indexName)!.columns.push(idx.columnName);
        }

        const indexes: TableIndexInfo[] = Array.from(indexMap.values()).map((idx) => ({
            name: idx.name,
            columns: idx.columns,
            isUnique: idx.isUnique,
            origin: '',
            isPartial: false,
        }));

        // Flatten foreign keys into individual column-pair entries
        const foreignKeys: TableForeignKeyInfo[] = [];
        let fkId = 1;
        const fkSeqs = new Map<string, number>();
        for (const fk of rawForeignKeys) {
            const seq = (fkSeqs.get(fk.fkName) ?? 0) + 1;
            fkSeqs.set(fk.fkName, seq);
            foreignKeys.push({
                id: fkId++,
                name: fk.fkName || undefined,
                sequence: seq,
                table: tableName,
                from: fk.fkColumn,
                to: fk.pkColumn,
                onUpdate: '',
                onDelete: '',
                match: '',
            });
        }

        return {
            name: tableName,
            columns,
            indexes,
            foreignKeys,
            rowCount,
            comment: null,
            engine: null,
            collation: null,
            options: null,
        };
    }

    async function applyTableChanges(_params: NormalizedApplyTableChanges): Promise<ApplyTableChangesResult> {
        throw new Error('Function not implemented.');
        // const databasePath = getMsAccessDatabasePath(deps, params.connectionId);

        // const errors: string[] = [];

        // Catch explicit UCanAccess limitations that CAN be executed natively
        // const tableInfo = await fallbackTools.getTableInfoFresh(params.connectionId, params.tableName);
        // const planErrors = getMsAccessExplicitPlanErrors(tableInfo, params.plan);
        // if (planErrors.length > 0) {
        //     const statements = buildMsAccessModifyTableStatements(params.tableName, params.currentInfo, params.plan);
        //     if (statements.length > 0) {
        //         try {
        //             await executePowerShellOleDb(databasePath, statements);
        //         } catch (e: any) {
        //             errors.push(`Windows Native MS Access Error: ${e.message}`);
        //         }
        //     }
        // } else {
        //     // No explicit native requirement, just use UCanAccess fallback
        //     return fallbackTools.applyTableChanges(params);
        // }

        // return { errors };
    }

    return {
        getTablesFresh,
        getTableInfoFresh,
        // getAvailableDatabases: fallbackTools.getAvailableDatabases,
        applyTableChanges,

        async testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
            const filePath = params.filePath?.trim();
            if (!filePath) throw new Error('A file path is required to test an MS Access source.');
            if (!existsSync(filePath)) throw new Error(`The MS Access file does not exist: ${filePath}`);

            // This executes the PowerShell bridge with no queries, which just calls .Open() and .Close()
            await executePowerShellOleDb(filePath, []);
            return {
                ok: true,
                driver: 'msaccess',
                message: `Connected natively to MS Access via PowerShell and .NET OLEDB Provider.`,
            };
        },

        async getTableData(connectionId: number, tableName: string, limit: number, offset: number, orderBy?: SortOrder): Promise<TableData> {
            const databasePath = getMsAccessDatabasePath(deps, connectionId);
            const quotedName = quoteMsAccessName(tableName);
            const orderClause = orderBy ? ` ORDER BY ${quoteMsAccessName(orderBy.column)} ${orderBy.direction}` : '';

            // Single script: count + data in one invocation
            const scriptBody = `
    $qName = '${quotedName}'
    $topClause = if (${limit} -gt 0) { " TOP ${limit + offset}" } else { "" }

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT COUNT(*) AS cnt FROM $qName"
    $total = 0
    $reader = $cmd.ExecuteReader()
    if ($reader.Read()) { $total = [long]$reader["cnt"] }
    $reader.Close()

    $cmd.CommandText = "SELECT$topClause * FROM $qName${orderClause}"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    $columns = @($dt.Columns | Select-Object -ExpandProperty ColumnName)
    $rows = @()
    foreach ($row in $dt.Rows) {
        $obj = New-Object PSObject
        foreach ($col in $dt.Columns) {
            $val = $row[$col.ColumnName]
            if ($val -is [System.DBNull]) { $val = $null }
            $obj | Add-Member -MemberType NoteProperty -Name $col.ColumnName -Value $val
        }
        $rows += $obj
    }
    $allRows = $rows
    $offsetRows = if (${offset} -gt 0) { $allRows | Select-Object -Skip ${offset} } else { $allRows }
    $limited = if (${limit} -gt 0 -and ${limit} -lt $offsetRows.Count) { $offsetRows | Select-Object -First ${limit} } else { $offsetRows }
    $result = @{ total = $total; rows = @($limited); columns = $columns }
  `;

            const raw: any = await runPowerShellScript(databasePath, scriptBody);
            const data = Array.isArray(raw) ? raw[0] || {} : raw;
            const totalCount = Number(data.total) || 0;
            const allRows: Array<Record<string, any>> = Array.isArray(data.rows) ? data.rows : [];
            const columns: string[] = Array.isArray(data.columns) ? data.columns : allRows.length > 0 ? Object.keys(allRows[0]) : [];
            const columnStats: Record<string, number> = {};
            for (const col of columns) columnStats[col] = allRows.length;

            return { columns, columnStats, rows: allRows, rowCount: totalCount, limit, offset };
        },

        async runQuery(_connectionId: number, _sql: string, _params?: SqlValue[]): Promise<QueryExecutionResult> {
            throw new Error('Function not implemented.');
            // const databasePath = getMsAccessDatabasePath(deps, connectionId);
            // let finalSql = sql;
            // // Extremely basic param replacement for adodb/powershell (if any)
            // if (params && params.length > 0) {
            //     for (const param of params) {
            //         const paramValue = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param === null ? 'NULL' : String(param);
            //         finalSql = finalSql.replace('?', paramValue);
            //     }
            // }
            // try {
            //     const start = performance.now();
            //     const results = await executePowerShellOleDb(databasePath, [finalSql]);
            //     const timeTaken = performance.now() - start;
            //     const queryResult = results[0];
            //     if (queryResult && typeof queryResult === 'object' && 'affectedRows' in queryResult) {
            //         return {
            //             success: true,
            //             timeTaken,
            //             affectedRows: queryResult.affectedRows,
            //         };
            //     }
            //     const rows = Array.isArray(queryResult) ? queryResult : [];
            //     return {
            //         success: true,
            //         timeTaken,
            //         columns: Object.keys(rows[0] || {}),
            //         rows,
            //     };
            // } catch (e: any) {
            //     return {
            //         success: false,
            //         timeTaken: 0,
            //         error: e.message,
            //     };
            // }
        },
        getTableDdl: function (_connectionId: number, _tableName: string): Promise<string> {
            throw new Error('Function not implemented.');
        },
        listServerSchemas: async function (serverId: number, connectionId?: number): Promise<ServerSchemaRecord[]> {
            const server = deps.getServer(serverId);
            if (!server) throw new Error('The selected server could not be found.');
            const connection = typeof connectionId === 'number' ? deps.getConnection(connectionId) : deps.listConnections(serverId)[0];
            const schemaName = connection?.database_name || connection?.name || server.name;
            return [{ name: schemaName }];
        },
        modifyTable: function (_connectionId: number, _tableName: string, _currentInfo: TableInfo, _nextPlan: ModifySchemaPlan): Promise<void> {
            throw new Error('Function not implemented.');
        },
        updateColumn: function (_params: UpdateColumnParams): Promise<TableData> {
            throw new Error('Function not implemented.');
        },
    };
}
