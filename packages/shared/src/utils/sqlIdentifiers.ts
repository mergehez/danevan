import type { DbType } from '@utils/appClient';

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

export function unquoteSqlIdentifier(identifier: string) {
    const trimmedIdentifier = identifier.trim();

    if (trimmedIdentifier.startsWith('`') && trimmedIdentifier.endsWith('`') && trimmedIdentifier.length >= 2) {
        return trimmedIdentifier.slice(1, -1).replaceAll('``', '`');
    }

    if (trimmedIdentifier.startsWith('"') && trimmedIdentifier.endsWith('"') && trimmedIdentifier.length >= 2) {
        return trimmedIdentifier.slice(1, -1).replaceAll('""', '"');
    }

    if (trimmedIdentifier.startsWith('[') && trimmedIdentifier.endsWith(']') && trimmedIdentifier.length >= 2) {
        return trimmedIdentifier.slice(1, -1).replaceAll(']]', ']');
    }

    return trimmedIdentifier;
}
