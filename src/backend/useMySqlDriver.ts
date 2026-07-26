import type { DriverTools, RemoteConnectionTarget, SortOrder } from '@backend/db-tools.ts';
import { useRemoteDriverTools, type RemoteDriverClient, type RemoteDriverHelper, type RemoteStatement } from '@backend/useRemoteDriverTools.ts';
import type { ModifySchemaColumn, ModifySchemaForeignKey, ModifySchemaIndex, ModifySchemaKey, ModifySchemaPlan, ModifySchemaTable } from '@backend/useSqliteDriver.ts';
import type { ServerSchemaRecord, SqlValue, TableColumnInfo, TableForeignKeyInfo, TableInfo, TableSummary, TestConnectionParams, TestConnectionResult } from '@utils/appClient';
import 'reflect-metadata';
import { DataSource, TableForeignKey, type QueryRunner, type Table, type View } from 'typeorm';

type MySqlSchemaHelperDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    quoteRemoteIdentifier: (driver: 'mysql', identifier: string) => string;
};

type MySqlTableRow = {
    name: string | null;
    type: string | null;
};

type MySqlColumnRow = {
    ordinalPosition: number | string | null;
    name: string | null;
    columnType: string | null;
    isNullable: string | null;
    columnDefault: string | null;
    columnKey: string | null;
    extra: string | null;
    comment: string | null;
    collation: string | null;
};

type MySqlIndexRow = {
    name: string | null;
    columnName: string | null;
    comment: string | null;
    type: string | null;
    nonUnique: number | string | null;
    seqInIndex: number | string | null;
    columnOrder: string | null;
};

type MySqlForeignKeyRow = {
    name: string | null;
    sequence: number | string | null;
    tableName: string | null;
    fromColumn: string | null;
    toColumn: string | null;
    onUpdate: string | null;
    onDelete: string | null;
    matchOption: string | null;
};

type MySqlDriverToolsDeps = {
    escapeSqlString: (value: string) => string;
    normalizeOptionalText: (value: string | null | undefined) => string | null;
    getRemoteConnectionTarget: (connectionId: number) => RemoteConnectionTarget;
    getRemoteServerTarget: (serverId: number) => RemoteConnectionTarget;
    resolveServerConnectionId: (serverId: number, connectionId?: number) => number | undefined;
    readConnectionPassword: (connectionId: number) => Promise<string | null>;
    readServerPassword: (serverId: number) => Promise<string | null>;
    normalizeTableName: (tableName: string) => string;
    normalizeColumnName: (columnName: string, fieldName: string) => string;
    buildColumnStats: (columns: string[], rows: Array<Record<string, SqlValue>>) => Record<string, number>;
    remoteMutationId: (result: Record<string, unknown>) => number | bigint;
};

type MySqlDataSourceConfig = {
    host: string;
    port?: number;
    database?: string;
    username?: string;
    password: string;
};

function quoteMySqlIdentifier(identifier: string) {
    return identifier
        .split('.')
        .map((part) => `\`${part.replaceAll('`', '``')}\``)
        .join('.');
}

function normalizeCountValue(value: number | bigint | string | null | undefined) {
    if (typeof value === 'bigint') {
        return Number(value);
    }

    if (typeof value === 'string') {
        return Number(value);
    }

    return value ?? 0;
}

function createMySqlDataSource(config: MySqlDataSourceConfig) {
    return new DataSource({
        type: 'mysql',
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        entities: [],
        subscribers: [],
        migrations: [],
        synchronize: false,
        logging: false,
        extra: {
            connectionLimit: 1,
            supportBigNumbers: true,
            bigNumberStrings: true,
        },
    });
}

function getConnectedDatabaseName(dataSource: DataSource) {
    const driver = dataSource.driver as { database?: string | null };
    const databaseName = driver.database?.trim();

    return databaseName && databaseName.length > 0 ? databaseName : null;
}

type MySqlQueryRunnerClient = RemoteDriverClient & {
    dataSource: DataSource;
    queryRunner: QueryRunner;
    tableCache: Map<string, Promise<Table | undefined>>;
};

type TypeOrmMemoryQueryRunner = QueryRunner & {
    enableSqlMemory(): void;
    disableSqlMemory(): void;
    getMemorySql(): { upQueries: Array<{ query: string }> };
    createTable(table: Table, ifNotExist?: boolean, createForeignKeys?: boolean, createIndices?: boolean): Promise<void>;
    createView(view: View, syncWithMetadata?: boolean): Promise<void>;
    getView(viewPath: string): Promise<View | undefined>;
};

function getMySqlQueryRunnerClient(client: RemoteDriverClient): MySqlQueryRunnerClient {
    return client as MySqlQueryRunnerClient;
}

async function loadTypeOrmTable(client: RemoteDriverClient, tableName: string) {
    const queryRunnerClient = getMySqlQueryRunnerClient(client);
    const cacheKey = tableName.toLowerCase();
    const cachedTable = queryRunnerClient.tableCache.get(cacheKey);

    if (cachedTable) {
        return cachedTable;
    }

    const nextTable = queryRunnerClient.queryRunner.getTable(tableName);
    queryRunnerClient.tableCache.set(cacheKey, nextTable);
    return nextTable;
}

function normalizeMemoryStatements(queryRunner: QueryRunner) {
    return queryRunner.getMemorySql().upQueries.map(({ query }) => {
        const trimmed = query.trim();
        return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
    });
}

function getTypeOrmMemoryQueryRunner(queryRunner: QueryRunner) {
    return queryRunner as TypeOrmMemoryQueryRunner;
}

async function collectSqlMemoryStatements(queryRunner: QueryRunner, callback: (runner: TypeOrmMemoryQueryRunner) => Promise<void>) {
    const memoryRunner = getTypeOrmMemoryQueryRunner(queryRunner);
    memoryRunner.enableSqlMemory();

    try {
        await callback(memoryRunner);
        return normalizeMemoryStatements(memoryRunner);
    } finally {
        memoryRunner.disableSqlMemory();
    }
}

async function getMySqlNativeDdl(client: RemoteDriverClient, tableName: string) {
    const objectRows = await client.queryRows<{ type: string | null }>({
        sql: `
            SELECT table_type AS type
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = ?
        `,
        params: [tableName],
    });
    const objectType = String(objectRows[0]?.type ?? '').toUpperCase();

    if (!objectType) {
        return undefined;
    }

    const rows = await client.queryRows<Record<string, unknown>>({
        sql: `${objectType === 'VIEW' ? 'SHOW CREATE VIEW' : 'SHOW CREATE TABLE'} ${quoteMySqlIdentifier(tableName)}`,
    });
    const row = rows[0];

    if (!row) {
        return undefined;
    }

    const createEntry = Object.entries(row).find(([key, value]) => /^create\s+/iu.test(key) && typeof value === 'string');
    const ddl = typeof createEntry?.[1] === 'string' ? createEntry[1].trim() : '';

    if (!ddl) {
        return undefined;
    }

    return ddl.endsWith(';') ? ddl : `${ddl};`;
}

async function getTableOrViewDdl(client: RemoteDriverClient, tableName: string) {
    const nativeDdl = await getMySqlNativeDdl(client, tableName);

    if (nativeDdl) {
        return nativeDdl;
    }

    const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
    const table = await loadTypeOrmTable(client, tableName);

    if (table) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createTable(table, false, true, true);
        });

        return statements.join('\n');
    }

    const view = await getTypeOrmMemoryQueryRunner(queryRunner).getView(tableName);

    if (view) {
        const statements = await collectSqlMemoryStatements(queryRunner, async (memoryRunner) => {
            await memoryRunner.createView(view, false);
        });

        return statements.join('\n');
    }

    throw new Error(`Table '${tableName}' was not found.`);
}

function createTypeOrmForeignKey(foreignKey: ModifySchemaForeignKey) {
    return new TableForeignKey({
        name: foreignKey.name,
        columnNames: foreignKey.columns.map((column) => column.columnName),
        referencedTableName: foreignKey.targetTable,
        referencedColumnNames: foreignKey.columns.map((column) => column.targetName),
        onDelete: foreignKey.onDelete ?? undefined,
        onUpdate: foreignKey.onUpdate ?? undefined,
    });
}

async function getMySqlTableRows(client: RemoteDriverClient) {
    return client.queryRows<MySqlTableRow>({
        sql: `
            SELECT
                table_name AS name,
                table_type AS type
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            ORDER BY table_type ASC, table_name ASC
        `,
    });
}

async function getMySqlColumnRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlColumnRow>({
        sql: `
            SELECT
                ordinal_position AS ordinalPosition,
                column_name AS name,
                column_type AS columnType,
                is_nullable AS isNullable,
                column_default AS columnDefault,
                column_key AS columnKey,
                extra AS extra,
                column_comment AS comment,
                collation_name AS collation
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = ?
            ORDER BY ordinal_position ASC
        `,
        params: [tableName],
    });
}

async function getMySqlIndexRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlIndexRow>({
        sql: `
            SELECT
                index_name AS name,
                column_name AS columnName,
                index_comment AS comment,
                index_type AS type,
                non_unique AS nonUnique,
                seq_in_index AS seqInIndex,
                collation AS columnOrder
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = ?
              AND index_name <> 'PRIMARY'
            ORDER BY index_name ASC, seq_in_index ASC
        `,
        params: [tableName],
    });
}

async function getMySqlForeignKeyRows(client: RemoteDriverClient, tableName: string) {
    return client.queryRows<MySqlForeignKeyRow>({
        sql: `
            SELECT
                kcu.constraint_name AS name,
                kcu.ordinal_position AS sequence,
                kcu.referenced_table_name AS tableName,
                kcu.column_name AS fromColumn,
                kcu.referenced_column_name AS toColumn,
                rc.update_rule AS onUpdate,
                rc.delete_rule AS onDelete,
                rc.match_option AS matchOption
            FROM information_schema.key_column_usage AS kcu
            INNER JOIN information_schema.referential_constraints AS rc
                ON rc.constraint_schema = kcu.constraint_schema
               AND rc.table_name = kcu.table_name
               AND rc.constraint_name = kcu.constraint_name
            WHERE kcu.table_schema = DATABASE()
              AND kcu.table_name = ?
              AND kcu.referenced_table_name IS NOT NULL
            ORDER BY kcu.constraint_name ASC, kcu.ordinal_position ASC
        `,
        params: [tableName],
    });
}

async function getMySqlTableInfoRow(client: RemoteDriverClient, tableName: string) {
    const rows = await client.queryRows<{
        comment: string | null;
        engine: string | null;
        collation: string | null;
        options: string | null;
    }>({
        sql: `
            SELECT
                table_comment AS comment,
                engine AS engine,
                table_collation AS collation,
                create_options AS options
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = ?
        `,
        params: [tableName],
    });

    return rows[0];
}

export function useMySqlSchemaHelper(deps: MySqlSchemaHelperDeps) {
    function mapMySqlColumns(rows: MySqlColumnRow[]) {
        let primaryKeyOrdinal = 0;

        return rows.map((row, index) => {
            const isPrimaryKey = String(row.columnKey ?? '').toUpperCase() === 'PRI';
            const extra = String(row.extra ?? '').toLowerCase();
            const onUpdateMatch = /on update\s+(.+)$/iu.exec(String(row.extra ?? ''));

            return {
                cid: Math.max(0, Number(row.ordinalPosition ?? index + 1) - 1),
                name: String(row.name ?? ''),
                type: String(row.columnType ?? ''),
                notNull: String(row.isNullable ?? '').toUpperCase() !== 'YES',
                defaultValue: deps.normalizeOptionalText(row.columnDefault),
                isPrimaryKey,
                primaryKeyOrdinal: isPrimaryKey ? ++primaryKeyOrdinal : null,
                isAutoIncrement: extra.includes('auto_increment'),
                comment: deps.normalizeOptionalText(row.comment),
                collation: deps.normalizeOptionalText(row.collation),
                onUpdate: deps.normalizeOptionalText(onUpdateMatch?.[1]),
            } satisfies TableColumnInfo;
        });
    }

    function mapMySqlIndexes(rows: MySqlIndexRow[]) {
        const groups = new Map<string, MySqlIndexRow[]>();

        rows.forEach((row) => {
            const name = String(row.name ?? '').trim();

            if (!name) {
                return;
            }

            const group = groups.get(name) ?? [];
            group.push(row);
            groups.set(name, group);
        });

        return [...groups.entries()].map(([name, group]) => {
            const sortedGroup = [...group].sort((left, right) => Number(left.seqInIndex ?? 0) - Number(right.seqInIndex ?? 0));

            return {
                name,
                columns: sortedGroup.map((row) => String(row.columnName ?? '')),
                orders: sortedGroup.map((row) => deps.normalizeOptionalText(row.columnOrder)?.toUpperCase() ?? 'NONE'),
                comment: deps.normalizeOptionalText(sortedGroup[0]?.comment),
                isUnique: Number(sortedGroup[0]?.nonUnique ?? 1) === 0,
                origin: deps.normalizeOptionalText(sortedGroup[0]?.type) ?? 'BTREE',
                isPartial: false,
                type: deps.normalizeOptionalText(sortedGroup[0]?.type),
            };
        });
    }

    function mapMySqlForeignKeys(rows: MySqlForeignKeyRow[]): TableForeignKeyInfo[] {
        const groups = new Map<string, number>();
        let nextId = 0;

        return rows.map((row) => {
            const name = String(row.name ?? '');

            if (!groups.has(name)) {
                groups.set(name, nextId++);
            }

            return {
                id: groups.get(name) ?? 0,
                name,
                sequence: Math.max(0, Number(row.sequence ?? 1) - 1),
                table: String(row.tableName ?? ''),
                from: String(row.fromColumn ?? ''),
                to: String(row.toColumn ?? ''),
                onUpdate: String(row.onUpdate ?? 'NO ACTION'),
                onDelete: String(row.onDelete ?? 'NO ACTION'),
                match: String(row.matchOption ?? 'NONE'),
            } satisfies TableForeignKeyInfo;
        });
    }

    function serializeColumns(columns: string[]) {
        return columns.map((columnName) => columnName.toLowerCase()).join('|');
    }

    function serializeIndexColumns(columns: Array<{ columnName: string; order?: string | null }>) {
        return columns.map((column) => `${column.columnName.toLowerCase()}:${(column.order ?? '').toUpperCase()}`).join('|');
    }

    function buildPrimaryKeyFromColumns(columns: ModifySchemaColumn[]) {
        const primaryColumns = [...columns]
            .filter((column) => column.isPrimaryKey)
            .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
            .map((column) => ({ columnName: column.name }));

        if (!primaryColumns.length) {
            return undefined;
        }

        return {
            name: 'PRIMARY',
            isPrimary: true,
            columns: primaryColumns,
        } satisfies ModifySchemaKey;
    }

    function getDesiredPrimaryKey(plan: ModifySchemaPlan) {
        return plan.keys.find((key) => key.isPrimary) ?? buildPrimaryKeyFromColumns(plan.columns);
    }

    function getCurrentPrimaryKey(currentInfo: TableInfo) {
        const primaryColumns = [...currentInfo.columns]
            .filter((column) => column.isPrimaryKey)
            .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
            .map((column) => ({ columnName: column.name }));

        if (!primaryColumns.length) {
            return undefined;
        }

        return {
            name: 'PRIMARY',
            isPrimary: true,
            columns: primaryColumns,
        } satisfies ModifySchemaKey;
    }

    function getCurrentUniqueKeys(currentInfo: TableInfo) {
        const primaryKey = getCurrentPrimaryKey(currentInfo);
        const primarySignature = primaryKey ? serializeColumns(primaryKey.columns.map((column) => column.columnName)) : undefined;

        return currentInfo.indexes
            .filter((index) => index.isUnique && serializeColumns(index.columns) !== primarySignature)
            .map((index) => ({
                name: index.name,
                isPrimary: false,
                columns: index.columns.map((columnName) => ({ columnName })),
            })) satisfies ModifySchemaKey[];
    }

    function getDesiredStandaloneIndexes(plan: ModifySchemaPlan) {
        const excludedNames = new Set(plan.keys.map((key) => key.name.toLowerCase()));
        excludedNames.add('primary');
        return plan.indexes.filter((index) => !excludedNames.has(index.name.toLowerCase()));
    }

    function getCurrentStandaloneIndexes(currentInfo: TableInfo) {
        const primaryKey = getCurrentPrimaryKey(currentInfo);
        const primarySignature = primaryKey ? serializeColumns(primaryKey.columns.map((column) => column.columnName)) : undefined;

        return currentInfo.indexes
            .filter((index) => !(index.isUnique && serializeColumns(index.columns) !== primarySignature))
            .filter((index) => serializeColumns(index.columns) !== primarySignature)
            .map((index) => ({
                name: index.name,
                comment: index.comment ?? null,
                isUnique: index.isUnique,
                type: index.type ?? null,
                columns: index.columns.map((columnName, indexPosition) => ({
                    columnName,
                    order: index.orders?.[indexPosition] ?? null,
                })),
            })) satisfies ModifySchemaIndex[];
    }

    function groupCurrentForeignKeys(currentInfo: TableInfo) {
        const groups = new Map<string, TableForeignKeyInfo[]>();

        currentInfo.foreignKeys.forEach((foreignKey) => {
            const groupKey = foreignKey.name ?? `${foreignKey.id}`;
            const nextGroup = groups.get(groupKey) ?? [];
            nextGroup.push(foreignKey);
            groups.set(groupKey, nextGroup);
        });

        return [...groups.entries()].map(([name, group]) => ({
            name,
            targetTable: group[0]?.table ?? '',
            columns: [...group].sort((left, right) => left.sequence - right.sequence).map((foreignKey) => ({ columnName: foreignKey.from, targetName: foreignKey.to })),
            onUpdate: group[0]?.onUpdate ?? null,
            onDelete: group[0]?.onDelete ?? null,
            match: group[0]?.match ?? null,
        })) satisfies ModifySchemaForeignKey[];
    }

    function keySignature(key: Pick<ModifySchemaKey, 'columns'> | undefined) {
        return key ? serializeColumns(key.columns.map((column) => column.columnName)) : '';
    }

    function foreignKeySignature(foreignKey: ModifySchemaForeignKey) {
        return [
            foreignKey.targetTable.toLowerCase(),
            foreignKey.columns.map((column) => `${column.columnName.toLowerCase()}=>${column.targetName.toLowerCase()}`).join('|'),
            (foreignKey.onDelete ?? '').toLowerCase(),
            (foreignKey.onUpdate ?? '').toLowerCase(),
            (foreignKey.match ?? '').toLowerCase(),
        ].join('::');
    }

    function indexSignature(index: ModifySchemaIndex) {
        return [serializeIndexColumns(index.columns), index.isUnique ? '1' : '0', (index.type ?? '').toLowerCase(), (index.comment ?? '').toLowerCase()].join('::');
    }

    function buildIndexColumns(columns: Array<{ columnName: string; order?: string | null }>) {
        return columns.map((column) => `${quoteMySqlIdentifier(column.columnName)}${column.order && column.order !== 'NONE' ? ` ${column.order}` : ''}`).join(', ');
    }

    function buildTableOptionStatements(tableName: string, currentInfo: TableInfo, table: ModifySchemaTable) {
        const quotedTableName = deps.quoteRemoteIdentifier('mysql', tableName);
        const statements: string[] = [];

        if ((table.comment ?? '') !== (currentInfo.comment ?? '')) {
            statements.push(`ALTER TABLE ${quotedTableName} COMMENT = ${deps.escapeSqlString(table.comment ?? '')};`);
        }

        if (table.engine && table.engine !== currentInfo.engine) {
            statements.push(`ALTER TABLE ${quotedTableName} ENGINE = ${table.engine};`);
        }

        if (table.collation && table.collation !== currentInfo.collation) {
            statements.push(`ALTER TABLE ${quotedTableName} COLLATE = ${table.collation};`);
        }

        if (table.options && table.options !== currentInfo.options) {
            statements.push(`ALTER TABLE ${quotedTableName} ${table.options};`);
        }

        return statements;
    }

    function buildDropColumnStatements(tableName: string, currentInfo: TableInfo, nextColumns: ModifySchemaColumn[]) {
        const quotedTableName = deps.quoteRemoteIdentifier('mysql', tableName);
        const nextColumnsByOriginalName = new Map(nextColumns.filter((column) => column.originalName).map((column) => [column.originalName!, column]));
        const droppedColumns = currentInfo.columns.filter(
            (column) => !nextColumnsByOriginalName.has(column.name) && !nextColumns.some((entry) => !entry.originalName && entry.name === column.name)
        );

        return droppedColumns.map((column) => `ALTER TABLE ${quotedTableName} DROP COLUMN ${deps.quoteRemoteIdentifier('mysql', column.name)};`);
    }

    async function getTableMetadata(client: RemoteDriverClient, tableName: string): Promise<Partial<ModifySchemaTable>> {
        const tableInfoRow = await getMySqlTableInfoRow(client, tableName);

        return {
            comment: deps.normalizeOptionalText(tableInfoRow?.comment),
            engine: deps.normalizeOptionalText(tableInfoRow?.engine),
            collation: deps.normalizeOptionalText(tableInfoRow?.collation),
            options: deps.normalizeOptionalText(tableInfoRow?.options),
        } satisfies Partial<ModifySchemaTable>;
    }

    async function queryRowCount(client: RemoteDriverClient, tableName: string) {
        const rows = await client.queryRows<{ count: number | bigint | string }>({
            sql: `SELECT COUNT(*) AS count FROM ${quoteMySqlIdentifier(tableName)}`,
        });

        return normalizeCountValue(rows[0]?.count);
    }

    async function getTableColumns(client: RemoteDriverClient, tableName: string): Promise<TableColumnInfo[]> {
        return mapMySqlColumns(await getMySqlColumnRows(client, tableName));
    }

    async function getIndexes(client: RemoteDriverClient, tableName: string) {
        return mapMySqlIndexes(await getMySqlIndexRows(client, tableName));
    }

    async function getForeignKeys(client: RemoteDriverClient, tableName: string): Promise<TableForeignKeyInfo[]> {
        return mapMySqlForeignKeys(await getMySqlForeignKeyRows(client, tableName));
    }

    async function getTableNames(client: RemoteDriverClient): Promise<TableSummary[]> {
        const rows = await getMySqlTableRows(client);
        const tableSummaries = await Promise.all(
            rows
                .filter((row) => String(row.type ?? '').toUpperCase() === 'BASE TABLE')
                .map((row) => String(row.name ?? '').trim())
                .filter((name, index, values) => name.length > 0 && values.indexOf(name) === index)
                .map(async (name) => ({
                    name,
                    type: 'table' as const,
                    rowCount: await queryRowCount(client, name),
                }))
        );
        const seenNames = new Set(tableSummaries.map((table) => table.name.toLowerCase()));
        const viewSummaries = rows
            .filter((row) => String(row.type ?? '').toUpperCase() === 'VIEW')
            .map((row) => String(row.name ?? '').trim())
            .filter((name) => name.length > 0 && !seenNames.has(name.toLowerCase()))
            .map((viewName) => ({
                name: viewName,
                type: 'view' as const,
                rowCount: 0,
            }));

        return [...tableSummaries, ...viewSummaries].sort((left, right) => {
            if (left.type !== right.type) {
                return left.type.localeCompare(right.type);
            }

            return left.name.localeCompare(right.name);
        });
    }

    async function getServerSchemas(client: RemoteDriverClient): Promise<ServerSchemaRecord[]> {
        const rows = await client.queryRows<Record<string, unknown>>({ sql: 'SHOW DATABASES' });
        return rows
            .map((row) => {
                const name = Object.values(row).find((value): value is string => typeof value === 'string' && value.length > 0);
                return name ? { name } : undefined;
            })
            .filter((schema): schema is ServerSchemaRecord => schema !== undefined)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    async function collectForeignKeyViolationMessages(client: RemoteDriverClient, tableName: string) {
        const foreignKeys = await getForeignKeys(client, tableName);
        const groups = new Map<number, TableForeignKeyInfo[]>();

        for (const foreignKey of foreignKeys) {
            const group = groups.get(foreignKey.id) ?? [];
            group.push(foreignKey);
            groups.set(foreignKey.id, group);
        }

        const messages: string[] = [];

        for (const group of groups.values()) {
            if (group.length === 0) {
                continue;
            }

            const sourceTable = deps.quoteRemoteIdentifier('mysql', tableName);
            const parentTable = deps.quoteRemoteIdentifier('mysql', group[0]!.table);
            const joinConditions = group
                .map((foreignKey) => `source.${deps.quoteRemoteIdentifier('mysql', foreignKey.from)} = parent.${deps.quoteRemoteIdentifier('mysql', foreignKey.to)}`)
                .join(' AND ');
            const nonNullConditions = group.map((foreignKey) => `source.${deps.quoteRemoteIdentifier('mysql', foreignKey.from)} IS NOT NULL`).join(' AND ');
            const missingParentCondition = group.map((foreignKey) => `parent.${deps.quoteRemoteIdentifier('mysql', foreignKey.to)} IS NULL`).join(' AND ');

            const sql = `
                SELECT COUNT(*) AS count
                FROM ${sourceTable} AS source
                LEFT JOIN ${parentTable} AS parent
                  ON ${joinConditions}
                WHERE ${nonNullConditions}
                  AND ${missingParentCondition}
            `;

            const rows = await client.queryRows<{ count: number | bigint | string }>({ sql });
            const count = normalizeCountValue(rows[0]?.count);

            if (count > 0) {
                const sourceColumns = group.map((foreignKey) => foreignKey.from).join(', ');
                const targetColumns = group.map((foreignKey) => foreignKey.to).join(', ');
                messages.push(`${tableName} has ${count} foreign key violation${count === 1 ? '' : 's'} for (${sourceColumns}) -> ${group[0]!.table}(${targetColumns}).`);
            }
        }

        return messages;
    }

    async function buildModifyTableStatements(client: RemoteDriverClient, tableName: string, currentInfo: TableInfo, nextPlan: ModifySchemaPlan) {
        const nextColumns = nextPlan.columns;
        const quotedTableName = deps.quoteRemoteIdentifier('mysql', tableName);
        const currentColumnsByName = new Map(currentInfo.columns.map((column) => [column.name, column]));
        const manualStatements: string[] = [];
        const currentPrimaryKey = getCurrentPrimaryKey(currentInfo);
        const desiredPrimaryKey = getDesiredPrimaryKey(nextPlan);
        const currentUniqueKeys = getCurrentUniqueKeys(currentInfo);
        const desiredUniqueKeys = nextPlan.keys.filter((key) => !key.isPrimary);
        const currentForeignKeys = groupCurrentForeignKeys(currentInfo);
        const desiredStandaloneIndexes = getDesiredStandaloneIndexes(nextPlan);
        const currentStandaloneIndexes = getCurrentStandaloneIndexes(currentInfo);
        const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
        const typeOrmTable = await loadTypeOrmTable(client, tableName);

        if (!typeOrmTable) {
            throw new Error(`Table ${tableName} does not exist.`);
        }

        const preManualStatements: string[] = [];
        const preStatements = await collectSqlMemoryStatements(queryRunner, async () => {
            for (const foreignKey of currentForeignKeys) {
                const desiredForeignKey = nextPlan.foreignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

                if (!desiredForeignKey || foreignKeySignature(foreignKey) !== foreignKeySignature(desiredForeignKey)) {
                    const typeOrmForeignKey = typeOrmTable.foreignKeys.find((entry) => entry.name?.toLowerCase() === foreignKey.name.toLowerCase());

                    if (typeOrmForeignKey) {
                        await queryRunner.dropForeignKey(typeOrmTable, typeOrmForeignKey);
                    } else {
                        preManualStatements.push(`ALTER TABLE ${quotedTableName} DROP FOREIGN KEY ${deps.quoteRemoteIdentifier('mysql', foreignKey.name)};`);
                    }
                }
            }

            if (keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey) && currentPrimaryKey) {
                await queryRunner.dropPrimaryKey(typeOrmTable);
            }
        });

        currentUniqueKeys.forEach((key) => {
            const desiredKey = desiredUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

            if (!desiredKey || keySignature(key) !== keySignature(desiredKey)) {
                manualStatements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${deps.quoteRemoteIdentifier('mysql', key.name)};`);
            }
        });

        currentStandaloneIndexes.forEach((index) => {
            const desiredIndex = desiredStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

            if (!desiredIndex || indexSignature(index) !== indexSignature(desiredIndex)) {
                manualStatements.push(`ALTER TABLE ${quotedTableName} DROP INDEX ${deps.quoteRemoteIdentifier('mysql', index.name)};`);
            }
        });

        manualStatements.push(...buildDropColumnStatements(tableName, currentInfo, nextColumns));

        nextColumns.forEach((column, index) => {
            const currentColumn = column.originalName ? currentColumnsByName.get(column.originalName) : undefined;
            const definitionParts = [deps.quoteRemoteIdentifier('mysql', column.name), column.type];

            definitionParts.push(column.notNull ? 'NOT NULL' : 'NULL');

            if (column.defaultValue) {
                definitionParts.push(`DEFAULT ${column.defaultValue}`);
            } else if (!column.notNull && !column.isAutoIncrement) {
                definitionParts.push('DEFAULT NULL');
            }

            if (column.isAutoIncrement) {
                definitionParts.push('AUTO_INCREMENT');
            }

            if (column.onUpdate) {
                definitionParts.push(`ON UPDATE ${column.onUpdate}`);
            }

            if (column.collation) {
                definitionParts.push(`COLLATE ${column.collation}`);
            }

            definitionParts.push(`COMMENT ${deps.escapeSqlString(column.comment ?? '')}`);
            const definition = definitionParts.join(' ');

            if (!currentColumn) {
                const previousColumn = [...nextColumns]
                    .slice(0, index)
                    .reverse()
                    .find(() => true);
                const placementClause = previousColumn ? ` AFTER ${deps.quoteRemoteIdentifier('mysql', previousColumn.name)}` : ' FIRST';
                manualStatements.push(`ALTER TABLE ${quotedTableName} ADD COLUMN ${definition}${placementClause};`);
                return;
            }

            const metadataChanged =
                column.name !== currentColumn.name ||
                column.type !== currentColumn.type ||
                column.notNull !== currentColumn.notNull ||
                column.defaultValue !== deps.normalizeOptionalText(currentColumn.defaultValue) ||
                column.isAutoIncrement !== currentColumn.isAutoIncrement ||
                column.comment !== deps.normalizeOptionalText(currentColumn.comment) ||
                column.collation !== deps.normalizeOptionalText(currentColumn.collation) ||
                column.onUpdate !== deps.normalizeOptionalText(currentColumn.onUpdate);

            if (metadataChanged) {
                manualStatements.push(`ALTER TABLE ${quotedTableName} CHANGE COLUMN ${deps.quoteRemoteIdentifier('mysql', currentColumn.name)} ${definition};`);
            }
        });

        desiredUniqueKeys.forEach((key) => {
            const currentKey = currentUniqueKeys.find((entry) => entry.name.toLowerCase() === key.name.toLowerCase());

            if (!currentKey || keySignature(currentKey) !== keySignature(key)) {
                manualStatements.push(
                    `ALTER TABLE ${quotedTableName} ADD CONSTRAINT ${deps.quoteRemoteIdentifier('mysql', key.name)} UNIQUE (${key.columns
                        .map((column) => deps.quoteRemoteIdentifier('mysql', column.columnName))
                        .join(', ')});`
                );
            }
        });

        desiredStandaloneIndexes.forEach((index) => {
            const currentIndex = currentStandaloneIndexes.find((entry) => entry.name.toLowerCase() === index.name.toLowerCase());

            if (!currentIndex || indexSignature(currentIndex) !== indexSignature(index)) {
                const clauses = [
                    `ALTER TABLE ${quotedTableName} ADD ${index.isUnique ? 'UNIQUE ' : ''}INDEX ${deps.quoteRemoteIdentifier('mysql', index.name)}`,
                    `(${buildIndexColumns(index.columns)})`,
                ];

                if (index.type) {
                    clauses.push(`USING ${index.type}`);
                }

                if (index.comment) {
                    clauses.push(`COMMENT ${deps.escapeSqlString(index.comment)}`);
                }

                manualStatements.push(`${clauses.join(' ')};`);
            }
        });

        const postStatements = await collectSqlMemoryStatements(queryRunner, async () => {
            if (desiredPrimaryKey && keySignature(currentPrimaryKey) !== keySignature(desiredPrimaryKey)) {
                await queryRunner.createPrimaryKey(
                    typeOrmTable,
                    desiredPrimaryKey.columns.map((column) => column.columnName)
                );
            }

            for (const foreignKey of nextPlan.foreignKeys) {
                const currentForeignKey = currentForeignKeys.find((entry) => entry.name.toLowerCase() === foreignKey.name.toLowerCase());

                if (!currentForeignKey || foreignKeySignature(currentForeignKey) !== foreignKeySignature(foreignKey)) {
                    await queryRunner.createForeignKey(typeOrmTable, createTypeOrmForeignKey(foreignKey));
                }
            }
        });
        const renameStatements =
            nextPlan.table.name !== tableName
                ? await collectSqlMemoryStatements(queryRunner, async () => {
                      await queryRunner.renameTable(typeOrmTable, nextPlan.table.name);
                  })
                : [];

        return [
            ...preManualStatements,
            ...preStatements,
            ...manualStatements,
            ...postStatements,
            ...buildTableOptionStatements(tableName, currentInfo, nextPlan.table),
            ...renameStatements,
        ];
    }

    return {
        buildDropColumnStatements,
        getTableMetadata: getTableMetadata,
        buildReadTableStatement(tableName: string, limit: number, offset: number, orderBy?: SortOrder): RemoteStatement {
            const orderClause = orderBy ? ` ORDER BY ${quoteMySqlIdentifier(orderBy.column)} ${orderBy.direction}` : '';

            return {
                sql:
                    limit < 0
                        ? `SELECT * FROM ${quoteMySqlIdentifier(tableName)}${orderClause}${offset > 0 ? ` LIMIT 18446744073709551615 OFFSET ${offset}` : ''}`
                        : `SELECT * FROM ${quoteMySqlIdentifier(tableName)}${orderClause} LIMIT ${limit} OFFSET ${offset}`,
            };
        },
        buildModifyTableStatements,
        buildWriteValueStatement(tableName: string, targetColumn: string, value: SqlValue, matchColumn: string, matchValue: SqlValue): RemoteStatement {
            return {
                sql: `UPDATE ${quoteMySqlIdentifier(tableName)} SET ${quoteMySqlIdentifier(targetColumn)} = ? WHERE ${quoteMySqlIdentifier(matchColumn)} = ?`,
                params: [value, matchValue],
            };
        },
        collectForeignKeyViolationMessages: collectForeignKeyViolationMessages,
        getForeignKeys: getForeignKeys,
        getIndexes: getIndexes,
        getServerSchemas: getServerSchemas,
        getTableColumns: getTableColumns,
        getTableNames: getTableNames,
        queryRowCount: queryRowCount,
    } satisfies RemoteDriverHelper & {
        buildDropColumnStatements: typeof buildDropColumnStatements;
        collectForeignKeyViolationMessages: typeof collectForeignKeyViolationMessages;
    };
}

export function useMySqlDriverTools(deps: MySqlDriverToolsDeps): DriverTools {
    function createRemoteClient(dataSource: DataSource, queryRunner: QueryRunner): MySqlQueryRunnerClient {
        const remoteClient: RemoteDriverClient = {
            queryRows: async <TRow extends Record<string, unknown>>(statement: RemoteStatement) => {
                const rows = await queryRunner.query(statement.sql, statement.params ?? []);
                return Array.isArray(rows) ? (rows as TRow[]) : [];
            },
            execute: async (statement: RemoteStatement) => {
                const result = await queryRunner.query(statement.sql, statement.params ?? []);
                return typeof result === 'object' && result !== null && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
            },
            withTransaction: async <T>(callback: (transactionClient: RemoteDriverClient) => Promise<T>) => {
                try {
                    await queryRunner.startTransaction();
                    const result = await callback(remoteClient);
                    await queryRunner.commitTransaction();
                    return result;
                } catch (error) {
                    try {
                        if (queryRunner.isTransactionActive) {
                            await queryRunner.rollbackTransaction();
                        }
                    } catch {
                        // Some DDL paths autocommit and make rollback unavailable.
                    }

                    throw error;
                }
            },
        };

        return Object.assign(remoteClient, {
            dataSource,
            queryRunner,
            tableCache: new Map<string, Promise<Table | undefined>>(),
        });
    }

    async function withMySqlClient<T>(connectionId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        const target = deps.getRemoteConnectionTarget(connectionId);
        const password = (await deps.readConnectionPassword(connectionId)) ?? '';
        const dataSource = createMySqlDataSource({
            host: target.hostname,
            port: target.port,
            database: target.database,
            username: target.username,
            password,
        });

        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();

        try {
            return await callback(createRemoteClient(dataSource, queryRunner));
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    }

    async function withMySqlServerClient<T>(serverId: number, callback: (client: RemoteDriverClient) => Promise<T>): Promise<T> {
        const target = deps.getRemoteServerTarget(serverId);
        const password = (await deps.readServerPassword(serverId)) ?? '';
        const dataSource = createMySqlDataSource({
            host: target.hostname,
            port: target.port,
            database: target.database,
            username: target.username,
            password,
        });

        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();

        try {
            return await callback(createRemoteClient(dataSource, queryRunner));
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    }

    async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
        const hostname = params.host?.trim();

        if (!hostname) {
            throw new Error('Host is required to test a server connection.');
        }

        const dataSource = createMySqlDataSource({
            host: hostname,
            port: params.port,
            database: params.databaseName,
            username: params.username,
            password: params.password ?? '',
        });

        await dataSource.initialize();

        try {
            const databaseName = getConnectedDatabaseName(dataSource);

            return {
                ok: true,
                driver: 'mysql',
                message: databaseName ? `Connected to MySQL database ${databaseName}.` : 'Connected to MySQL server.',
            };
        } finally {
            await dataSource.destroy();
        }
    }

    const helper = useMySqlSchemaHelper({
        escapeSqlString: deps.escapeSqlString,
        normalizeOptionalText: deps.normalizeOptionalText,
        quoteRemoteIdentifier: (_, identifier) => quoteMySqlIdentifier(identifier),
    });

    const baseTools = useRemoteDriverTools({
        testConnection,
        withRemoteClient: withMySqlClient,
        withServerClient: withMySqlServerClient,
        resolveServerConnectionId: deps.resolveServerConnectionId,
        normalizeTableName: deps.normalizeTableName,
        normalizeColumnName: deps.normalizeColumnName,
        buildColumnStats: deps.buildColumnStats,
        remoteMutationId: deps.remoteMutationId,
        helper,
        foreignKeyController: {
            disable: async (client) => {
                await client.execute({ sql: 'SET FOREIGN_KEY_CHECKS = 0' });
            },
            enable: async (client) => {
                await client.execute({ sql: 'SET FOREIGN_KEY_CHECKS = 1' });
            },
            collectViolationMessages: (client, tableName) => helper.collectForeignKeyViolationMessages(client, tableName),
        },
        unsupportedForeignKeyDisableMessage: 'Disabling foreign key checks is currently supported only for SQLite and MySQL connections.',
    });

    return {
        ...baseTools,
        async getTableDdl(connectionId: number, tableName: string): Promise<string> {
            return withMySqlClient(connectionId, async (client) => getTableOrViewDdl(client, tableName));
        },
        async validateSql(connectionId: number, sql: string): Promise<void> {
            await withMySqlClient(connectionId, async (client) => {
                const queryRunner = getMySqlQueryRunnerClient(client).queryRunner;
                const variableName = '@danevan_validation_sql';
                const statementName = 'danevan_validate_stmt';

                await queryRunner.query(`SET ${variableName} = ?`, [sql.trim().replace(/;+$/u, '')]);

                try {
                    await queryRunner.query(`PREPARE ${statementName} FROM ${variableName}`);
                } finally {
                    try {
                        await queryRunner.query(`DEALLOCATE PREPARE ${statementName}`);
                    } catch {
                        // Ignore cleanup errors when PREPARE itself fails.
                    }
                }
            });
        },
    } satisfies DriverTools;
}
