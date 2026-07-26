const SQL_UNICODE_SPACE_PATTERN = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF]/gu;
const SQL_ZERO_WIDTH_PATTERN = /(?:\u{200B}|\u{200C}|\u{200D}|\u{2060})/gu;

export function normalizeSqlInputWhitespace(sql: string) {
    return sql.replace(SQL_UNICODE_SPACE_PATTERN, ' ').replace(SQL_ZERO_WIDTH_PATTERN, '');
}

export function hasSuspiciousSqlWhitespace(sql: string) {
    return SQL_UNICODE_SPACE_PATTERN.test(sql) || SQL_ZERO_WIDTH_PATTERN.test(sql);
}
