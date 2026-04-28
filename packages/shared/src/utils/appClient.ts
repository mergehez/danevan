export type NavigationView = 'servers' | 'query' | 'scripts';

export type SettingsPanel = 'editors';

export const dbTypes = ['sqlite', 'mysql', 'postgresql', 'sqlserver', 'msaccess'] as const;
export const dbTypeLabels: Record<DbType, string> = {
    sqlite: 'SQLite',
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    sqlserver: 'SQL Server',
    msaccess: 'MS Access',
};

export const dbTypeIcons: Record<DbType, string> = {
    sqlite: 'icon-[devicon-plain--sqlite] text-[#78C2EA]',
    mysql: 'icon-[tabler--brand-mysql] text-blue-300',
    postgresql: 'icon-[devicon-plain--postgresql] text-blue-400',
    sqlserver: 'icon-[devicon-plain--microsoftsqlserver] text-blue-600',
    msaccess: 'icon-[fluent-mdl2--access-logo] text-red-400',
};

export type DbType = (typeof dbTypes)[number];
export type DbTypeRemote = Exclude<DbType, 'sqlite' | 'msaccess'>;

export type NativeCommand = {
    kind: 'open-settings';
    panel?: SettingsPanel;
};

export type EditorApp = {
    path: string;
    label: string;
};

export type CollectionFilterState = {
    connections: {
        tables: boolean;
        views: boolean;
    };
    tables: {
        columns: boolean;
        keys: boolean;
        indexes: boolean;
    };
};

export type EditorSettings = {
    editors: EditorApp[];
    defaultEditorPath: string | undefined;
    queryRowLimit: number;
    activeView: NavigationView;
    collectionFilter: CollectionFilterState;
};
export type GridCustomFormatter = {
    id: string;
    name: string;
    // templateType: 'handlebars' | 'javascript';
    template: string;
    createdAt: string;
    updatedAt: string;
};

export type GridFormatterState = {
    formatters: GridCustomFormatter[];
    columnFormatterIds: Record<string, string | undefined>;
};

export type SqlValue = string | number | bigint | Uint8Array | Buffer | null;

export type SqlDiagnosticMarker = {
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    source?: string;
};

export type SqlDiagnosticsResult = {
    markers: SqlDiagnosticMarker[];
    problemMarkers: SqlDiagnosticMarker[];
};

export type ServerKind = 'server' | 'file';

export type ServerRecord = {
    id: number;
    name: string;
    kind: ServerKind;
    driver: DbType;
    file_path: string | undefined;
    host: string | undefined;
    port: number | undefined;
    schema_count: number | undefined;
    sequence: number | bigint;
    created_at: string;
    updated_at: string;
};

export type ConnectionRecord = {
    id: number;
    server_id: number;
    name: string;
    host: string | undefined;
    port: number | undefined;
    database_name: string | undefined;
    username: string | undefined;
    readonly: number;
    sequence: number | bigint;
    created_at: string;
    updated_at: string;
    last_used_at: string | undefined;
};

export type ScriptRecord = {
    id: number;
    connection_id: number;
    name: string;
    group_name: string | undefined;
    sql_text: string;
    sequence: number | bigint;
    created_at: string;
    updated_at: string;
    last_run_at: string | undefined;
};

export type AppBootstrapApi = {
    servers: ServerRecord[];
    connections: ConnectionRecord[];
    scripts: ScriptRecord[];
    selectedServerId: number | undefined;
    selectedConnectionId: number | undefined;
    selectedScriptId: number | undefined;
};

export type CreateServerParams = {
    name: string;
    kind: ServerKind;
    driver: DbType;
    filePath?: string;
    host?: string;
    port?: number;
};

export type UpdateServerParams = CreateServerParams;

export type CreateConnectionParams = {
    serverId: number;
    name: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    readonly?: boolean;
};

export type UpdateConnectionParams = {
    serverId?: number;
    name: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    readonly?: boolean;
};

export type TestConnectionParams = {
    kind: ServerKind;
    driver: DbType;
    filePath?: string;
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
};

export type TestConnectionResult = {
    ok: true;
    driver: DbType;
    message: string;
};

export type MsAccessRuntimeStatus = {
    runtimeSource: 'bundled' | 'downloaded' | 'missing';
    runtimePath: string | undefined;
    hasGenericBundledJre: boolean;
    bundledJrePlatforms: string[];
    currentPlatformHasBundledJre: boolean;
    runtimeDownloadsDisabled: boolean;
};

export type CreateScriptParams = {
    connectionId: number;
    name: string;
    groupName?: string;
    sqlText?: string;
};

export type UpdateScriptParams = {
    connectionId?: number;
    name: string;
    groupName?: string;
    sqlText: string;
};

export type GetSqlDiagnosticsParams = {
    sql: string;
    dialect?: DbType;
    connectionId?: number;
};

export type FormatSqlParams = {
    sql: string;
    dialect?: DbType;
};

export type TableSummary = {
    name: string;
    type: 'table' | 'view';
    rowCount: number;
};

export type TableColumnInfo = {
    cid: number;
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    primaryKeyOrdinal: number | null;
    isAutoIncrement: boolean;
    comment: string | null;
    collation: string | null;
    onUpdate: string | null;
};

export type ModifyTableColumnParams = {
    originalName?: string;
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    primaryKeyOrdinal: number | null;
    isAutoIncrement: boolean;
    comment: string | null;
    collation: string | null;
    onUpdate: string | null;
    hidden?: boolean;
    columnKind?: string | null;
};

export type ModifyTableTableParams = {
    name: string;
    comment: string | null;
    engine: string | null;
    collation: string | null;
    options: string | null;
};

export type ModifyTableKeyColumnParams = {
    columnName: string;
};

export type ModifyTableKeyParams = {
    originalName?: string;
    name: string;
    isPrimary: boolean;
    columns: ModifyTableKeyColumnParams[];
};

export type ModifyTableForeignKeyColumnParams = {
    columnName: string;
    targetName: string;
};

export type ModifyTableForeignKeyParams = {
    originalName?: string;
    name: string;
    targetTable: string;
    columns: ModifyTableForeignKeyColumnParams[];
    onUpdate: string | null;
    onDelete: string | null;
    match?: string | null;
};

export type ModifyTableIndexColumnParams = {
    columnName: string;
    order: string | null;
};

export type ModifyTableIndexParams = {
    originalName?: string;
    name: string;
    comment: string | null;
    isUnique: boolean;
    type: string | null;
    columns: ModifyTableIndexColumnParams[];
};

export type TableIndexInfo = {
    name: string;
    columns: string[];
    comment?: string | null;
    isUnique: boolean;
    origin: string;
    isPartial: boolean;
    type?: string | null;
    orders?: string[];
};

export type TableForeignKeyInfo = {
    id: number;
    name?: string;
    sequence: number;
    table: string;
    from: string;
    to: string;
    onUpdate: string;
    onDelete: string;
    match: string;
};

export type TableInfo = {
    name: string;
    columns: TableColumnInfo[];
    indexes: TableIndexInfo[];
    foreignKeys: TableForeignKeyInfo[];
    rowCount: number;
    comment?: string | null;
    engine?: string | null;
    collation?: string | null;
    options?: string | null;
};

export type TableData = {
    columns: string[];
    columnStats: Record<string, number>;
    rows: Array<Record<string, SqlValue>>;
    rowCount: number;
    limit: number;
    offset: number;
};

export type QueryExecutionResult =
    | {
          kind: 'rows';
          columns: string[];
          columnStats: Record<string, number>;
          rows: Array<Record<string, SqlValue>>;
      }
    | {
          kind: 'mutation';
          lastInsertRowid: number | bigint;
      };

export type UpdateColumnParams = {
    connectionId: number;
    tableName: string;
    targetColumn: string;
    value: SqlValue;
    matchColumn: string;
    matchValue: SqlValue;
};

export type ApplyTableChange = {
    targetColumn: string;
    value: SqlValue;
    matchColumn: string;
    matchValue: SqlValue;
};

export type ApplyTableChangesParams = {
    connectionId: number;
    tableName: string;
    changes: ApplyTableChange[];
    disableForeignKeyChecks?: boolean;
    limit?: number;
    offset?: number;
};

export type ModifyTableParams = {
    connectionId: number;
    tableName: string;
    table?: ModifyTableTableParams;
    columns: ModifyTableColumnParams[];
    keys?: ModifyTableKeyParams[];
    foreignKeys?: ModifyTableForeignKeyParams[];
    indexes?: ModifyTableIndexParams[];
    allowTableRebuild?: boolean;
};

export type ApplyTableChangesResult = {
    tableData: TableData;
    foreignKeyViolations: string[];
};

export type ServerSchemaRecord = {
    name: string;
};

export type ConnectionSchemaCache = {
    cachedAt: string;
    tables: TableSummary[];
    tableInfoByName: Record<string, TableInfo>;
};

export type PeekFkUsageRelationColumn = {
    sourceColumn: string;
    targetColumn: string;
};

export type PeekFkUsageRelation = {
    sourceTable: string;
    targetTable: string;
    columns: PeekFkUsageRelationColumn[];
};

export type PeekFkUsageSummary = {
    relation: PeekFkUsageRelation;
    rowCount: number;
    errorMessage: string | undefined;
};

export type PeekFkUsagesParams = {
    connectionId: number;
    tableName: string;
    columnName: string;
    rowValues: Record<string, SqlValue>;
};

export type PeekFkUsagesResult = {
    usages: PeekFkUsageSummary[];
};

export type PeekFkUsageRowsParams = {
    connectionId: number;
    relation: PeekFkUsageRelation;
    rowValues: Record<string, SqlValue>;
    limit: number;
};
