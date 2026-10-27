import type { DbType } from '../types';
import { quoteSqlIdentifier } from './sqlIdentifiers';

/** `all` selects the table's columns (`*`), `custom` the columns the user picked. */
export type InteractiveSelectMode = 'all' | 'custom';

export type InteractiveOrderDirection = 'ASC' | 'DESC';

export type InteractiveOrderByClause = {
    column: string;
    direction: InteractiveOrderDirection;
};

/**
 * The draft behind the data tab's interactive query bar. It changes while the user edits the
 * controls and only becomes a statement when the query is run.
 */
export type InteractiveSelectDraft = {
    selectMode: InteractiveSelectMode;
    /** The picked columns, used while `selectMode` is `custom`. */
    columns: string[];
    /** Raw select expressions such as `count(*) as total`, appended after the columns. */
    expressions: string[];
    /** Raw conditions, joined with AND and wrapped in parentheses so an OR cannot leak out. */
    where: string[];
    orderBy: InteractiveOrderByClause[];
    /** `''` means "not set"; a negative count means unlimited, like the grid's row limit. */
    limit: number | '';
    offset: number | '';
};

export function createInteractiveSelectDraft(options: { columns?: string[]; limit?: number } = {}): InteractiveSelectDraft {
    return {
        selectMode: 'all',
        columns: [...(options.columns ?? [])],
        expressions: [],
        where: [],
        orderBy: [],
        limit: options.limit === undefined || options.limit < 0 ? '' : Math.round(options.limit),
        offset: '',
    };
}

/** A copy, so a remembered draft cannot be edited by the controls of the current one. */
export function cloneInteractiveSelectDraft(draft: InteractiveSelectDraft): InteractiveSelectDraft {
    return {
        selectMode: draft.selectMode,
        columns: [...draft.columns],
        expressions: [...draft.expressions],
        where: [...draft.where],
        orderBy: draft.orderBy.map((clause) => ({ ...clause })),
        limit: draft.limit,
        offset: draft.offset,
    };
}

/** An unset or negative count is "no limit", the way the grid's row limit reads. */
function toRowCount(value: number | ''): number | undefined {
    if (value === '' || !Number.isFinite(value)) {
        return undefined;
    }

    const count = Math.round(value);

    return count < 0 ? undefined : count;
}

/** MySQL cannot express an offset without a limit; this is the "no limit" one it uses itself. */
const MYSQL_UNLIMITED_LIMIT = '18446744073709551615';

/**
 * Builds the statement the interactive bar runs. The pagination follows the grid's own query for
 * each dialect: SQL Server takes OFFSET/FETCH (which needs an ORDER BY), MySQL needs a LIMIT before
 * its OFFSET and MS Access only has TOP, so its offset is left out.
 */
export function buildInteractiveSelectSql(params: { tableName: string | undefined; draft: InteractiveSelectDraft; dialect: DbType }): string {
    const tableName = params.tableName?.trim();

    if (!tableName) {
        return '';
    }

    const { draft, dialect } = params;
    const whereClauses = draft.where.map((condition) => condition.trim()).filter(Boolean);
    const orderClauses = draft.orderBy.filter((clause) => clause.column.trim());
    const limit = toRowCount(draft.limit);
    const offset = toRowCount(draft.offset) ?? 0;

    // `*` already covers every column, so expressions only join a custom select list.
    const selectList =
        draft.selectMode === 'custom'
            ? [
                  ...draft.columns.filter(Boolean).map((column) => quoteSqlIdentifier(column, dialect)),
                  ...draft.expressions.map((expression) => expression.trim()).filter(Boolean),
              ].join(', ')
            : '';
    const usesTop = dialect === 'msaccess' && limit !== undefined;
    const parts = [`SELECT ${usesTop ? `TOP ${limit} ` : ''}${selectList || '*'} FROM ${quoteSqlIdentifier(tableName, dialect)}`];

    if (whereClauses.length) {
        parts.push(`WHERE ${whereClauses.map((condition) => `(${condition})`).join(' AND ')}`);
    }

    const orderBy = orderClauses.map((clause) => `${quoteSqlIdentifier(clause.column.trim(), dialect)} ${clause.direction}`).join(', ');
    // SQL Server's OFFSET/FETCH belongs to the ORDER BY clause and cannot be written without one.
    const needsSqlServerWindow = dialect === 'sqlserver' && !usesTop && (limit !== undefined || offset > 0);

    if (orderBy) {
        parts.push(`ORDER BY ${orderBy}`);
    } else if (needsSqlServerWindow) {
        parts.push('ORDER BY (SELECT NULL)');
    }

    if (needsSqlServerWindow) {
        parts.push(`OFFSET ${offset} ROWS`);

        if (limit !== undefined) {
            parts.push(`FETCH NEXT ${limit} ROWS ONLY`);
        }

        return parts.join(' ');
    }

    if (usesTop) {
        return parts.join(' ');
    }

    // MS Access has no OFFSET at all: an offset alone cannot be expressed, so it is left out.
    if (dialect === 'msaccess') {
        return parts.join(' ');
    }

    if (dialect === 'postgresql') {
        if (limit !== undefined) {
            parts.push(`LIMIT ${limit}`);
        }

        if (offset > 0) {
            parts.push(`OFFSET ${offset}`);
        }
    } else {
        if (limit !== undefined) {
            parts.push(`LIMIT ${limit}`);
        } else if (dialect === 'mysql') {
            // A LIMIT is required before MySQL accepts the OFFSET.
            if (offset > 0) {
                parts.push(`LIMIT ${MYSQL_UNLIMITED_LIMIT}`);
            }
        } else if (offset > 0) {
            // SQLite has no bare OFFSET either, and `LIMIT -1` is its "no limit".
            parts.push('LIMIT -1');
        }

        if (offset > 0) {
            parts.push(`OFFSET ${offset}`);
        }
    }

    return parts.join(' ');
}
