import { computed, watch, type ComputedRef } from 'vue';
import type { TableInfo } from '../../shared/types';
import { findSingleSourceTable } from '../../shared/utils/sqlSourceTable';
import { useConnections } from './useConnections';
import { useServers } from './useServers';

type UseResultSourceTableOptions = {
    connectionId: () => number | undefined;
    /** The statement behind the shown rows, when it is known. */
    sql: () => string | undefined;
    /** The shown columns, checked against the table's own before the table is trusted. */
    resultColumns?: () => string[] | undefined;
};

/**
 * Names the table a grid's rows came from and loads its metadata, so an edit is written to the
 * table the statement read. A result whose source cannot be named (a join, a derived table, an
 * unknown qualifier, no statement at all) resolves to no table and the grid refuses the edit:
 * guessing from the column shape is what sent an update to an unrelated table.
 */
export function useResultSourceTable(options: UseResultSourceTableOptions): {
    tableName: ComputedRef<string | undefined>;
    tableInfo: ComputedRef<TableInfo | undefined>;
} {
    const connections = useConnections();
    const servers = useServers();

    const candidateName = computed(() => {
        const connectionId = options.connectionId();
        const sql = options.sql();

        if (!connectionId || !sql) {
            return undefined;
        }

        const connection = connections.connections.find((entry) => entry.id === connectionId);
        const server = servers.servers.find((entry) => entry.id === connection?.server_id);
        // A qualifier may only be read as this connection's own schema: `otherdb.people` must not
        // resolve to a `people` table of the database being edited.
        const allowedQualifiers = [
            ...(connection?.database_name ? [connection.database_name] : []),
            ...(server?.driver === 'sqlite' ? ['main', 'temp'] : []),
        ];
        const parsed = findSingleSourceTable(sql, { allowedQualifiers: allowedQualifiers });

        if (!parsed) {
            return undefined;
        }

        const normalizedName = parsed.tableName.toLowerCase();
        const table = connections.getConnectionTablesState(connectionId).tables.find((entry) => entry.name.toLowerCase() === normalizedName);

        return table?.name;
    });

    // Load the metadata before the grid can offer an edit: without the primary key columns it
    // cannot build a WHERE clause, and the table may never have been opened in the data tab.
    watch(
        () => [options.connectionId(), candidateName.value] as const,
        ([connectionId, tableName]) => {
            if (connectionId && tableName) {
                void connections.ensureTableDetails(connectionId, tableName);
            }
        },
        { immediate: true }
    );

    const tableInfo = computed(() => {
        const connectionId = options.connectionId();
        const tableName = candidateName.value;

        if (!connectionId || !tableName) {
            return undefined;
        }

        const info = connections.getTableDetailsState(connectionId, tableName).info;

        if (!info) {
            return undefined;
        }

        // A statement the parser named but whose columns the result does not match is not a table
        // this grid may write to (an expression aliased to a column name, or a mis-read source).
        const resultColumns = options.resultColumns?.();

        if (resultColumns?.length) {
            const knownColumns = new Set(info.columns.map((column) => column.name.toLowerCase()));

            if (!resultColumns.every((column) => knownColumns.has(column.toLowerCase()))) {
                return undefined;
            }
        }

        return info;
    });

    const tableName = computed(() => (tableInfo.value ? candidateName.value : undefined));

    return { tableName: tableName, tableInfo: tableInfo };
}
