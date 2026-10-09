import type { DbType } from '../types';

function quoteSqlIdentifierPart(identifierPart: string, dialect: DbType) {
    if (dialect === 'mysql') {
        return `\`${identifierPart.replaceAll('`', '``')}\``;
    }

    if (dialect === 'msaccess' || dialect === 'sqlserver') {
        return `[${identifierPart.replaceAll(']', ']]')}]`;
    }

    return `"${identifierPart.replaceAll('"', '""')}"`;
}

export function quoteSqlIdentifier(identifier: string, dialect: DbType) {
    return identifier
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => quoteSqlIdentifierPart(part, dialect))
        .join('.');
}

/** Splits a qualified name on the dots between its parts, ignoring dots inside quotes or brackets. */
function splitQualifiedIdentifier(identifier: string) {
    const parts: string[] = [];
    let currentPart = '';
    let closingQuote: '`' | '"' | ']' | undefined;

    for (let index = 0; index < identifier.length; index += 1) {
        const character = identifier[index]!;

        if (closingQuote) {
            currentPart += character;

            if (character === closingQuote) {
                // A doubled quote is an escaped quote, not the end of the part.
                if (identifier[index + 1] === closingQuote) {
                    currentPart += closingQuote;
                    index += 1;
                } else {
                    closingQuote = undefined;
                }
            }

            continue;
        }

        if (character === '.') {
            parts.push(currentPart);
            currentPart = '';
            continue;
        }

        if (character === '`' || character === '"' || character === '[') {
            closingQuote = character === '[' ? ']' : character;
        }

        currentPart += character;
    }

    parts.push(currentPart);

    return parts;
}

function unquoteIdentifierPart(identifierPart: string) {
    const trimmedPart = identifierPart.trim();

    if (trimmedPart.length < 2) {
        return trimmedPart;
    }

    if (trimmedPart.startsWith('`') && trimmedPart.endsWith('`')) {
        return trimmedPart.slice(1, -1).replaceAll('``', '`');
    }

    if (trimmedPart.startsWith('"') && trimmedPart.endsWith('"')) {
        return trimmedPart.slice(1, -1).replaceAll('""', '"');
    }

    if (trimmedPart.startsWith('[') && trimmedPart.endsWith(']')) {
        return trimmedPart.slice(1, -1).replaceAll(']]', ']');
    }

    return trimmedPart;
}

/** Mirrors `quoteSqlIdentifier`: every part of a qualified name is unquoted. */
export function unquoteSqlIdentifier(identifier: string) {
    return splitQualifiedIdentifier(identifier.trim()).map(unquoteIdentifierPart).join('.');
}
