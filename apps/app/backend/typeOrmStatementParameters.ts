export function prepareTypeOrmParameterizedStatement(sqlText: string, createPlaceholder: (index: number) => string) {
    let nextParamIndex = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBracketIdentifier = false;
    let inLineComment = false;
    let inBlockComment = false;
    let transformedSql = '';

    for (let index = 0; index < sqlText.length; index += 1) {
        const character = sqlText[index]!;
        const nextCharacter = sqlText[index + 1];

        if (inLineComment) {
            transformedSql += character;

            if (character === '\n') {
                inLineComment = false;
            }

            continue;
        }

        if (inBlockComment) {
            transformedSql += character;

            if (character === '*' && nextCharacter === '/') {
                transformedSql += '/';
                index += 1;
                inBlockComment = false;
            }

            continue;
        }

        if (!inSingleQuote && !inDoubleQuote && !inBracketIdentifier && character === '-' && nextCharacter === '-') {
            transformedSql += '--';
            index += 1;
            inLineComment = true;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote && !inBracketIdentifier && character === '/' && nextCharacter === '*') {
            transformedSql += '/*';
            index += 1;
            inBlockComment = true;
            continue;
        }

        if (!inDoubleQuote && !inBracketIdentifier && character === "'") {
            transformedSql += character;

            if (inSingleQuote && nextCharacter === "'") {
                transformedSql += "'";
                index += 1;
            } else {
                inSingleQuote = !inSingleQuote;
            }

            continue;
        }

        if (!inSingleQuote && !inBracketIdentifier && character === '"') {
            transformedSql += character;
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote && character === '[') {
            transformedSql += character;
            inBracketIdentifier = true;
            continue;
        }

        if (inBracketIdentifier && character === ']') {
            transformedSql += character;

            if (nextCharacter === ']') {
                transformedSql += ']';
                index += 1;
            } else {
                inBracketIdentifier = false;
            }

            continue;
        }

        if (!inSingleQuote && !inDoubleQuote && !inBracketIdentifier && character === '?') {
            transformedSql += createPlaceholder(nextParamIndex);
            nextParamIndex += 1;
            continue;
        }

        transformedSql += character;
    }

    return {
        sql: transformedSql,
        paramCount: nextParamIndex,
    };
}
