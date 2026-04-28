import {
    ApplyTableChangesResult,
    QueryExecutionResult,
    ServerSchemaRecord,
    SqlValue,
    TableData,
    TableInfo,
    TestConnectionParams,
    TestConnectionResult,
    UpdateColumnParams,
} from '@shared/utils/appClient.ts';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DriverTools, NormalizedApplyTableChanges } from './db-tools.ts';
import { MsAccessServerRecord, useMsAccessDriverTools, type MsAccessConnectionRecord } from './useMsAccessDriver.ts';
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
function executePowerShellOleDb(filePath: string, queries: string[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const queriesJsonStr = JSON.stringify(queries).replace(/'/g, "''");
        const dbPathStr = filePath.replace(/'/g, "''");

        const psScript = `
$ErrorActionPreference = "Stop"
try {
    $DbPath = '${dbPathStr}'
    $QueriesJson = '${queriesJsonStr}'
    $queries = $QueriesJson | ConvertFrom-Json

    # Automatically probe for the best installed provider
    $providers = (New-Object system.data.oledb.oledbenumerator).GetElements() | Select-Object -ExpandProperty SOURCES_NAME
    $provider = ""
    if ($providers -contains "Microsoft.ACE.OLEDB.16.0") {
        $provider = "Microsoft.ACE.OLEDB.16.0"
    } elseif ($providers -contains "Microsoft.ACE.OLEDB.12.0") {
        $provider = "Microsoft.ACE.OLEDB.12.0"
    } elseif ($providers -contains "Microsoft.Jet.OLEDB.4.0") {
        $provider = "Microsoft.Jet.OLEDB.4.0"
    } else {
        throw "Failed to find a working Microsoft Access OLEDB provider. Please install the Access Database Engine."
    }

    $conn = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$DbPath;Persist Security Info=False;")
    $conn.Open()

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
    
    $conn.Close()

    $output = @{ success = $true; data = $results }
    $json = $output | ConvertTo-Json -Depth 10
    [System.Console]::WriteLine($json)
} catch {
    $errObj = @{ success = $false; error = $_.Exception.Message }
    $json = $errObj | ConvertTo-Json -Depth 10
    [System.Console]::WriteLine($json)
}
        `;

        const scriptBuffer = Buffer.from(psScript, 'utf16le');
        const base64Script = scriptBuffer.toString('base64');

        const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', base64Script]);

        let stdout = '';
        let stderr = '';

        ps.stdout.on('data', (data) => (stdout += data.toString()));
        ps.stderr.on('data', (data) => (stderr += data.toString()));

        ps.on('close', (code) => {
            if (code !== 0 && !stdout) {
                return reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
            }

            try {
                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                if (!jsonMatch) throw new Error('No JSON found in output. Stderr: ' + stderr);

                const result = JSON.parse(jsonMatch[0]);
                if (result.success) {
                    resolve(result.data || []);
                } else {
                    reject(new Error(result.error));
                }
            } catch (e) {
                reject(
                    new Error(`Failed to parse PowerShell output: ${stdout}
Stderr: ${stderr}`)
                );
            }
        });
    });
}

// function quoteMsAccessIdentifier(identifier: string) {
//     return identifier
//         .split('.')
//         .map((part) => part.trim())
//         .filter(Boolean)
//         .map((part) => `[${part.replaceAll(']', ']]')}]`)
//         .join('.');
// }

export function useMsAccessWindowsDriverTools(_deps: MsAccessWindowsDriverToolsDeps, fallbackTools: ReturnType<typeof useMsAccessDriverTools>): DriverTools {
    async function getTableData(connectionId: number, tableName: string, limit: number, offset: number): Promise<TableData> {
        // const databasePath = getMsAccessDatabasePath(deps, connectionId);

        // const countSql = `SELECT COUNT(*) AS total FROM ${quoteMsAccessIdentifier(tableName)}`;
        // const dataSql = `SELECT TOP ${limit} * FROM (SELECT * FROM ${quoteMsAccessIdentifier(tableName)}) AS t`;

        // MS Access doesn't support LIMIT/OFFSET easily.
        // We only fetch TOP N via PowerShell here since this is native ADODB.
        // For accurate pagination, we should probably just use UCanAccess's getTableData.
        // The instructions state we fallback to UCanAccess for data fetching if it's complex,
        // but let's implement basic fetching for now.
        return fallbackTools.getTableData(connectionId, tableName, limit, offset);
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
        // Fallback complex introspection directly to UCanAccess (JDBC)
        getTablesFresh: fallbackTools.getTablesFresh,
        getTableInfoFresh: fallbackTools.getTableInfoFresh,
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

        getTableData,

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
        listServerSchemas: function (_serverId: number, _connectionId?: number): Promise<ServerSchemaRecord[]> {
            throw new Error('Function not implemented.');
        },
        modifyTable: function (_connectionId: number, _tableName: string, _currentInfo: TableInfo, _nextPlan: ModifySchemaPlan): Promise<void> {
            throw new Error('Function not implemented.');
        },
        updateColumn: function (_params: UpdateColumnParams): Promise<TableData> {
            throw new Error('Function not implemented.');
        },
    };
}
