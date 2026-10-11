/**
 * Names the one table a row-returning statement reads from, so an edit made in the grid can be
 * written back to the table the rows actually came from. The alternative — picking whichever known
 * table happens to share the result's column names — sent updates to an unrelated table.
 *
 * Only a statement whose source is unambiguous is answered: a join, a comma-separated table list, a
 * derived table, a set operation or a common table expression reads from more than one place (or
 * from none), and a caller that cannot name the table must refuse the edit instead of guessing.
 */
export type SingleSourceTable = {
    /** The table name as written, without a schema/database qualifier. */
    tableName: string;
    /** The qualifier of a `schema.table` reference, if the statement wrote one. */
    qualifier?: string;
};

type SqlToken = {
    value: string;
    quoted: boolean;
};

const CLAUSE_END_KEYWORDS = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'WINDOW', 'QUALIFY', 'RETURNING', 'FOR']);
const SET_OPERATOR_KEYWORDS = new Set(['UNION', 'EXCEPT', 'INTERSECT']);
/** Every keyword that adds a second table to the FROM clause, `JOIN` itself included. */
const SECOND_TABLE_KEYWORDS = new Set(['JOIN', 'STRAIGHT_JOIN', 'APPLY']);

const IDENTIFIER_PATTERN = /^[A-Za-z_@][A-Za-z0-9_$@]*$/;

/** Splits SQL into tokens, dropping comments and string literals (their contents can spell `from`). */
function tokenizeSql(sql: string): SqlToken[] {
    const tokens: SqlToken[] = [];
    let index = 0;

    while (index < sql.length) {
        const character = sql[index];
        const next = sql[index + 1];

        if (/\s/.test(character)) {
            index += 1;
            continue;
        }

        if ((character === '-' && next === '-') || character === '#') {
            const lineEnd = sql.indexOf('\n', index);
            index = lineEnd === -1 ? sql.length : lineEnd + 1;
            continue;
        }

        if (character === '/' && next === '*') {
            const blockEnd = sql.indexOf('*/', index + 2);
            index = blockEnd === -1 ? sql.length : blockEnd + 2;
            continue;
        }

        if (character === "'") {
            index += 1;
            while (index < sql.length) {
                if (sql[index] === "'" && sql[index + 1] === "'") {
                    index += 2;
                    continue;
                }
                if (sql[index] === "'") {
                    index += 1;
                    break;
                }
                index += 1;
            }
            continue;
        }

        if (character === '"' || character === '`' || character === '[') {
            const closing = character === '[' ? ']' : character;
            let value = '';
            index += 1;
            while (index < sql.length) {
                if (sql[index] === closing && sql[index + 1] === closing) {
                    value += closing;
                    index += 2;
                    continue;
                }
                if (sql[index] === closing) {
                    index += 1;
                    break;
                }
                value += sql[index];
                index += 1;
            }
            tokens.push({ value: value, quoted: true });
            continue;
        }

        if (IDENTIFIER_PATTERN.test(character)) {
            let value = '';
            while (index < sql.length && /[A-Za-z0-9_$@]/.test(sql[index])) {
                value += sql[index];
                index += 1;
            }
            tokens.push({ value: value, quoted: false });
            continue;
        }

        tokens.push({ value: character, quoted: false });
        index += 1;
    }

    return tokens;
}

function isAllowedQualifier(qualifier: string, allowedQualifiers: string[] | undefined) {
    if (!allowedQualifiers?.length) {
        return false;
    }

    const normalized = qualifier.toLowerCase();

    return allowedQualifiers.some((allowed) => allowed.toLowerCase() === normalized);
}

/**
 * Reads the table of a statement like `select ... from people`, or returns undefined when the
 * statement is not a plain single-table select. `allowedQualifiers` lists the schema/database names
 * a `qualifier.table` reference may carry; anything else cannot be resolved to a table of the
 * connection being edited, so it is refused rather than pointed at a same-named local table.
 */
export function findSingleSourceTable(sql: string, options?: { allowedQualifiers?: string[] }): SingleSourceTable | undefined {
    const tokens = tokenizeSql(sql);

    if (tokens[0]?.quoted || tokens[0]?.value.toUpperCase() !== 'SELECT') {
        return undefined;
    }

    // The outer query is the one at parenthesis depth 0: a subquery's FROM must not answer for it.
    let depth = 0;
    let fromIndex = -1;
    let statementEnd = tokens.length;

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];

        if (!token.quoted && token.value === '(') {
            depth += 1;
            continue;
        }

        if (!token.quoted && token.value === ')') {
            depth -= 1;
            continue;
        }

        if (depth !== 0 || token.quoted) {
            continue;
        }

        if (token.value === ';') {
            // More than one statement: the caller must name the one its rows came from.
            if (index !== tokens.length - 1) {
                return undefined;
            }
            statementEnd = index;
            break;
        }

        const keyword = token.value.toUpperCase();

        if (SET_OPERATOR_KEYWORDS.has(keyword)) {
            return undefined;
        }

        if (keyword === 'FROM' && fromIndex === -1) {
            fromIndex = index;
        }
    }

    if (fromIndex === -1) {
        return undefined;
    }

    let index = fromIndex + 1;

    if (index >= statementEnd || tokens[index].value === '(') {
        return undefined;
    }

    // PostgreSQL's `FROM ONLY table` still reads the one table.
    if (!tokens[index].quoted && tokens[index].value.toUpperCase() === 'ONLY') {
        index += 1;
    }

    if (index >= statementEnd || tokens[index].value === '(') {
        return undefined;
    }

    const firstPart = tokens[index];

    if (!firstPart.quoted && !IDENTIFIER_PATTERN.test(firstPart.value)) {
        return undefined;
    }

    const parts = [firstPart.value];
    index += 1;

    while (index < statementEnd && tokens[index].value === '.') {
        const part = tokens[index + 1];

        if (!part || (!part.quoted && !IDENTIFIER_PATTERN.test(part.value))) {
            return undefined;
        }

        parts.push(part.value);
        index += 2;
    }

    // `from json_each(...)`: a table-valued function, not a table.
    if (index < statementEnd && tokens[index].value === '(') {
        return undefined;
    }

    const qualifier = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;

    if (qualifier && !isAllowedQualifier(qualifier, options?.allowedQualifiers)) {
        return undefined;
    }

    // One more table at the outer level (a join, or a comma list) makes the source ambiguous.
    let clauseDepth = 0;

    for (let scan = index; scan < statementEnd; scan += 1) {
        const token = tokens[scan];

        if (!token.quoted && token.value === '(') {
            clauseDepth += 1;
            continue;
        }

        if (!token.quoted && token.value === ')') {
            clauseDepth -= 1;
            continue;
        }

        if (clauseDepth !== 0 || token.quoted) {
            continue;
        }

        if (token.value === ',') {
            return undefined;
        }

        const keyword = token.value.toUpperCase();

        if (SECOND_TABLE_KEYWORDS.has(keyword)) {
            return undefined;
        }

        if (CLAUSE_END_KEYWORDS.has(keyword)) {
            break;
        }
    }

    return { tableName: parts[parts.length - 1]!, qualifier: qualifier };
}
