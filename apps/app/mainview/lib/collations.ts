import type { DbType } from '@utils/appClient';

function normalizeOptionalText(value: string | null | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function readScalarText(value: unknown) {
    if (typeof value === 'string') {
        return normalizeOptionalText(value);
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return normalizeOptionalText(value.toString());
    }

    return null;
}

export function getDbCollationOptionsQuery(driver: DbType | undefined) {
    if (driver === 'mysql') {
        return 'SHOW COLLATION;';
    }

    if (driver === 'postgresql') {
        return 'SELECT collname AS name FROM pg_collation ORDER BY collname;';
    }

    if (driver === 'sqlite') {
        return 'PRAGMA collation_list;';
    }

    return undefined;
}

export function normalizeDbCollationOptions(driver: DbType | undefined, rows: Array<Record<string, unknown>>) {
    const options = rows
        .map((row) => {
            if (driver === 'mysql') {
                return readScalarText(row.Collation ?? row.collation);
            }

            if (driver === 'postgresql') {
                return readScalarText(row.name ?? row.collname);
            }

            if (driver === 'sqlite') {
                return readScalarText(row.name ?? row.seqname);
            }

            return null;
        })
        .filter((value): value is string => !!value);

    return [...new Set(options)].sort((left, right) => left.localeCompare(right));
}

export function getDbCollationOptions(baseOptions: string[], currentValue?: string | null) {
    const normalizedCurrentValue = currentValue?.trim();

    const opts = [...(!normalizedCurrentValue || baseOptions.includes(normalizedCurrentValue) ? [] : [normalizedCurrentValue]), ...baseOptions];

    return opts.map((value) => ({ value: value, label: value }));
}
