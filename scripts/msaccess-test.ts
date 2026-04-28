import { useAppDb } from '@backend/db-app';
import { dbTools } from '@backend/db-tools';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function quoteAccessIdentifier(identifier: string) {
    return `[${identifier.replaceAll(']', ']]')}]`;
}

async function main() {
    const sourceDatabasePath = resolve(process.argv[2] ?? 'assets/test-access-db.mdb');
    const requestedTableName = process.argv[3]?.trim();
    const tempDir = await mkdtemp(join(tmpdir(), 'danevan-msaccess-test-'));
    const databasePath = join(tempDir, 'smoke-test.mdb');
    const appDb = useAppDb();
    const suffix = Date.now().toString(36);
    const parentTableName = `mt_parent_${suffix}`;
    const probeTableName = `mt_probe_${suffix}`;
    const renamedTableName = `${probeTableName}_renamed`;
    const plainIndexName = `idx_${probeTableName}_parent`;
    const renamedIndexName = `${plainIndexName}_renamed`;
    const foreignKeyName = `fk_${probeTableName}_parent`;
    const uniqueKeyName = `uq_${probeTableName}_title`;
    let connectionId: number | undefined;

    try {
        await copyFile(sourceDatabasePath, databasePath);
        appDb.configureDatabase(tempDir);

        console.log(`Using Access database: ${databasePath}`);

        const connectionTest = await dbTools.testConnection({
            kind: 'file',
            driver: 'msaccess',
            filePath: databasePath,
        });

        assert.equal(connectionTest.ok, true, 'MS Access connection test should succeed');
        console.log(`Connection test passed: ${connectionTest.message}`);

        const serverId = appDb.createServer({
            name: 'msaccess-smoke-test',
            kind: 'file',
            driver: 'msaccess',
            filePath: databasePath,
        });
        connectionId = appDb.createConnection({
            serverId,
            name: 'msaccess-smoke-test',
        });

        const tables = await dbTools.getTablesFresh(connectionId);
        assert(tables.length > 0, 'Expected the Access database to expose at least one table');

        const targetTable =
            (requestedTableName ? tables.find((table) => table.name.toLowerCase() === requestedTableName.toLowerCase()) : undefined) ??
            tables.find((table) => table.type === 'table' && table.rowCount > 0) ??
            tables.find((table) => table.type === 'table') ??
            tables[0];
        assert(targetTable, 'Expected to find a table or view for the smoke test');

        console.log(`Query target: ${targetTable.name} (${targetTable.type}, rows: ${targetTable.rowCount})`);

        const queryResult = await dbTools.runQuery(connectionId, `SELECT TOP 5 * FROM ${quoteAccessIdentifier(targetTable.name)}`);
        assert.equal(queryResult.kind, 'rows', 'Expected SELECT query to return rows');
        assert(queryResult.columns.length > 0, 'Expected SELECT query to return at least one column');

        console.log(`SELECT test passed: ${queryResult.rows.length} row(s), ${queryResult.columns.length} column(s)`);

        await dbTools.runQuery(connectionId, `CREATE TABLE ${quoteAccessIdentifier(parentTableName)} ([id] COUNTER PRIMARY KEY, [name] TEXT(255))`);
        await dbTools.runQuery(connectionId, `INSERT INTO ${quoteAccessIdentifier(parentTableName)} ([name]) VALUES ('parent row')`);
        await dbTools.runQuery(connectionId, `CREATE TABLE ${quoteAccessIdentifier(probeTableName)} ([id] COUNTER PRIMARY KEY, [label] TEXT(255), [parent_id] LONG)`);
        await dbTools.runQuery(connectionId, `INSERT INTO ${quoteAccessIdentifier(probeTableName)} ([label], [parent_id]) VALUES ('before modify', 1)`);
        const currentProbeInfo = await dbTools.getTableInfoFresh(connectionId, probeTableName);
        const currentColumnsByName = new Map(currentProbeInfo.columns.map((column) => [column.name.toLowerCase(), column]));
        const currentIdColumn = currentColumnsByName.get('id');
        const currentLabelColumn = currentColumnsByName.get('label');
        const currentParentIdColumn = currentColumnsByName.get('parent_id');

        assert(currentIdColumn, 'Expected Access metadata for id column');
        assert(currentLabelColumn, 'Expected Access metadata for label column');
        assert(currentParentIdColumn, 'Expected Access metadata for parent_id column');

        const modifiedTableInfo = await dbTools.modifyTable({
            connectionId,
            tableName: probeTableName,
            table: {
                name: renamedTableName,
                comment: null,
                engine: null,
                collation: null,
                options: null,
            },
            columns: [
                {
                    originalName: 'id',
                    name: 'id',
                    type: currentIdColumn.type,
                    notNull: currentIdColumn.notNull,
                    defaultValue: currentIdColumn.defaultValue,
                    isPrimaryKey: currentIdColumn.isPrimaryKey,
                    primaryKeyOrdinal: currentIdColumn.primaryKeyOrdinal,
                    isAutoIncrement: currentIdColumn.isAutoIncrement,
                    comment: null,
                    collation: null,
                    onUpdate: null,
                },
                {
                    originalName: 'label',
                    name: 'label',
                    type: currentLabelColumn.type,
                    notNull: currentLabelColumn.notNull,
                    defaultValue: currentLabelColumn.defaultValue,
                    isPrimaryKey: currentLabelColumn.isPrimaryKey,
                    primaryKeyOrdinal: currentLabelColumn.primaryKeyOrdinal,
                    isAutoIncrement: currentLabelColumn.isAutoIncrement,
                    comment: null,
                    collation: null,
                    onUpdate: null,
                },
                {
                    originalName: 'parent_id',
                    name: 'parent_id',
                    type: currentParentIdColumn.type,
                    notNull: currentParentIdColumn.notNull,
                    defaultValue: currentParentIdColumn.defaultValue,
                    isPrimaryKey: currentParentIdColumn.isPrimaryKey,
                    primaryKeyOrdinal: currentParentIdColumn.primaryKeyOrdinal,
                    isAutoIncrement: currentParentIdColumn.isAutoIncrement,
                    comment: null,
                    collation: null,
                    onUpdate: null,
                },
                {
                    name: 'note',
                    type: 'TEXT(255)',
                    notNull: false,
                    defaultValue: null,
                    isPrimaryKey: false,
                    primaryKeyOrdinal: null,
                    isAutoIncrement: false,
                    comment: null,
                    collation: null,
                    onUpdate: null,
                },
            ],
            keys: [
                {
                    name: 'PRIMARY',
                    isPrimary: true,
                    columns: [{ columnName: 'id' }],
                },
                {
                    name: uniqueKeyName,
                    isPrimary: false,
                    columns: [{ columnName: 'label' }],
                },
            ],
            foreignKeys: [
                {
                    name: foreignKeyName,
                    targetTable: parentTableName,
                    columns: [{ columnName: 'parent_id', targetName: 'id' }],
                    onUpdate: 'no_action',
                    onDelete: 'no_action',
                    match: 'none',
                },
            ],
            indexes: [
                {
                    name: plainIndexName,
                    comment: null,
                    isUnique: false,
                    type: 'btree',
                    columns: [{ columnName: 'parent_id', order: 'ASC' }],
                },
            ],
        });

        const loweredIndexNames = new Set(modifiedTableInfo.indexes.map((index) => index.name.toLowerCase()));
        const recreatedForeignKey = modifiedTableInfo.foreignKeys.find((foreignKey) => foreignKey.from.toLowerCase() === 'parent_id' && foreignKey.to.toLowerCase() === 'id');

        assert.equal(modifiedTableInfo.name.toLowerCase(), renamedTableName.toLowerCase(), 'Expected modifyTable to return the renamed table');
        assert(
            modifiedTableInfo.columns.some((column) => column.name === 'note'),
            'Expected new column to exist after modifyTable'
        );
        assert(loweredIndexNames.has(plainIndexName.toLowerCase()), 'Expected plain index to be created after modifyTable');
        assert(loweredIndexNames.has(uniqueKeyName.toLowerCase()), 'Expected unique key index to be created after modifyTable');
        assert(recreatedForeignKey, 'Expected foreign key to be created after modifyTable');
        assert.equal(recreatedForeignKey.name?.trim().length ? true : false, true, 'Expected foreign key metadata to expose a name');

        const modifiedRows = await dbTools.runQuery(connectionId, `SELECT TOP 5 * FROM ${quoteAccessIdentifier(renamedTableName)}`);
        assert.equal(modifiedRows.kind, 'rows', 'Expected modified MS Access table query to return rows');
        assert.equal(modifiedRows.rows[0]?.label, 'before modify', 'Expected existing row data to be preserved across modifyTable');
        assert.equal(modifiedRows.rows[0]?.parent_id, 1, 'Expected foreign key column data to be preserved across modifyTable');

        await dbTools.runQuery(connectionId, `INSERT INTO ${quoteAccessIdentifier(renamedTableName)} ([label], [parent_id], [note]) VALUES ('after modify', 1, 'new row')`);
        const insertedRows = await dbTools.runQuery(connectionId, `SELECT TOP 5 * FROM ${quoteAccessIdentifier(renamedTableName)} ORDER BY [id] DESC`);
        assert.equal(insertedRows.kind, 'rows', 'Expected post-modify insert query to return rows');
        assert.equal(insertedRows.rows[0]?.label, 'after modify', 'Expected inserts into the modified Access table to succeed');

        let renameError: unknown;
        const renamedProbeInfo = await dbTools.getTableInfoFresh(connectionId, renamedTableName);
        const renamedColumnsByName = new Map(renamedProbeInfo.columns.map((column) => [column.name.toLowerCase(), column]));
        const renamedIdColumn = renamedColumnsByName.get('id');
        const renamedLabelColumn = renamedColumnsByName.get('label');
        const renamedParentIdColumn = renamedColumnsByName.get('parent_id');
        const renamedNoteColumn = renamedColumnsByName.get('note');

        assert(renamedIdColumn, 'Expected Access metadata for renamed id column');
        assert(renamedLabelColumn, 'Expected Access metadata for renamed label column');
        assert(renamedParentIdColumn, 'Expected Access metadata for renamed parent_id column');
        assert(renamedNoteColumn, 'Expected Access metadata for renamed note column');

        try {
            await dbTools.modifyTable({
                connectionId,
                tableName: renamedTableName,
                table: {
                    name: renamedTableName,
                    comment: null,
                    engine: null,
                    collation: null,
                    options: null,
                },
                columns: [
                    {
                        originalName: 'id',
                        name: 'id',
                        type: renamedIdColumn.type,
                        notNull: renamedIdColumn.notNull,
                        defaultValue: renamedIdColumn.defaultValue,
                        isPrimaryKey: renamedIdColumn.isPrimaryKey,
                        primaryKeyOrdinal: renamedIdColumn.primaryKeyOrdinal,
                        isAutoIncrement: renamedIdColumn.isAutoIncrement,
                        comment: null,
                        collation: null,
                        onUpdate: null,
                    },
                    {
                        originalName: 'label',
                        name: 'label',
                        type: renamedLabelColumn.type,
                        notNull: renamedLabelColumn.notNull,
                        defaultValue: renamedLabelColumn.defaultValue,
                        isPrimaryKey: renamedLabelColumn.isPrimaryKey,
                        primaryKeyOrdinal: renamedLabelColumn.primaryKeyOrdinal,
                        isAutoIncrement: renamedLabelColumn.isAutoIncrement,
                        comment: null,
                        collation: null,
                        onUpdate: null,
                    },
                    {
                        originalName: 'parent_id',
                        name: 'parent_id',
                        type: renamedParentIdColumn.type,
                        notNull: renamedParentIdColumn.notNull,
                        defaultValue: renamedParentIdColumn.defaultValue,
                        isPrimaryKey: renamedParentIdColumn.isPrimaryKey,
                        primaryKeyOrdinal: renamedParentIdColumn.primaryKeyOrdinal,
                        isAutoIncrement: renamedParentIdColumn.isAutoIncrement,
                        comment: null,
                        collation: null,
                        onUpdate: null,
                    },
                    {
                        originalName: 'note',
                        name: 'note',
                        type: renamedNoteColumn.type,
                        notNull: renamedNoteColumn.notNull,
                        defaultValue: renamedNoteColumn.defaultValue,
                        isPrimaryKey: renamedNoteColumn.isPrimaryKey,
                        primaryKeyOrdinal: renamedNoteColumn.primaryKeyOrdinal,
                        isAutoIncrement: renamedNoteColumn.isAutoIncrement,
                        comment: null,
                        collation: null,
                        onUpdate: null,
                    },
                ],
                keys: [
                    {
                        name: 'PRIMARY',
                        isPrimary: true,
                        columns: [{ columnName: 'id' }],
                    },
                    {
                        originalName: uniqueKeyName,
                        name: uniqueKeyName,
                        isPrimary: false,
                        columns: [{ columnName: 'label' }],
                    },
                ],
                foreignKeys: [
                    {
                        originalName: foreignKeyName,
                        name: foreignKeyName,
                        targetTable: parentTableName,
                        columns: [{ columnName: 'parent_id', targetName: 'id' }],
                        onUpdate: 'no_action',
                        onDelete: 'no_action',
                        match: 'none',
                    },
                ],
                indexes: [
                    {
                        originalName: plainIndexName,
                        name: renamedIndexName,
                        comment: null,
                        isUnique: false,
                        type: 'btree',
                        columns: [{ columnName: 'parent_id', order: 'ASC' }],
                    },
                ],
            });
        } catch (error) {
            renameError = error;
        }

        assert(renameError instanceof Error, 'Expected unsupported index rename to fail');
        assert.match(renameError.message, /cannot modify existing index/i, 'Expected unsupported index rename to report an explicit-command limitation');

        console.log('Modify Table smoke test passed');
        console.log('MS Access smoke test passed');
    } finally {
        if (typeof connectionId === 'number') {
            await dbTools.disconnectConnection(connectionId);
        }

        await rm(tempDir, { recursive: true, force: true });
    }
}

await main();
