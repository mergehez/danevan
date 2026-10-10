import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, MYSQL, post } from './helpers';

function tableDdl(tableName: string) {
    return `CREATE TABLE \`${tableName}\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`name\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`path\` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  \`description\` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`foo_user_id\` bigint unsigned DEFAULT NULL,
  \`height\` int unsigned NOT NULL DEFAULT 0,
  \`width\` int unsigned NOT NULL DEFAULT 0,
  \`size\` int unsigned NOT NULL DEFAULT 0,
  \`last_synced_at\` bigint unsigned DEFAULT NULL,
  \`created_at\` bigint unsigned NOT NULL DEFAULT 0,
  \`created_by\` bigint unsigned NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`caps_path_unique\` (\`path\`),
  KEY \`caps_created_by_foreign\` (\`created_by\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

function columnParams(column: any) {
    return {
        originalName: column.name,
        name: column.name,
        type: column.type,
        notNull: column.notNull,
        defaultValue: column.defaultValue,
        isPrimaryKey: column.isPrimaryKey,
        primaryKeyOrdinal: column.primaryKeyOrdinal,
        isAutoIncrement: column.isAutoIncrement,
        comment: column.comment,
        collation: column.collation,
        onUpdate: column.onUpdate,
        columnKind: 'NORMAL',
    };
}

function newColumnParams(name: string, type: string) {
    return {
        name,
        type,
        notNull: false,
        defaultValue: null,
        isPrimaryKey: false,
        primaryKeyOrdinal: null,
        isAutoIncrement: false,
        comment: null,
        collation: null,
        onUpdate: null,
        columnKind: 'NORMAL',
    };
}

function buildParams(info: any, connectionId: number, table: string) {
    const pkColumns = info.columns.filter((c: any) => c.isPrimaryKey).sort((a: any, b: any) => (a.primaryKeyOrdinal ?? 0) - (b.primaryKeyOrdinal ?? 0));
    const pkNames = new Set(pkColumns.map((c: any) => c.name));
    const isPrimaryIndex = (index: any) => index.name.toLowerCase() === 'primary' || (index.columns.length === pkNames.size && index.columns.every((c: string) => pkNames.has(c)));

    // What the dialog posts: the primary key and the unique indexes as keys, the rest as indexes.
    const keys = [
        ...(pkColumns.length ? [{ originalName: 'PRIMARY', name: 'PRIMARY', isPrimary: true, columns: pkColumns.map((c: any) => ({ columnName: c.name })) }] : []),
        ...info.indexes
            .filter((i: any) => i.isUnique && !isPrimaryIndex(i))
            .map((i: any) => ({ originalName: i.name, name: i.name, isPrimary: false, columns: i.columns.map((c: string) => ({ columnName: c })) })),
    ];

    const indexes = info.indexes
        .filter((i: any) => !isPrimaryIndex(i) && !keys.some((key) => key.name === i.name))
        .map((i: any) => ({
            originalName: i.name,
            name: i.name,
            comment: i.comment ?? null,
            isUnique: i.isUnique,
            type: i.type ?? null,
            // The dialog posts the sort order it read from the catalog, letter and all.
            columns: i.columns.map((col: string, position: number) => ({ columnName: col, order: i.orders?.[position] ?? null })),
        }));

    const foreignKeys = info.foreignKeys.map((f: any) => ({
        originalName: f.name,
        name: f.name,
        targetTable: f.table,
        columns: f.from.split(',').map((col: string, idx: number) => ({ columnName: col.trim(), targetName: (f.to.split(',')[idx] ?? '').trim() })),
        onDelete: f.onDelete,
        onUpdate: f.onUpdate,
        match: f.match,
    }));

    return {
        connectionId,
        tableName: table,
        table: {
            name: table,
            comment: info.comment ?? null,
            engine: info.engine ?? null,
            collation: info.collation ?? null,
            options: info.options ?? null,
        },
        columns: info.columns.map(columnParams),
        keys,
        foreignKeys,
        indexes,
    };
}

test.describe('Modify table popup', () => {
    let serverId = -1;
    let connectionId = -1;
    let tableName = '';

    test.beforeAll(async ({ request }) => {
        const suffix = Date.now().toString();
        const serverName = `e2e-mod-server-${suffix}`;
        const serverBootstrap = await post(request, 'createServer', {
            name: serverName,
            kind: 'server',
            driver: 'mysql',
            filePath: undefined,
            host: MYSQL.host,
            port: MYSQL.port,
            username: MYSQL.username,
            password: MYSQL.password,
        });
        serverId = serverBootstrap.servers.find((entry: { name: string }) => entry.name === serverName).id;

        const connectionBootstrap = await post(request, 'createConnection', {
            serverId,
            name: `e2e-mod-conn-${suffix}`,
            host: MYSQL.host,
            port: MYSQL.port,
            databaseName: MYSQL.database,
            readonly: false,
        });
        connectionId = connectionBootstrap.connections.find((entry: { server_id: number }) => entry.server_id === serverId).id;
    });

    test.beforeEach(async ({ request }) => {
        tableName = `caps_e2e_${Date.now()}`;
        await post(request, 'runQuery', { connectionId, sql: tableDdl(tableName) });
    });

    test.afterEach(async ({ request }) => {
        if (tableName) {
            await request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS \`${tableName}\`` } }).catch(() => {});
        }
    });

    test.afterAll(async ({ request }) => {
        if (serverId > 0) {
            await request.post(`${API}/deleteServer`, { data: { serverId } }).catch(() => {});
        }
    });

    function getInfo(request: APIRequestContext) {
        return post(request, 'getTableInfo', { connectionId, tableName });
    }

    async function applyModify(request: APIRequestContext, mutate: (params: any) => void) {
        const info = await getInfo(request);
        const params = buildParams(info, connectionId, tableName);
        mutate(params);
        return post(request, 'modifyTable', params);
    }

    test('adds a column (test_column int)', async ({ request }) => {
        await applyModify(request, (p) => p.columns.push(newColumnParams('test_column', 'int')));

        const info = await getInfo(request);
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(true);
    });

    test('adds an index on a single column (foo_user_id bigint unsigned)', async ({ request }) => {
        await applyModify(request, (p) =>
            p.indexes.push({ name: 'idx_caps_foo_user_id', comment: null, isUnique: false, type: 'BTREE', columns: [{ columnName: 'foo_user_id', order: null }] })
        );

        const info = await getInfo(request);
        const index = info.indexes.find((i: any) => i.name === 'idx_caps_foo_user_id');
        expect(index).toBeTruthy();
        expect(index.columns).toEqual(['foo_user_id']);
    });

    test('adds a composite index on two columns (foo_user_id, size)', async ({ request }) => {
        await applyModify(request, (p) =>
            p.indexes.push({
                name: 'idx_caps_foo_user_size',
                comment: null,
                isUnique: false,
                type: 'BTREE',
                columns: [
                    { columnName: 'foo_user_id', order: null },
                    { columnName: 'size', order: null },
                ],
            })
        );

        const info = await getInfo(request);
        const index = info.indexes.find((i: any) => i.name === 'idx_caps_foo_user_size');
        expect(index).toBeTruthy();
        expect(index.columns).toEqual(['foo_user_id', 'size']);
    });

    test('adds a foreign key to a column (foo_user_id -> users.id)', async ({ request }) => {
        const fkName = `fk_caps_foo_user_${Date.now()}`;
        await applyModify(request, (p) =>
            p.foreignKeys.push({
                name: fkName,
                targetTable: 'users',
                columns: [{ columnName: 'foo_user_id', targetName: 'id' }],
                onDelete: 'NO ACTION',
                onUpdate: 'NO ACTION',
                match: 'NONE',
            })
        );

        const info = await getInfo(request);
        const fk = info.foreignKeys.find((f: any) => (f.name ?? '').includes('fk_caps_foo_user'));
        expect(fk).toBeTruthy();
        expect(fk.table).toBe('users');
        expect(fk.from.split(',').map((s: string) => s.trim())).toEqual(['foo_user_id']);
    });

    test('changes an existing index without a parse error', async ({ request }) => {
        // The catalog reports an ascending column as "A"; MySQL only accepts ASC/DESC, and its DDL
        // is not transactional, so the DROP that precedes the rejected ADD is already committed.
        await applyModify(request, (p) => {
            const index = p.indexes.find((i: any) => i.name === 'caps_created_by_foreign');
            index.columns.push({ columnName: 'size', order: null });
        });

        const info = await getInfo(request);
        const index = info.indexes.find((i: any) => i.name === 'caps_created_by_foreign');
        expect(index.columns).toEqual(['created_by', 'size']);
        expect(index.orders).toEqual(['ASC', 'ASC']);
    });

    test('changes a column type (name -> varchar(500))', async ({ request }) => {
        await applyModify(request, (p) => {
            const name = p.columns.find((c: any) => c.name === 'name');
            name.type = 'varchar(500)';
        });

        const info = await getInfo(request);
        const name = info.columns.find((c: any) => c.name === 'name');
        expect(name.type.toLowerCase()).toContain('varchar(500)');
    });

    test('adds a column between existing columns (between name and path)', async ({ request }) => {
        await applyModify(request, (p) => {
            const pathIndex = p.columns.findIndex((c: any) => c.name === 'path');
            p.columns.splice(pathIndex, 0, newColumnParams('between_col', 'varchar(50)'));
        });

        const info = await getInfo(request);
        const order = info.columns.map((c: any) => c.name);
        expect(order.indexOf('name')).toBeLessThan(order.indexOf('between_col'));
        expect(order.indexOf('between_col')).toBeLessThan(order.indexOf('path'));
    });

    test('deletes a column (test_column)', async ({ request }) => {
        await applyModify(request, (p) => p.columns.push(newColumnParams('test_column', 'int')));
        await applyModify(request, (p) => {
            p.columns = p.columns.filter((c: any) => c.name !== 'test_column');
        });

        const info = await getInfo(request);
        expect(info.columns.some((c: any) => c.name === 'test_column')).toBe(false);
    });

    test('deletes both simple indices (caps_path_unique and caps_created_by_foreign)', async ({ request }) => {
        await applyModify(request, (p) => {
            // The dialog drops a unique index from its keys and a plain one from its indexes.
            p.keys = p.keys.filter((k: any) => k.name !== 'caps_path_unique');
            p.indexes = p.indexes.filter((i: any) => i.name !== 'caps_path_unique' && i.name !== 'caps_created_by_foreign');
        });

        const info = await getInfo(request);
        expect(info.indexes.some((i: any) => i.name === 'caps_path_unique')).toBe(false);
        expect(info.indexes.some((i: any) => i.name === 'caps_created_by_foreign')).toBe(false);
    });

    test('deletes a foreign key (for foo_user_id)', async ({ request }) => {
        const fkName = `fk_caps_foo_user_${Date.now()}`;
        await applyModify(request, (p) =>
            p.foreignKeys.push({
                name: fkName,
                targetTable: 'users',
                columns: [{ columnName: 'foo_user_id', targetName: 'id' }],
                onDelete: 'NO ACTION',
                onUpdate: 'NO ACTION',
                match: 'NONE',
            })
        );
        await applyModify(request, (p) => {
            p.foreignKeys = p.foreignKeys.filter((f: any) => f.name !== fkName);
        });

        const info = await getInfo(request);
        expect(info.foreignKeys.some((f: any) => (f.name ?? '').includes('fk_caps_foo_user'))).toBe(false);
    });

    test('adds a column on a table that has a foreign key (no_action)', async ({ request }) => {
        const fkName = `caps_e2e_fk_${Date.now()}`;
        await post(request, 'runQuery', {
            connectionId,
            sql: `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`created_by\`) REFERENCES \`users\` (\`id\`)`,
        });

        const info = await getInfo(request);
        const params = buildParams(info, connectionId, tableName);
        // The modal normalizes FK actions to lowercase 'no_action'.
        params.foreignKeys = params.foreignKeys.map((fk: any) => ({ ...fk, onDelete: 'no_action', onUpdate: 'no_action', match: fk.match ?? 'none' }));

        const descriptionIndex = params.columns.findIndex((c: any) => c.name === 'description');
        const testColumn = { ...newColumnParams('test', 'longtext'), comment: '' };
        params.columns.splice(descriptionIndex + 1, 0, testColumn);

        await post(request, 'modifyTable', params);

        const result = await getInfo(request);
        expect(result.columns.some((c: any) => c.name === 'test')).toBe(true);
    });

    test('reorders a column (moves title down once)', async ({ request }) => {
        // Rename name -> title so we have a title column to move.
        await applyModify(request, (p) => {
            const name = p.columns.find((c: any) => c.name === 'name');
            name.name = 'title';
        });

        // Move title down one position (swap with the next column).
        await applyModify(request, (p) => {
            const titleIndex = p.columns.findIndex((c: any) => c.name === 'title');
            const [moved] = p.columns.splice(titleIndex, 1);
            p.columns.splice(titleIndex + 1, 0, moved);
        });

        const info = await getInfo(request);
        const order = info.columns.map((c: any) => c.name);
        expect(order.indexOf('title')).toBe(order.indexOf('path') + 1);
    });

    test('adds a unique index (on name)', async ({ request }) => {
        await applyModify(request, (p) =>
            p.indexes.push({ name: 'idx_caps_name_unique', comment: null, isUnique: true, type: 'BTREE', columns: [{ columnName: 'name', order: null }] })
        );

        const info = await getInfo(request);
        const index = info.indexes.find((i: any) => i.name === 'idx_caps_name_unique');
        expect(index).toBeTruthy();
        expect(index.isUnique).toBe(true);
        expect(index.columns).toEqual(['name']);
    });

    test('adds an index on three columns (foo_user_id, size, height)', async ({ request }) => {
        await applyModify(request, (p) =>
            p.indexes.push({
                name: 'idx_caps_foo_size_height',
                comment: null,
                isUnique: false,
                type: 'BTREE',
                columns: [
                    { columnName: 'foo_user_id', order: null },
                    { columnName: 'size', order: null },
                    { columnName: 'height', order: null },
                ],
            })
        );

        const info = await getInfo(request);
        const index = info.indexes.find((i: any) => i.name === 'idx_caps_foo_size_height');
        expect(index).toBeTruthy();
        expect(index.columns).toEqual(['foo_user_id', 'size', 'height']);
    });

    test('renames a column (name -> title)', async ({ request }) => {
        await applyModify(request, (p) => {
            const name = p.columns.find((c: any) => c.name === 'name');
            name.name = 'title';
        });

        const info = await getInfo(request);
        expect(info.columns.some((c: any) => c.name === 'title')).toBe(true);
        expect(info.columns.some((c: any) => c.name === 'name')).toBe(false);
    });

    test('changes a column to NOT NULL (description)', async ({ request }) => {
        await applyModify(request, (p) => {
            const description = p.columns.find((c: any) => c.name === 'description');
            description.notNull = true;
        });

        const info = await getInfo(request);
        const description = info.columns.find((c: any) => c.name === 'description');
        expect(description.notNull).toBe(true);
    });

    test('changes a column default value (description)', async ({ request }) => {
        await applyModify(request, (p) => {
            const description = p.columns.find((c: any) => c.name === 'description');
            description.defaultValue = "'e2e-default'";
        });

        const info = await getInfo(request);
        const description = info.columns.find((c: any) => c.name === 'description');
        expect(description.defaultValue).toBe("'e2e-default'");
    });

    test('keeps a string default quoted when the column is altered', async ({ request }) => {
        // MySQL's catalog reports the literal itself rather than the SQL, so re-emitting it as a
        // bare word (`DEFAULT guest`) is a syntax error and `DEFAULT ''` used to become DEFAULT NULL.
        const defaultsTable = `caps_e2e_defaults_${Date.now()}`;
        await post(request, 'runQuery', {
            connectionId,
            sql: `CREATE TABLE \`${defaultsTable}\` (
                \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
                \`label\` varchar(50) NOT NULL DEFAULT 'guest',
                \`note\` varchar(50) DEFAULT '',
                \`path\` varchar(50) DEFAULT 'C:\\\\temp',
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        });

        try {
            const before = await post(request, 'getTableInfo', { connectionId, tableName: defaultsTable });
            expect(before.columns.map((column: any) => [column.name, column.defaultValue])).toEqual([
                ['id', null],
                ['label', "'guest'"],
                ['note', "''"],
                ['path', "'C:\\\\temp'"],
            ]);

            // Widening the column repeats its default in the CHANGE COLUMN clause.
            const params = buildParams(before, connectionId, defaultsTable);
            params.columns.find((column: any) => column.name === 'label').type = 'varchar(80)';
            await post(request, 'modifyTable', params);

            const after = await post(request, 'getTableInfo', { connectionId, tableName: defaultsTable });
            expect(after.columns.find((column: any) => column.name === 'label').type).toBe('varchar(80)');
            expect(after.columns.map((column: any) => [column.name, column.defaultValue])).toEqual([
                ['id', null],
                ['label', "'guest'"],
                ['note', "''"],
                ['path', "'C:\\\\temp'"],
            ]);

            // The declared defaults still apply, which is what the escaping is there to protect.
            await post(request, 'runQuery', { connectionId, sql: `INSERT INTO \`${defaultsTable}\` (\`id\`) VALUES (1)` });
            const inserted = await post(request, 'runQuery', { connectionId, sql: `SELECT \`label\`, \`note\`, \`path\` FROM \`${defaultsTable}\`` });
            expect(inserted.rows).toEqual([{ label: 'guest', note: '', path: 'C:\\temp' }]);
        } finally {
            await request.post(`${API}/runQuery`, { data: { connectionId, sql: `DROP TABLE IF EXISTS \`${defaultsTable}\`` } }).catch(() => {});
        }
    });

    test('deletes a single index (caps_path_unique)', async ({ request }) => {
        await applyModify(request, (p) => {
            p.keys = p.keys.filter((k: any) => k.name !== 'caps_path_unique');
        });

        const info = await getInfo(request);
        expect(info.indexes.some((i: any) => i.name === 'caps_path_unique')).toBe(false);
        expect(info.indexes.some((i: any) => i.name === 'caps_created_by_foreign')).toBe(true);
    });

    test('renames the table', async ({ request }) => {
        const newName = `caps_e2e_renamed_${Date.now()}`;

        await applyModify(request, (p) => {
            p.table.name = newName;
        });
        tableName = newName;

        const info = await getInfo(request);
        expect(info.name).toBe(newName);
    });
});
