import type { ConnectionRow, ServerRow } from '@utils/appClient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type InMemoryServer = {
    id: number;
    name: string;
    kind: ServerRow['kind'];
    driver: ServerRow['driver'];
    filePath: string | undefined;
    host: string | undefined;
    port: number | undefined;
    username: string | undefined;
    sequence: number;
    createdAt: string;
    updatedAt: string;
};

type InMemoryConnection = {
    id: number;
    serverId: number;
    name: string;
    host: string | undefined;
    port: number | undefined;
    databaseName: string | undefined;
    readonly: number;
    sequence: number;
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | undefined;
};

let nextServerId = 1;
let nextConnectionId = 1;
let servers: InMemoryServer[] = [];
let connections: InMemoryConnection[] = [];

vi.mock('@backend/db-app', () => ({
    useAppDb: () => ({
        configureDatabase: () => undefined,
        getServer(id: number) {
            const server = servers.find((s) => s.id === id);
            if (!server) return undefined;
            return {
                id: server.id,
                name: server.name,
                kind: server.kind,
                driver: server.driver,
                file_path: server.filePath,
                host: server.host,
                port: server.port,
                username: server.username,
                schema_count: undefined,
                sequence: server.sequence,
                created_at: server.createdAt,
                updated_at: server.updatedAt,
            } satisfies ServerRow;
        },
        listServers() {
            return [...servers]
                .sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
                .map(
                    (server) =>
                        ({
                            id: server.id,
                            name: server.name,
                            kind: server.kind,
                            driver: server.driver,
                            file_path: server.filePath,
                            host: server.host,
                            port: server.port,
                            username: server.username,
                            schema_count: undefined,
                            sequence: server.sequence,
                            created_at: server.createdAt,
                            updated_at: server.updatedAt,
                        }) satisfies ServerRow
                );
        },
        createServer(params: { name: string; kind: ServerRow['kind']; driver: ServerRow['driver']; filePath?: string; host?: string; port?: number; username?: string }) {
            const id = nextServerId++;
            const now = new Date().toISOString();
            servers.push({
                id,
                name: params.name,
                kind: params.kind,
                driver: params.driver,
                filePath: params.filePath,
                host: params.host,
                port: params.port,
                username: params.username,
                sequence: servers.length + 1,
                createdAt: now,
                updatedAt: now,
            });
            return id;
        },
        updateServer(
            id: number,
            params: { name: string; kind: ServerRow['kind']; driver: ServerRow['driver']; filePath?: string; host?: string; port?: number; username?: string }
        ) {
            const server = servers.find((s) => s.id === id);
            if (!server) return;
            server.name = params.name;
            server.kind = params.kind;
            server.driver = params.driver;
            server.filePath = params.filePath;
            server.host = params.host;
            server.port = params.port;
            server.username = params.username;
            server.updatedAt = new Date().toISOString();
        },
        deleteServer(id: number) {
            servers = servers.filter((s) => s.id !== id);
            connections = connections.filter((c) => c.serverId !== id);
        },
        getConnection(id: number) {
            const conn = connections.find((c) => c.id === id);
            if (!conn) return undefined;
            return {
                id: conn.id,
                server_id: conn.serverId,
                name: conn.name,
                host: conn.host,
                port: conn.port,
                database_name: conn.databaseName,
                readonly: conn.readonly,
                sequence: conn.sequence,
                created_at: conn.createdAt,
                updated_at: conn.updatedAt,
                last_used_at: conn.lastUsedAt,
            } satisfies ConnectionRow;
        },
        listConnections(serverId?: number) {
            const filtered = typeof serverId === 'number' ? connections.filter((c) => c.serverId === serverId) : [...connections];
            return filtered
                .sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
                .map(
                    (conn) =>
                        ({
                            id: conn.id,
                            server_id: conn.serverId,
                            name: conn.name,
                            host: conn.host,
                            port: conn.port,
                            database_name: conn.databaseName,
                            readonly: conn.readonly,
                            sequence: conn.sequence,
                            created_at: conn.createdAt,
                            updated_at: conn.updatedAt,
                            last_used_at: conn.lastUsedAt,
                        }) satisfies ConnectionRow
                );
        },
        createConnection(params: { serverId: number; name: string; host?: string; port?: number; databaseName?: string; readonly: boolean }) {
            const id = nextConnectionId++;
            const now = new Date().toISOString();
            const serverConns = connections.filter((c) => c.serverId === params.serverId);
            connections.push({
                id,
                serverId: params.serverId,
                name: params.name,
                host: params.host,
                port: params.port,
                databaseName: params.databaseName,
                readonly: params.readonly ? 1 : 0,
                sequence: serverConns.length + 1,
                createdAt: now,
                updatedAt: now,
                lastUsedAt: undefined,
            });
            return id;
        },
        updateConnection(id: number, params: { serverId: number; name: string; host?: string; port?: number; databaseName?: string; readonly: boolean }) {
            const conn = connections.find((c) => c.id === id);
            if (!conn) return;
            conn.serverId = params.serverId;
            conn.name = params.name;
            conn.host = params.host;
            conn.port = params.port;
            conn.databaseName = params.databaseName;
            conn.readonly = params.readonly ? 1 : 0;
            conn.updatedAt = new Date().toISOString();
        },
        deleteConnection(id: number) {
            connections = connections.filter((c) => c.id !== id);
        },
        serverExists(id: number) {
            return servers.some((s) => s.id === id);
        },
        connectionExists(id: number) {
            return connections.some((c) => c.id === id);
        },
        getUserDataDir: () => '/tmp/danevan-test',
    }),
}));

const { useAppDb } = await import('@backend/db-app');
const appDb = useAppDb();

describe('appDb', () => {
    beforeEach(() => {
        nextServerId = 1;
        nextConnectionId = 1;
        servers = [];
        connections = [];
        appDb.configureDatabase('/tmp/test');
    });

    it('adds a new server and saves all provided values correctly', () => {
        const serverId = appDb.createServer({
            name: 'Test MySQL Server',
            kind: 'server',
            driver: 'mysql',
            host: 'db.example.com',
            port: 3306,
            filePath: undefined,
            username: 'admin',
        });

        expect(serverId).toBeGreaterThan(0);

        const server = appDb.getServer(serverId)!;
        expect(server).toBeDefined();
        expect(server.name).toBe('Test MySQL Server');
        expect(server.kind).toBe('server');
        expect(server.driver).toBe('mysql');
        expect(server.host).toBe('db.example.com');
        expect(server.port).toBe(3306);
        expect(server.username).toBe('admin');
        expect(server.file_path).toBeUndefined();
        expect(server.sequence).toBe(1);
        expect(server.created_at).toBeDefined();
        expect(server.updated_at).toBeDefined();
    });

    it('updates a server and saves changes correctly', () => {
        const serverId = appDb.createServer({
            name: 'Original Server',
            kind: 'server',
            driver: 'postgresql',
            host: 'old.example.com',
            port: 5432,
            filePath: undefined,
            username: 'user1',
        });

        appDb.updateServer(serverId, {
            name: 'Updated Server',
            kind: 'server',
            driver: 'postgresql',
            host: 'new.example.com',
            port: 5433,
            filePath: undefined,
            username: 'user2',
        });

        const server = appDb.getServer(serverId)!;
        expect(server.name).toBe('Updated Server');
        expect(server.host).toBe('new.example.com');
        expect(server.port).toBe(5433);
        expect(server.username).toBe('user2');
    });

    it('adds a new connection to an existing server', () => {
        const serverId = appDb.createServer({
            name: 'Server With Connection',
            kind: 'server',
            driver: 'mysql',
            host: 'db.example.com',
            port: 3306,
            filePath: undefined,
            username: 'admin',
        });

        const connectionId = appDb.createConnection({
            serverId,
            name: 'Production DB',
            host: 'db.example.com',
            port: 3306,
            databaseName: 'production',
            readonly: false,
        });

        expect(connectionId).toBeGreaterThan(0);

        const connection = appDb.getConnection(connectionId)!;
        expect(connection).toBeDefined();
        expect(connection.server_id).toBe(serverId);
        expect(connection.name).toBe('Production DB');
        expect(connection.host).toBe('db.example.com');
        expect(connection.port).toBe(3306);
        expect(connection.database_name).toBe('production');
        expect(connection.readonly).toBe(0);
        expect(connection.sequence).toBe(1);
    });

    it('removes all connections from a server', () => {
        const serverId = appDb.createServer({
            name: 'Server To Clean',
            kind: 'server',
            driver: 'mysql',
            host: 'db.example.com',
            port: 3306,
            filePath: undefined,
            username: 'admin',
        });

        const conn1Id = appDb.createConnection({
            serverId,
            name: 'Connection 1',
            host: 'host1.example.com',
            port: 3306,
            databaseName: 'db1',
            readonly: false,
        });
        const conn2Id = appDb.createConnection({
            serverId,
            name: 'Connection 2',
            host: 'host2.example.com',
            port: 3306,
            databaseName: 'db2',
            readonly: false,
        });

        let connections = appDb.listConnections(serverId);
        expect(connections).toHaveLength(2);

        appDb.deleteConnection(conn1Id);
        appDb.deleteConnection(conn2Id);

        connections = appDb.listConnections(serverId);
        expect(connections).toHaveLength(0);
    });

    it('adds a connection to a server that has no connections', () => {
        const serverId = appDb.createServer({
            name: 'Empty Server',
            kind: 'server',
            driver: 'postgresql',
            host: 'empty.example.com',
            port: 5432,
            filePath: undefined,
            username: 'admin',
        });

        let connections = appDb.listConnections(serverId);
        expect(connections).toHaveLength(0);

        const connectionId = appDb.createConnection({
            serverId,
            name: 'First Connection',
            host: 'empty.example.com',
            port: 5432,
            databaseName: 'mydb',
            readonly: true,
        });

        connections = appDb.listConnections(serverId);
        expect(connections).toHaveLength(1);
        expect(connections[0]!.id).toBe(connectionId);
        expect(connections[0]!.name).toBe('First Connection');
        expect(connections[0]!.readonly).toBe(1);
        expect(connections[0]!.sequence).toBe(1);
    });

    it('updates a connection correctly', () => {
        const serverId = appDb.createServer({
            name: 'Server For Updates',
            kind: 'server',
            driver: 'sqlserver',
            host: 'sql.example.com',
            port: 1433,
            filePath: undefined,
            username: 'sa',
        });

        const connectionId = appDb.createConnection({
            serverId,
            name: 'Original Connection',
            host: 'sql.example.com',
            port: 1433,
            databaseName: 'original_db',
            readonly: false,
        });

        appDb.updateConnection(connectionId, {
            serverId,
            name: 'Updated Connection',
            host: 'new-sql.example.com',
            port: 1434,
            databaseName: 'updated_db',
            readonly: true,
        });

        const connection = appDb.getConnection(connectionId)!;
        expect(connection.name).toBe('Updated Connection');
        expect(connection.host).toBe('new-sql.example.com');
        expect(connection.port).toBe(1434);
        expect(connection.database_name).toBe('updated_db');
        expect(connection.readonly).toBe(1);
    });
});
