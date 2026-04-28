import type { DbType } from '@utils/appClient';

type DefaultExpressionOption = {
    value: string;
    label: string;
    appliedText?: string;
    selectionStart?: number;
    selectionEnd?: number;
};

function option(label: string, value = label): DefaultExpressionOption {
    return { label, value };
}

function signatureOption(signature: string) {
    const openParenIndex = signature.indexOf('(');
    const closeParenIndex = signature.lastIndexOf(')');

    if (openParenIndex < 0 || closeParenIndex <= openParenIndex) {
        return option(signature);
    }

    const beforeArgs = signature.slice(0, openParenIndex + 1);
    const rawArgs = signature.slice(openParenIndex + 1, closeParenIndex);
    const afterArgs = signature.slice(closeParenIndex);
    const strippedArgs = rawArgs
        .split(',')
        .map((arg) => arg.trim())
        .filter(Boolean)
        .map((arg) => arg.replace(/:.*$/u, ''));
    const appliedText = `${beforeArgs}${strippedArgs.join(', ')}${afterArgs}`;
    const firstArg = strippedArgs[0];

    if (!firstArg) {
        return {
            label: signature,
            value: appliedText,
            appliedText,
        } satisfies DefaultExpressionOption;
    }

    const selectionStart = beforeArgs.length;
    const selectionEnd = selectionStart + firstArg.length;

    return {
        label: signature,
        value: appliedText,
        appliedText,
        selectionStart,
        selectionEnd,
    } satisfies DefaultExpressionOption;
}

const MYSQL_DEFAULT_EXPRESSIONS: DefaultExpressionOption[] = [
    option('NULL'),
    option('CURRENT_TIMESTAMP'),
    option('CURRENT_TIMESTAMP()'),
    option('CURRENT_DATE()'),
    option('CURRENT_TIME()'),
    option('NOW()'),
    option('LOCALTIME()'),
    option('LOCALTIMESTAMP()'),
    option('UTC_TIMESTAMP()'),
    option('UNIX_TIMESTAMP()'),
    signatureOption('UNIX_TIMESTAMP(date:date)'),
    option('UUID()'),
    signatureOption('UUID_TO_BIN(uuid_str:varchar)'),
    signatureOption('BIN_TO_UUID(binary_uuid:varchar)'),
    option('RAND()'),
    signatureOption('ABS(X:decimal)'),
    signatureOption('ACOS(X:decimal)'),
    signatureOption('ADDDATE(expr:date, days:int)'),
    signatureOption('ADDTIME(expr1:time, expr2:time)'),
    signatureOption('AES_DECRYPT(crypt_str:varchar, key_str:varchar)'),
    signatureOption('AES_ENCRYPT(str:varchar, key_str:varchar)'),
    signatureOption('ANY_VALUE(arg:any)'),
    signatureOption('Area(p:polygon)'),
    signatureOption('AsBinary(g:geometry)'),
    signatureOption('ASCII(str:varchar)'),
    signatureOption('ASIN(X:decimal)'),
    signatureOption('ATAN(X:decimal)'),
    signatureOption('ATAN2(X:decimal, Y:decimal)'),
    signatureOption('BENCHMARK(count:int, expr:any)'),
    signatureOption('BIT_AND(expr:int)'),
    signatureOption('BIT_COUNT(N:int)'),
    signatureOption('CHAR_LENGTH(str:varchar)'),
    signatureOption('COALESCE(value1:any, value2:any)'),
    signatureOption('CONCAT(str1:varchar, str2:varchar)'),
    signatureOption('CONVERT_TZ(dt:datetime, from_tz:varchar, to_tz:varchar)'),
    option('CURDATE()'),
    option('CURTIME()'),
    signatureOption('DATE(expr:date)'),
    signatureOption('DATE_ADD(date:date, INTERVAL expr unit)'),
    signatureOption('DATE_FORMAT(date:date, format:varchar)'),
    signatureOption('EXTRACT(unit FROM date)'),
    signatureOption('FROM_UNIXTIME(unix_timestamp:int)'),
    signatureOption('IF(expr:boolean, true_value:any, false_value:any)'),
    signatureOption('IFNULL(expr:any, alt_value:any)'),
    option('JSON_ARRAY()'),
    option('JSON_OBJECT()'),
    signatureOption('JSON_EXTRACT(json_doc:json, path:varchar)'),
    signatureOption('LOWER(str:varchar)'),
    signatureOption('LTRIM(str:varchar)'),
    signatureOption('MD5(str:varchar)'),
    signatureOption('REPLACE(str:varchar, from:varchar, to:varchar)'),
    signatureOption('ROUND(X:decimal)'),
    signatureOption('RTRIM(str:varchar)'),
    signatureOption('SHA2(str:varchar, hash_length:int)'),
    signatureOption('SUBSTRING(str:varchar, pos:int)'),
    signatureOption('TRIM(str:varchar)'),
    signatureOption('UPPER(str:varchar)'),
];

const POSTGRES_DEFAULT_EXPRESSIONS: DefaultExpressionOption[] = [
    option('NULL'),
    option('CURRENT_TIMESTAMP'),
    option('CURRENT_DATE'),
    option('CURRENT_TIME'),
    option('LOCALTIMESTAMP'),
    option('LOCALTIME'),
    option('now()'),
    option('transaction_timestamp()'),
    option('statement_timestamp()'),
    option('clock_timestamp()'),
    option('timeofday()'),
    option('CURRENT_USER'),
    option('SESSION_USER'),
    option('CURRENT_SCHEMA'),
    option('current_database()'),
    option('gen_random_uuid()'),
    option('uuid_generate_v4()'),
    option('random()'),
    signatureOption('nextval(sequence_name)'),
    signatureOption('to_json(value)'),
    signatureOption('json_build_object(key, value)'),
    signatureOption('jsonb_build_object(key, value)'),
    signatureOption('json_build_array(value)'),
    signatureOption('jsonb_build_array(value)'),
    signatureOption('coalesce(value1, value2)'),
    signatureOption('concat(value1, value2)'),
    signatureOption('lower(text)'),
    signatureOption('upper(text)'),
    signatureOption('trim(text)'),
    signatureOption('md5(text)'),
    signatureOption('to_char(value, format)'),
    option('make_interval()', 'make_interval()'),
    signatureOption('date_trunc(field, source)'),
    signatureOption('extract(field FROM source)'),
];

const SQLITE_DEFAULT_EXPRESSIONS: DefaultExpressionOption[] = [
    option('NULL'),
    option('CURRENT_TIMESTAMP'),
    option('CURRENT_DATE'),
    option('CURRENT_TIME'),
    option("datetime('now')"),
    option("date('now')"),
    option("time('now')"),
    option("strftime('%s','now')"),
    option('unixepoch()'),
    option('julianday()'),
    option('random()'),
    option('randomblob(16)'),
    option('lower(hex(randomblob(16)))'),
    option('hex(randomblob(16))'),
    signatureOption('coalesce(value1, value2)'),
    signatureOption('ifnull(value1, value2)'),
    option('json_array()'),
    option('json_object()'),
    signatureOption('json_extract(json, path)'),
    signatureOption('substr(text, start)'),
    signatureOption('trim(text)'),
    signatureOption('lower(text)'),
    signatureOption('upper(text)'),
    signatureOption('abs(number)'),
    signatureOption('round(number)'),
    signatureOption('length(text)'),
];

const MSACCESS_DEFAULT_EXPRESSIONS: DefaultExpressionOption[] = [
    option('NULL'),
    option('Now()'),
    option('Date()'),
    option('Time()'),
    option('Timer()'),
    option('Year(Date())'),
    option('Month(Date())'),
    option('Day(Date())'),
    option('Weekday(Date())'),
    option('Guid()'),
    option('Rnd()'),
    signatureOption('Abs(number)'),
    signatureOption('Int(number)'),
    signatureOption('Fix(number)'),
    signatureOption('Nz(value, fallback)'),
    signatureOption('UCase(text)'),
    signatureOption('LCase(text)'),
    signatureOption('Trim(text)'),
    signatureOption('Left(text, count)'),
    signatureOption('Right(text, count)'),
    signatureOption('Mid(text, start)'),
    signatureOption('Len(text)'),
    signatureOption('Format(value, format)'),
    signatureOption('IIf(condition, trueValue, falseValue)'),
];

const SQLSERVER_DEFAULT_EXPRESSIONS: DefaultExpressionOption[] = [
    option('NULL'),
    option('CURRENT_TIMESTAMP'),
    option('GETDATE()'),
    option('SYSDATETIME()'),
    option('SYSUTCDATETIME()'),
    option('NEWID()'),
    option('NEWSEQUENTIALID()'),
    option('SUSER_SNAME()'),
    option('DB_NAME()'),
    option('HOST_NAME()'),
    option('RAND()'),
    signatureOption('ABS(number)'),
    signatureOption('COALESCE(value1, value2)'),
    signatureOption('CONCAT(value1, value2)'),
    signatureOption('FORMAT(value, format)'),
    signatureOption('LOWER(text)'),
    signatureOption('UPPER(text)'),
    signatureOption('LTRIM(text)'),
    signatureOption('RTRIM(text)'),
    signatureOption('TRIM(text)'),
    signatureOption('JSON_OBJECT(key:value)'),
    signatureOption('JSON_ARRAY(value)'),
];

function getBaseDefaultExpressionOptions(driver: DbType | undefined) {
    return driver === 'mysql'
        ? MYSQL_DEFAULT_EXPRESSIONS
        : driver === 'postgresql'
          ? POSTGRES_DEFAULT_EXPRESSIONS
          : driver === 'sqlite'
            ? SQLITE_DEFAULT_EXPRESSIONS
            : driver === 'msaccess'
              ? MSACCESS_DEFAULT_EXPRESSIONS
              : SQLSERVER_DEFAULT_EXPRESSIONS;
}

export function getDbDefaultExpressionFunctionNames(driver: DbType | undefined) {
    return [
        ...new Set(
            getBaseDefaultExpressionOptions(driver)
                .map((option) => /^([A-Za-z_][\w$]*)\s*\(/u.exec(option.value)?.[1]?.toLowerCase())
                .filter(Boolean)
        ),
    ];
}

export function getDbDefaultExpressionOptions(driver: DbType | undefined, currentValue?: string | null) {
    const baseOptions = getBaseDefaultExpressionOptions(driver);

    const normalizedCurrentValue = currentValue?.trim();

    if (!normalizedCurrentValue) {
        return baseOptions;
    }

    const hasCurrentValue = baseOptions.some((option) => option.value === normalizedCurrentValue || option.label === normalizedCurrentValue);

    return hasCurrentValue ? baseOptions : [option(normalizedCurrentValue), ...baseOptions];
}
