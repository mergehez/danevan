import type { DataSource, QueryRunner } from 'typeorm';

type PoolEntry = {
    dataSource: DataSource;
};

/** Driver error codes/messages that mean the pooled connection itself is dead. */
const CONNECTION_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'ER_CON_COUNT_ERROR',
    '57P01',
    '57P02',
    '57P03',
]);

function isConnectionError(error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);

    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
        return true;
    }

    return /connection (?:closed|lost|terminated|ended)|server closed the connection|connection is closed/i.test(message);
}

/**
 * One `DataSource` per target, reused across backend calls.
 *
 * Creating one per request cost ~20 ms locally and a fresh TCP handshake to every
 * remote server (18–27 ms measured), on top of a keychain read. Each request still
 * gets its own query runner, so statement and transaction state stay per-request.
 */
export function createRemoteDataSourcePool() {
    const entries = new Map<string, PoolEntry>();
    const connecting = new Map<string, Promise<DataSource>>();

    async function connect(key: string, create: () => DataSource | Promise<DataSource>) {
        const existing = entries.get(key);

        if (existing?.dataSource.isInitialized) {
            return existing.dataSource;
        }

        entries.delete(key);

        let pending = connecting.get(key);

        if (!pending) {
            pending = (async () => {
                const dataSource = await create();
                await dataSource.initialize();
                return dataSource;
            })();
            connecting.set(key, pending);
        }

        try {
            const dataSource = await pending;
            entries.set(key, { dataSource });
            return dataSource;
        } finally {
            connecting.delete(key);
        }
    }

    async function withDataSource<T>(
        key: string,
        create: () => DataSource | Promise<DataSource>,
        callback: (dataSource: DataSource, queryRunner: QueryRunner) => Promise<T>
    ): Promise<T> {
        const dataSource = await connect(key, create);
        const queryRunner = dataSource.createQueryRunner();

        try {
            return await callback(dataSource, queryRunner);
        } catch (error) {
            // A dead pooled connection must not poison every later call.
            if (isConnectionError(error)) {
                await dispose(key);
            }

            throw error;
        } finally {
            await queryRunner.release().catch(() => undefined);
        }
    }

    async function dispose(key: string) {
        connecting.delete(key);
        const entry = entries.get(key);
        entries.delete(key);

        if (entry?.dataSource.isInitialized) {
            await entry.dataSource.destroy().catch(() => undefined);
        }
    }

    return {
        dispose,
        withDataSource,
    };
}

export const remoteDataSourcePool = createRemoteDataSourcePool();

export const connectionPoolKey = (connectionId: number) => `connection:${connectionId}`;
export const serverPoolKey = (serverId: number) => `server:${serverId}`;
