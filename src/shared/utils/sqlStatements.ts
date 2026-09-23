/**
 * Splits a SQL script into individual statements at the top level, while
 * ignoring `;` characters that appear inside string literals, quoted
 * identifiers, and both line (`--`) and block (`/* ... *\/`) comments.
 *
 * Statements that contain no executable SQL (only comments/whitespace) are
 * omitted so empty queries aren't sent to the database.
 */
export function splitSqlStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let hasSqlContent = false;

    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (inLineComment) {
            current += ch;
            if (ch === '\n') {
                inLineComment = false;
            }
            i += 1;
            continue;
        }

        if (inBlockComment) {
            current += ch;
            if (ch === '*' && next === '/') {
                current += next;
                i += 2;
                inBlockComment = false;
            } else {
                i += 1;
            }
            continue;
        }

        if (inSingleQuote) {
            current += ch;
            if (ch === "'") {
                if (next === "'") {
                    current += next;
                    i += 2;
                    continue;
                }
                inSingleQuote = false;
            }
            i += 1;
            continue;
        }

        if (inDoubleQuote) {
            current += ch;
            if (ch === '"') {
                if (next === '"') {
                    current += next;
                    i += 2;
                    continue;
                }
                inDoubleQuote = false;
            }
            i += 1;
            continue;
        }

        if (inBacktick) {
            current += ch;
            if (ch === '`') {
                if (next === '`') {
                    current += next;
                    i += 2;
                    continue;
                }
                inBacktick = false;
            }
            i += 1;
            continue;
        }

        // Outside quotes/comments — detect comment/quote openers and the
        // statement delimiter.
        if (ch === '-' && next === '-') {
            inLineComment = true;
            current += ch + next;
            i += 2;
            continue;
        }

        if (ch === '#') {
            inLineComment = true;
            current += ch;
            i += 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            current += ch + next;
            i += 2;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            current += ch;
            i += 1;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            current += ch;
            i += 1;
            continue;
        }

        if (ch === '`') {
            inBacktick = true;
            current += ch;
            i += 1;
            continue;
        }

        if (ch === ';') {
            if (hasSqlContent) {
                const statement = current.trim();
                if (statement) {
                    statements.push(statement);
                }
            }
            current = '';
            hasSqlContent = false;
            i += 1;
            continue;
        }

        if (!/\s/.test(ch)) {
            hasSqlContent = true;
        }
        current += ch;
        i += 1;
    }

    if (hasSqlContent && current.trim()) {
        statements.push(current.trim());
    }

    return statements;
}
