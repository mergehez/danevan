// The sidebar's number next to a table comes from the connection's table list. Nothing used to
// write a fresh count back into that list, so it kept the catalog estimate the list was drawn with
// (`~20` next to a table whose rows had all been deleted).
import { describe, expect, it } from 'vitest';
import { _useConnections } from '../../composables/useConnections';

function listedTable(rowCount: number, rowCountIsEstimated?: boolean) {
    return { name: 'people', type: 'table' as const, rowCount, rowCountIsEstimated };
}

describe('table row counts in the sidebar list', () => {
    it('replaces the list estimate with the exact count a table load measured', () => {
        const connections = _useConnections();
        connections.applyConnectionSnapshot(1, [listedTable(20, true)]);

        connections.applyTableRowCount(1, 'people', 0, false);

        expect(connections.getConnectionTablesState(1).tables).toEqual([listedTable(0)]);
    });

    it('keeps the exact count in the cached list too, so a reload does not restore the estimate', () => {
        const connections = _useConnections();
        connections.applyConnectionSnapshot(1, [listedTable(20, true)]);

        connections.applyTableRowCount(1, 'people', 7, false);

        // The cache still counts as fresh, so the next expand answers from it instead of refetching.
        expect(connections.getCachedConnectionSchema(1)?.tables).toEqual([listedTable(7)]);
    });

    it('does not trade an exact count back for a later catalog estimate', () => {
        const connections = _useConnections();
        connections.applyConnectionSnapshot(1, [listedTable(20, true)]);
        connections.applyTableRowCount(1, 'people', 0, false);

        // A metadata sweep answers with the estimate; the measured count stays.
        connections.applyTableRowCount(1, 'people', 20, true);

        expect(connections.getConnectionTablesState(1).tables).toEqual([listedTable(0)]);
    });

    it('accepts a newer estimate while the list itself is still an estimate', () => {
        const connections = _useConnections();
        connections.applyConnectionSnapshot(1, [listedTable(20, true)]);

        connections.applyTableRowCount(1, 'people', 25, true);

        expect(connections.getConnectionTablesState(1).tables).toEqual([listedTable(25, true)]);
    });

    it('ignores a table the connection does not list', () => {
        const connections = _useConnections();
        connections.applyConnectionSnapshot(1, [listedTable(20, true)]);

        connections.applyTableRowCount(1, 'not_listed', 3, false);

        expect(connections.getConnectionTablesState(1).tables).toEqual([listedTable(20, true)]);
    });
});
