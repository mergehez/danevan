/**
 * Ignore-rules for schema comparison. The same options object drives table and
 * database comparison, so the rules are grouped by the object they apply to and
 * both dialogs read one shared localStorage entry.
 */
export type ComparisonOptions = {
    table: {
        ignoreEngine: boolean;
        ignoreCollation: boolean;
    };
    columns: {
        ignoreCollation: boolean;
        ignoreNullability: boolean;
        ignoreDefaultValue: boolean;
        ignoreOnUpdate: boolean;
    };
    keys: {
        ignoreName: boolean;
    };
    foreignKeys: {
        ignoreName: boolean;
        ignoreOnDelete: boolean;
        ignoreOnUpdate: boolean;
        /** Foreign keys are advisory: by default they never count as breaking. */
        ignoreBreaking: boolean;
    };
    indexes: {
        ignoreName: boolean;
    };
};

export type ComparisonOptionId =
    | 'table.ignoreEngine'
    | 'table.ignoreCollation'
    | 'columns.ignoreCollation'
    | 'columns.ignoreNullability'
    | 'columns.ignoreDefaultValue'
    | 'columns.ignoreOnUpdate'
    | 'keys.ignoreName'
    | 'foreignKeys.ignoreName'
    | 'foreignKeys.ignoreOnDelete'
    | 'foreignKeys.ignoreOnUpdate'
    | 'foreignKeys.ignoreBreaking'
    | 'indexes.ignoreName';

type ComparisonOptionDefinition = {
    id: ComparisonOptionId;
    group: string;
    label: string;
    get: (options: ComparisonOptions) => boolean;
    set: (options: ComparisonOptions, value: boolean) => void;
};

export const comparisonOptionsStorageKey = 'schema-comparison-options';

export function createDefaultComparisonOptions(): ComparisonOptions {
    return {
        table: {
            ignoreEngine: false,
            ignoreCollation: false,
        },
        columns: {
            ignoreCollation: false,
            ignoreNullability: false,
            ignoreDefaultValue: false,
            ignoreOnUpdate: false,
        },
        keys: {
            ignoreName: false,
        },
        foreignKeys: {
            ignoreName: false,
            ignoreOnDelete: false,
            ignoreOnUpdate: false,
            ignoreBreaking: true,
        },
        indexes: {
            ignoreName: false,
        },
    };
}

/**
 * Single source of truth for the checkbox labels, their grouping and the option
 * field they toggle, so the popover never hard-codes a rule twice.
 */
export const comparisonOptionDefinitions: ComparisonOptionDefinition[] = [
    {
        id: 'table.ignoreEngine',
        group: 'Table',
        label: 'Ignore engine',
        get: (options) => options.table.ignoreEngine,
        set: (options, value) => (options.table.ignoreEngine = value),
    },
    {
        id: 'table.ignoreCollation',
        group: 'Table',
        label: 'Ignore collation',
        get: (options) => options.table.ignoreCollation,
        set: (options, value) => (options.table.ignoreCollation = value),
    },
    {
        id: 'columns.ignoreCollation',
        group: 'Columns',
        label: 'Ignore collation',
        get: (options) => options.columns.ignoreCollation,
        set: (options, value) => (options.columns.ignoreCollation = value),
    },
    {
        id: 'columns.ignoreNullability',
        group: 'Columns',
        label: 'Ignore nullability',
        get: (options) => options.columns.ignoreNullability,
        set: (options, value) => (options.columns.ignoreNullability = value),
    },
    {
        id: 'columns.ignoreDefaultValue',
        group: 'Columns',
        label: 'Ignore default value',
        get: (options) => options.columns.ignoreDefaultValue,
        set: (options, value) => (options.columns.ignoreDefaultValue = value),
    },
    {
        id: 'columns.ignoreOnUpdate',
        group: 'Columns',
        label: 'Ignore onUpdate',
        get: (options) => options.columns.ignoreOnUpdate,
        set: (options, value) => (options.columns.ignoreOnUpdate = value),
    },
    {
        id: 'keys.ignoreName',
        group: 'Keys',
        label: 'Ignore name',
        get: (options) => options.keys.ignoreName,
        set: (options, value) => (options.keys.ignoreName = value),
    },
    {
        id: 'foreignKeys.ignoreName',
        group: 'Foreign keys',
        label: 'Ignore name',
        get: (options) => options.foreignKeys.ignoreName,
        set: (options, value) => (options.foreignKeys.ignoreName = value),
    },
    {
        id: 'foreignKeys.ignoreOnDelete',
        group: 'Foreign keys',
        label: 'Ignore onDelete',
        get: (options) => options.foreignKeys.ignoreOnDelete,
        set: (options, value) => (options.foreignKeys.ignoreOnDelete = value),
    },
    {
        id: 'foreignKeys.ignoreOnUpdate',
        group: 'Foreign keys',
        label: 'Ignore onUpdate',
        get: (options) => options.foreignKeys.ignoreOnUpdate,
        set: (options, value) => (options.foreignKeys.ignoreOnUpdate = value),
    },
    {
        id: 'foreignKeys.ignoreBreaking',
        group: 'Foreign keys',
        label: 'Ignore in breaking changes',
        get: (options) => options.foreignKeys.ignoreBreaking,
        set: (options, value) => (options.foreignKeys.ignoreBreaking = value),
    },
    {
        id: 'indexes.ignoreName',
        group: 'Indexes',
        label: 'Ignore name',
        get: (options) => options.indexes.ignoreName,
        set: (options, value) => (options.indexes.ignoreName = value),
    },
];

export function getComparisonOption(options: ComparisonOptions, id: ComparisonOptionId): boolean {
    const definition = comparisonOptionDefinitions.find((entry) => entry.id === id);
    return definition ? definition.get(options) : false;
}

export function setComparisonOption(options: ComparisonOptions, id: ComparisonOptionId, value: boolean) {
    comparisonOptionDefinitions.find((entry) => entry.id === id)?.set(options, value);
}

export function toggleComparisonOption(options: ComparisonOptions, id: ComparisonOptionId) {
    setComparisonOption(options, id, !getComparisonOption(options, id));
}

/** Keeps only known boolean fields so a stale or hand-edited entry cannot break comparison. */
export function normalizeComparisonOptions(rawValue: unknown): ComparisonOptions {
    const options = createDefaultComparisonOptions();

    if (!rawValue || typeof rawValue !== 'object') {
        return options;
    }

    const raw = rawValue as Record<string, Record<string, unknown>>;

    for (const definition of comparisonOptionDefinitions) {
        const [group, key] = definition.id.split('.');
        const value = raw[group]?.[key];

        if (typeof value === 'boolean') {
            definition.set(options, value);
        }
    }

    return options;
}

export function readComparisonOptions(): ComparisonOptions {
    if (typeof localStorage === 'undefined') {
        return createDefaultComparisonOptions();
    }

    try {
        const rawValue = localStorage.getItem(comparisonOptionsStorageKey);
        return rawValue ? normalizeComparisonOptions(JSON.parse(rawValue)) : createDefaultComparisonOptions();
    } catch {
        return createDefaultComparisonOptions();
    }
}

export function writeComparisonOptions(options: ComparisonOptions) {
    try {
        localStorage.setItem(comparisonOptionsStorageKey, JSON.stringify(options));
    } catch {
        // Best-effort persistence only: a full or unavailable storage must not break comparison.
    }
}

/** Deep, sanitized copy — also used to seed the reactive options object. */
export function cloneComparisonOptions(options: ComparisonOptions): ComparisonOptions {
    return normalizeComparisonOptions(options);
}
