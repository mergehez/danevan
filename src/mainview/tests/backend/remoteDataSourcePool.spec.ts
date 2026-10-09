// Creating a DataSource per backend call cost ~20 ms locally and a fresh TCP
// handshake to every remote server, so the pool keeps one per target and hands
// each request its own query runner.
import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { createRemoteDataSourcePool } from '../../../backend/remoteDataSourcePool';

type FakeRunner = { release: () => Promise<void> };

function createFakeDataSource() {
    const released = vi.fn(async () => undefined);
    const destroyed = vi.fn(async () => undefined);
    const initialize = vi.fn(async () => undefined);
    const createQueryRunner = vi.fn((): FakeRunner => ({ release: released }));

    return {
        dataSource: {
            isInitialized: true,
            initialize,
            createQueryRunner,
            destroy: destroyed,
        } as unknown as DataSource,
        initialize,
        createQueryRunner,
        released,
        destroyed,
    };
}

describe('remoteDataSourcePool', () => {
    it('initializes one data source per key and reuses it', async () => {
        const pool = createRemoteDataSourcePool();
        const fake = createFakeDataSource();
        const create = vi.fn(() => fake.dataSource);

        expect(await pool.withDataSource('connection:1', create, async () => 'first')).toBe('first');
        expect(await pool.withDataSource('connection:1', create, async () => 'second')).toBe('second');

        expect(create).toHaveBeenCalledTimes(1);
        expect(fake.initialize).toHaveBeenCalledTimes(1);
        // A runner per request, always released.
        expect(fake.createQueryRunner).toHaveBeenCalledTimes(2);
        expect(fake.released).toHaveBeenCalledTimes(2);
        expect(fake.destroyed).not.toHaveBeenCalled();
    });

    it('keeps targets apart', async () => {
        const pool = createRemoteDataSourcePool();
        const first = createFakeDataSource();
        const second = createFakeDataSource();

        await pool.withDataSource('connection:1', () => first.dataSource, async () => undefined);
        await pool.withDataSource('connection:2', () => second.dataSource, async () => undefined);

        expect(first.initialize).toHaveBeenCalledTimes(1);
        expect(second.initialize).toHaveBeenCalledTimes(1);
    });

    it('connects once when several calls race for the same key', async () => {
        const pool = createRemoteDataSourcePool();
        const fake = createFakeDataSource();
        const create = vi.fn(() => fake.dataSource);

        await Promise.all([
            pool.withDataSource('server:7', create, async () => undefined),
            pool.withDataSource('server:7', create, async () => undefined),
            pool.withDataSource('server:7', create, async () => undefined),
        ]);

        expect(create).toHaveBeenCalledTimes(1);
        expect(fake.initialize).toHaveBeenCalledTimes(1);
    });

    it('reconnects after dispose', async () => {
        const pool = createRemoteDataSourcePool();
        const first = createFakeDataSource();
        const second = createFakeDataSource();
        const create = vi.fn().mockReturnValueOnce(first.dataSource).mockReturnValueOnce(second.dataSource);

        await pool.withDataSource('connection:3', create, async () => undefined);
        await pool.dispose('connection:3');
        await pool.withDataSource('connection:3', create, async () => undefined);

        expect(first.destroyed).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('drops a dead connection so the next call reconnects', async () => {
        const pool = createRemoteDataSourcePool();
        const first = createFakeDataSource();
        const second = createFakeDataSource();
        const create = vi.fn().mockReturnValueOnce(first.dataSource).mockReturnValueOnce(second.dataSource);

        await expect(
            pool.withDataSource('connection:4', create, async () => {
                throw Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST' });
            })
        ).rejects.toThrow('Connection lost');

        await pool.withDataSource('connection:4', create, async () => undefined);

        expect(first.destroyed).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it('keeps the pooled connection when the query itself failed', async () => {
        const pool = createRemoteDataSourcePool();
        const fake = createFakeDataSource();
        const create = vi.fn(() => fake.dataSource);

        await expect(
            pool.withDataSource('connection:5', create, async () => {
                throw Object.assign(new Error('Unknown column "nope"'), { code: 'ER_BAD_FIELD_ERROR' });
            })
        ).rejects.toThrow('Unknown column');

        await pool.withDataSource('connection:5', create, async () => undefined);

        expect(fake.destroyed).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
    });
});
