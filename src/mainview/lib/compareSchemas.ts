import type { TableColumnInfo, TableForeignKeyInfo, TableIndexInfo, TableInfo } from '../../shared/types';
import type { ComparisonOptions } from './comparisonOptions';

export type ComparisonStatus = 'identical' | 'changed' | 'added' | 'removed';

/**
 * `added` means the object exists in the source only (the target is missing it);
 * `removed` means it exists in the target only. The UI and the Markdown export
 * state that legend next to the results.
 */
export type ComparisonSection = {
    id: string;
    title: string;
    columns: string[];
    rows: Array<Record<string, string>>;
    differenceCount: number;
    /** Replaces the "N differences" header text when a section counts something else (e.g. tables). */
    summary?: string;
    /** Additive fix for the row at the same index, when one side is missing the object. */
    actions?: Array<ComparisonFixAction | undefined>;
};

/**
 * What an added/removed row copies into the side that is missing the object.
 * Fixes are additive only: nothing is ever dropped or altered.
 */
export type ComparisonFixAction = {
    kind: 'add-column' | 'add-key' | 'add-foreign-key' | 'add-index' | 'create-table';
    /** The side that is missing the object and will receive it. */
    destination: 'source' | 'target';
    /** Table on the destination side that receives the object. */
    tableName: string;
    /** Human label for tooltips and the confirmation dialog, e.g. `column "email" (varchar(255))`. */
    label: string;
    column?: TableColumnInfo;
    key?: {
        name: string;
        isPrimary: boolean;
        columns: string[];
        /** Raw index behind a unique key; absent for the primary key. */
        index?: TableIndexInfo;
        /** Raw primary-key columns, with their ordinals; absent for a unique key. */
        primaryColumns?: TableColumnInfo[];
    };
    foreignKeys?: TableForeignKeyInfo[];
    index?: TableIndexInfo;
};

/** A difference that can break data or consumers when the target is brought in line with the source. */
export type BreakingChange = {
    id: string;
    text: string;
};

export type ComparisonResult = {
    sections: ComparisonSection[];
    breakingChanges: BreakingChange[];
    /** Differences that would be breaking if the foreign-key ignore option were off. */
    ignoredBreakingCount: number;
};

type ComparisonGroupId = 'table' | 'columns' | 'keys' | 'foreignKeys' | 'indexes';

type ComparisonEntry = {
    group: ComparisonGroupId;
    object: string;
    attribute: string;
    source: string;
    target: string;
    status: ComparisonStatus;
    /** Raw object on each side, so the breaking-change rules can inspect attributes the display strings lose. */
    sourceItem?: unknown;
    targetItem?: unknown;
    /** Additive fix for a row where one side is missing the object entirely. */
    action?: ComparisonFixAction;
};

type ComparisonGroup = {
    id: ComparisonGroupId;
    title: string;
    objectColumn: string;
};

const COMPARISON_GROUPS: ComparisonGroup[] = [
    { id: 'table', title: 'Table', objectColumn: 'Object' },
    { id: 'columns', title: 'Columns', objectColumn: 'Column' },
    { id: 'keys', title: 'Keys', objectColumn: 'Key' },
    { id: 'foreignKeys', title: 'Foreign keys', objectColumn: 'Foreign key' },
    { id: 'indexes', title: 'Indexes', objectColumn: 'Index' },
];

const EMPTY_VALUE = '—';

/** The database-comparison overview section lists every table by name. */
export const databaseOverviewSectionId = 'tables';

export type DerivedKey = {
    name: string;
    isPrimary: boolean;
    columns: string[];
};

export type DerivedForeignKey = {
    name: string;
    targetTable: string;
    columns: Array<{ from: string; to: string }>;
    onDelete: string;
    onUpdate: string;
    match: string;
};

/* -------------------------------------------------------------------------- */
/* Value normalization                                                        */
/* -------------------------------------------------------------------------- */

function normalizeText(value: string | null | undefined): string {
    return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isWrappedInParentheses(text: string): boolean {
    let depth = 0;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth -= 1;

            if (depth === 0) {
                return index === text.length - 1;
            }
        }
    }

    return false;
}

/**
 * Drivers report the same default in several spellings (`CURRENT_TIMESTAMP`,
 * `current_timestamp()`, `(0)`); collapse those so only real differences show.
 */
function normalizeExpression(value: string | null | undefined): string {
    let text = normalizeText(value);

    while (text.startsWith('(') && text.endsWith(')') && isWrappedInParentheses(text)) {
        text = text.slice(1, -1).trim();
    }

    return text.replace(/\(\)$/, '');
}

function normalizeBoolean(value: boolean): string {
    return value ? 'yes' : 'no';
}

function display(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return EMPTY_VALUE;
    }

    if (typeof value === 'boolean') {
        return normalizeBoolean(value);
    }

    const text = String(value).trim();
    return text ? text : EMPTY_VALUE;
}

function statusOf(sourceExists: boolean, targetExists: boolean, equal: boolean): ComparisonStatus {
    if (!sourceExists) {
        return 'removed';
    }

    if (!targetExists) {
        return 'added';
    }

    return equal ? 'identical' : 'changed';
}

/* -------------------------------------------------------------------------- */
/* Schema derivation (mirrors how ModifyTable separates keys from indexes)     */
/* -------------------------------------------------------------------------- */

function getPrimaryKeyColumns(tableInfo: TableInfo): string[] {
    return [...tableInfo.columns]
        .filter((column) => column.isPrimaryKey)
        .sort((left, right) => (left.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.primaryKeyOrdinal ?? Number.MAX_SAFE_INTEGER))
        .map((column) => column.name);
}

function isPrimaryIndex(index: TableIndexInfo, primaryKeyColumns: string[]): boolean {
    if (index.name.toLowerCase() === 'primary') {
        return true;
    }

    return (
        primaryKeyColumns.length > 0 &&
        index.columns.length === primaryKeyColumns.length &&
        index.columns.every((columnName, position) => normalizeText(columnName) === normalizeText(primaryKeyColumns[position]))
    );
}

/** Primary key plus every unique key; unique keys are not repeated under Indexes. */
export function deriveTableKeys(tableInfo: TableInfo): DerivedKey[] {
    const primaryKeyColumns = getPrimaryKeyColumns(tableInfo);
    const keys: DerivedKey[] = [];

    if (primaryKeyColumns.length > 0) {
        keys.push({ name: 'PRIMARY', isPrimary: true, columns: primaryKeyColumns });
    }

    for (const index of tableInfo.indexes) {
        if (!index.isUnique || isPrimaryIndex(index, primaryKeyColumns)) {
            continue;
        }

        keys.push({ name: index.name, isPrimary: false, columns: [...index.columns] });
    }

    return keys;
}

export function deriveTableForeignKeys(tableInfo: TableInfo): DerivedForeignKey[] {
    const groups = new Map<string, TableForeignKeyInfo[]>();

    for (const foreignKey of tableInfo.foreignKeys) {
        const groupKey = foreignKey.name ?? String(foreignKey.id);
        const group = groups.get(groupKey) ?? [];
        group.push(foreignKey);
        groups.set(groupKey, group);
    }

    return [...groups.entries()].map(([name, group]) => {
        const sortedGroup = [...group].sort((left, right) => left.sequence - right.sequence);

        return {
            name,
            targetTable: sortedGroup[0]?.table ?? '',
            columns: sortedGroup.map((foreignKey) => ({ from: foreignKey.from, to: foreignKey.to })),
            onDelete: sortedGroup[0]?.onDelete ?? '',
            onUpdate: sortedGroup[0]?.onUpdate ?? '',
            match: sortedGroup[0]?.match ?? '',
        } satisfies DerivedForeignKey;
    });
}

/** Non-unique indexes that are not already reported as a key. */
export function deriveStandaloneIndexes(tableInfo: TableInfo): TableIndexInfo[] {
    const keyNames = new Set(deriveTableKeys(tableInfo).map((key) => normalizeText(key.name)));
    const primaryKeyColumns = getPrimaryKeyColumns(tableInfo);

    return tableInfo.indexes.filter((index) => !index.isUnique && !keyNames.has(normalizeText(index.name)) && !isPrimaryIndex(index, primaryKeyColumns));
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

type MatchedPair<T> = { key: string; source?: T; target?: T };

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const key = keyOf(item);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    }

    return groups;
}

/**
 * Pairs objects by a structural signature (columns, or columns + target table),
 * so differently named but equivalent keys still line up and their name shows
 * up as a regular attribute. Repeated signatures pair up positionally.
 */
function matchBySignature<T>(sourceItems: T[], targetItems: T[], signatureOf: (item: T) => string): MatchedPair<T>[] {
    const sourceGroups = groupBy(sourceItems, signatureOf);
    const targetGroups = groupBy(targetItems, signatureOf);
    const signatures = [...sourceGroups.keys(), ...[...targetGroups.keys()].filter((signature) => !sourceGroups.has(signature))];
    const pairs: MatchedPair<T>[] = [];

    for (const signature of signatures) {
        const sources = sourceGroups.get(signature) ?? [];
        const targets = targetGroups.get(signature) ?? [];
        const count = Math.max(sources.length, targets.length);

        for (let index = 0; index < count; index += 1) {
            pairs.push({
                key: count > 1 ? `${signature}#${index + 1}` : signature,
                source: sources[index],
                target: targets[index],
            });
        }
    }

    return pairs;
}

function columnSignature(columns: string[]): string {
    return columns.map((column) => normalizeText(column)).join(',');
}

function foreignKeySignature(foreignKey: DerivedForeignKey): string {
    return `${normalizeText(foreignKey.targetTable)}|${foreignKey.columns.map((column) => `${normalizeText(column.from)}>${normalizeText(column.to)}`).join(',')}`;
}

/* -------------------------------------------------------------------------- */
/* Entry collection                                                           */
/* -------------------------------------------------------------------------- */

type AttributeDefinition<T> = {
    attribute: string;
    ignored: boolean;
    /** Normalized value used for equality. */
    valueOf: (item: T) => string;
    /** Raw value shown in the results; falls back to the normalized value when casing does not matter. */
    displayOf?: (item: T) => string | null | undefined;
};

function collectAttributeEntries<T>(
    group: ComparisonGroupId,
    objectOf: (pair: MatchedPair<T>) => string,
    summaryOf: (item: T | undefined) => string,
    pairs: MatchedPair<T>[],
    attributes: Array<AttributeDefinition<T>>,
    fixOf?: (item: T, side: 'source' | 'target') => ComparisonFixAction
): ComparisonEntry[] {
    const entries: ComparisonEntry[] = [];
    const activeAttributes = attributes.filter((attribute) => !attribute.ignored);

    for (const pair of pairs) {
        const object = objectOf(pair);
        const sourceExists = pair.source !== undefined;
        const targetExists = pair.target !== undefined;

        if (!sourceExists || !targetExists) {
            const donorSide = sourceExists ? 'source' : 'target';
            const donorItem = (sourceExists ? pair.source : pair.target) as T;

            entries.push({
                group,
                object,
                attribute: '',
                source: sourceExists ? summaryOf(pair.source) : EMPTY_VALUE,
                target: targetExists ? summaryOf(pair.target) : EMPTY_VALUE,
                status: statusOf(sourceExists, targetExists, false),
                sourceItem: pair.source,
                targetItem: pair.target,
                action: fixOf?.(donorItem, donorSide),
            });
            continue;
        }

        const source = pair.source as T;
        const target = pair.target as T;
        const attributeRows: ComparisonEntry[] = [];
        let changed = false;

        for (const attribute of activeAttributes) {
            const sourceValue = attribute.valueOf(source);
            const targetValue = attribute.valueOf(target);
            const equal = sourceValue === targetValue;
            const sourceDisplay = attribute.displayOf ? attribute.displayOf(source) : sourceValue;
            const targetDisplay = attribute.displayOf ? attribute.displayOf(target) : targetValue;

            if (!equal) {
                changed = true;
            }

            attributeRows.push({
                group,
                object,
                attribute: attribute.attribute,
                source: display(sourceDisplay),
                target: display(targetDisplay),
                status: equal ? 'identical' : 'changed',
                sourceItem: source,
                targetItem: target,
            });
        }

        // Every attribute is ignored: the pair carries no visible information.
        if (attributeRows.length === 0) {
            continue;
        }

        if (changed) {
            entries.push(...attributeRows);
            continue;
        }

        // One summarizing row keeps "show identical" readable instead of
        // repeating every matching attribute.
        entries.push({
            group,
            object,
            attribute: '',
            source: summaryOf(source),
            target: summaryOf(target),
            status: 'identical',
            sourceItem: source,
            targetItem: target,
        });
    }

    return entries;
}

function collectTableAttributeEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    const attributes: Array<AttributeDefinition<TableInfo>> = [
        { attribute: 'engine', ignored: options.table.ignoreEngine, valueOf: (table) => normalizeText(table.engine), displayOf: (table) => table.engine },
        { attribute: 'collation', ignored: options.table.ignoreCollation, valueOf: (table) => normalizeText(table.collation), displayOf: (table) => table.collation },
    ];

    return collectAttributeEntries<TableInfo>(
        'table',
        () => 'table',
        (table) => display(table?.engine ?? table?.collation),
        [{ key: 'table', source, target }],
        attributes
    );
}

function describeColumn(column: TableColumnInfo): string {
    const parts = [column.type || 'untyped'];

    if (column.notNull) {
        parts.push('not null');
    }

    if (column.defaultValue) {
        parts.push(`default ${column.defaultValue}`);
    }

    if (column.isPrimaryKey) {
        parts.push('primary key');
    }

    if (column.isAutoIncrement) {
        parts.push('auto increment');
    }

    return parts.join(', ');
}

function collectColumnEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    const attributes: Array<AttributeDefinition<TableColumnInfo>> = [
        { attribute: 'type', ignored: false, valueOf: (column) => normalizeText(column.type), displayOf: (column) => column.type },
        {
            attribute: 'default',
            ignored: options.columns.ignoreDefaultValue,
            valueOf: (column) => normalizeExpression(column.defaultValue),
            displayOf: (column) => column.defaultValue,
        },
        { attribute: 'nullable', ignored: options.columns.ignoreNullability, valueOf: (column) => normalizeBoolean(!column.notNull) },
        { attribute: 'primary key', ignored: false, valueOf: (column) => normalizeBoolean(column.isPrimaryKey) },
        { attribute: 'collation', ignored: options.columns.ignoreCollation, valueOf: (column) => normalizeText(column.collation), displayOf: (column) => column.collation },
        { attribute: 'auto increment', ignored: false, valueOf: (column) => normalizeBoolean(column.isAutoIncrement) },
        { attribute: 'on update', ignored: options.columns.ignoreOnUpdate, valueOf: (column) => normalizeText(column.onUpdate), displayOf: (column) => column.onUpdate },
    ];
    const pairs = matchBySignature(source.columns, target.columns, (column) => normalizeText(column.name));
    const fixOf = (column: TableColumnInfo, side: 'source' | 'target'): ComparisonFixAction => ({
        kind: 'add-column',
        destination: side === 'source' ? 'target' : 'source',
        tableName: side === 'source' ? target.name : source.name,
        label: `column "${column.name}" (${describeColumn(column)})`,
        column,
    });

    // Column names are the match key, so show the source spelling (the tree the
    // user right-clicked) and keep the target spelling in the header row label.
    return collectAttributeEntries<TableColumnInfo>(
        'columns',
        (pair) => pair.source?.name ?? pair.target?.name ?? pair.key,
        (column) => display(column?.type),
        pairs,
        attributes,
        fixOf
    );
}

function collectKeyEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    const attributes: Array<AttributeDefinition<DerivedKey>> = [
        { attribute: 'name', ignored: options.keys.ignoreName, valueOf: (key) => normalizeText(key.name), displayOf: (key) => key.name },
        { attribute: 'primary', ignored: false, valueOf: (key) => normalizeBoolean(key.isPrimary) },
    ];
    const pairs = matchBySignature(deriveTableKeys(source), deriveTableKeys(target), (key) => columnSignature(key.columns));
    const fixOf = (key: DerivedKey, side: 'source' | 'target'): ComparisonFixAction => {
        const donor = side === 'source' ? source : target;
        const index = key.isPrimary ? undefined : donor.indexes.find((entry) => normalizeText(entry.name) === normalizeText(key.name));
        const primaryColumns = key.isPrimary ? donor.columns.filter((column) => column.isPrimaryKey) : undefined;

        return {
            kind: 'add-key',
            destination: side === 'source' ? 'target' : 'source',
            tableName: side === 'source' ? target.name : source.name,
            label: key.isPrimary ? `primary key (${key.columns.join(', ')})` : `unique key "${key.name}" (${key.columns.join(', ')})`,
            key: { name: key.name, isPrimary: key.isPrimary, columns: key.columns, index, primaryColumns },
        };
    };

    return collectAttributeEntries<DerivedKey>(
        'keys',
        (pair) => pair.source?.name ?? pair.target?.name ?? pair.key,
        (key) => display(key?.columns.join(', ')),
        pairs,
        attributes,
        fixOf
    );
}

function collectForeignKeyEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    const attributes: Array<AttributeDefinition<DerivedForeignKey>> = [
        { attribute: 'name', ignored: options.foreignKeys.ignoreName, valueOf: (foreignKey) => normalizeText(foreignKey.name), displayOf: (foreignKey) => foreignKey.name },
        {
            attribute: 'on delete',
            ignored: options.foreignKeys.ignoreOnDelete,
            valueOf: (foreignKey) => normalizeExpression(foreignKey.onDelete),
            displayOf: (foreignKey) => foreignKey.onDelete,
        },
        {
            attribute: 'on update',
            ignored: options.foreignKeys.ignoreOnUpdate,
            valueOf: (foreignKey) => normalizeExpression(foreignKey.onUpdate),
            displayOf: (foreignKey) => foreignKey.onUpdate,
        },
    ];
    const pairs = matchBySignature(deriveTableForeignKeys(source), deriveTableForeignKeys(target), foreignKeySignature);
    const fixOf = (foreignKey: DerivedForeignKey, side: 'source' | 'target'): ComparisonFixAction => {
        const donor = side === 'source' ? source : target;
        const rows = donor.foreignKeys.filter((entry) => (entry.name ?? String(entry.id)) === foreignKey.name);

        return {
            kind: 'add-foreign-key',
            destination: side === 'source' ? 'target' : 'source',
            tableName: side === 'source' ? target.name : source.name,
            label: `foreign key "${foreignKey.name}" (${foreignKey.columns.map((column) => `${column.from} → ${foreignKey.targetTable}.${column.to}`).join(', ')})`,
            foreignKeys: rows,
        };
    };

    return collectAttributeEntries<DerivedForeignKey>(
        'foreignKeys',
        (pair) => pair.source?.name ?? pair.target?.name ?? pair.key,
        (foreignKey) => (foreignKey ? display(`${foreignKey.columns.map((column) => column.from).join(', ')} → ${foreignKey.targetTable}`) : EMPTY_VALUE),
        pairs,
        attributes,
        fixOf
    );
}

function collectIndexEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    const attributes: Array<AttributeDefinition<TableIndexInfo>> = [
        { attribute: 'name', ignored: options.indexes.ignoreName, valueOf: (index) => normalizeText(index.name), displayOf: (index) => index.name },
        { attribute: 'type', ignored: false, valueOf: (index) => normalizeText(index.type), displayOf: (index) => index.type },
        { attribute: 'unique', ignored: false, valueOf: (index) => normalizeBoolean(index.isUnique) },
    ];
    const pairs = matchBySignature(deriveStandaloneIndexes(source), deriveStandaloneIndexes(target), (index) => columnSignature(index.columns));
    const fixOf = (index: TableIndexInfo, side: 'source' | 'target'): ComparisonFixAction => ({
        kind: 'add-index',
        destination: side === 'source' ? 'target' : 'source',
        tableName: side === 'source' ? target.name : source.name,
        label: `index "${index.name}" (${index.columns.join(', ')})`,
        index,
    });

    return collectAttributeEntries<TableIndexInfo>(
        'indexes',
        (pair) => pair.source?.name ?? pair.target?.name ?? pair.key,
        (index) => display(index?.columns.join(', ')),
        pairs,
        attributes,
        fixOf
    );
}

function collectTableComparisonEntries(source: TableInfo, target: TableInfo, options: ComparisonOptions): ComparisonEntry[] {
    return [
        ...collectTableAttributeEntries(source, target, options),
        ...collectColumnEntries(source, target, options),
        ...collectKeyEntries(source, target, options),
        ...collectForeignKeyEntries(source, target, options),
        ...collectIndexEntries(source, target, options),
    ];
}

/* -------------------------------------------------------------------------- */
/* Breaking changes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A difference is breaking when bringing the target in line with the source can
 * fail or lose data. Renames (name-only changes), default values, on-update
 * expressions and non-unique index additions/removals are deliberately not
 * breaking; foreign keys are opt-out via the matching option.
 */
function qualify(tableName: string | undefined, object: string): string {
    return tableName ? `${tableName}.${object}` : object;
}

function classifyColumnBreakingChange(entry: ComparisonEntry, tableName: string | undefined): string | undefined {
    const objectRef = qualify(tableName, entry.object);
    const source = entry.sourceItem as TableColumnInfo | undefined;
    const target = entry.targetItem as TableColumnInfo | undefined;

    if (entry.status === 'added') {
        // Adding a NOT NULL column without a default cannot be applied to rows that already exist.
        return source?.notNull && !source.defaultValue && !source.isAutoIncrement ? `Column "${objectRef}" would be added as NOT NULL without a default` : undefined;
    }

    if (entry.status === 'removed') {
        return `Column "${objectRef}" exists only in the target and would be dropped, losing its data`;
    }

    switch (entry.attribute) {
        case 'type':
            return `Column "${objectRef}" type would change from ${entry.source} to ${entry.target}`;
        case 'nullable':
            // Loosening to NULL is safe; tightening to NOT NULL can fail on existing NULLs.
            return target && !target.notNull && source?.notNull ? `Column "${objectRef}" would become NOT NULL` : undefined;
        case 'collation':
            return `Column "${objectRef}" collation would change from ${entry.source} to ${entry.target}`;
        case 'auto increment':
            return source?.isAutoIncrement ? `Column "${objectRef}" would become auto increment` : `Column "${objectRef}" would stop being auto increment`;
        default:
            // Default values, on-update expressions and the per-column pk flag (covered by Keys) are not breaking.
            return undefined;
    }
}

function classifyKeyBreakingChange(entry: ComparisonEntry, tableName: string | undefined): string | undefined {
    // Renaming a key is not a breaking change.
    if (entry.attribute === 'name') {
        return undefined;
    }

    const objectRef = qualify(tableName, entry.object);
    const source = entry.sourceItem as DerivedKey | undefined;

    if (entry.status === 'added') {
        return `Unique key "${objectRef}" on (${source?.columns.join(', ') ?? ''}) would be added; existing rows may violate it`;
    }

    if (entry.status === 'removed') {
        return `Unique key "${objectRef}" exists only in the target and would be dropped`;
    }

    if (entry.attribute === 'primary') {
        return source?.isPrimary ? `Key "${objectRef}" would become the primary key` : `Key "${objectRef}" would stop being the primary key`;
    }

    return undefined;
}

function classifyForeignKeyBreakingChange(entry: ComparisonEntry, tableName: string | undefined): string | undefined {
    // Renaming a foreign key is not a breaking change.
    if (entry.attribute === 'name') {
        return undefined;
    }

    const objectRef = qualify(tableName, entry.object);

    if (entry.status === 'added') {
        return `Foreign key "${objectRef}" would be added`;
    }

    if (entry.status === 'removed') {
        return `Foreign key "${objectRef}" exists only in the target and would be dropped`;
    }

    if (entry.attribute === 'on delete') {
        return `Foreign key "${objectRef}" on delete would change from ${entry.source} to ${entry.target}`;
    }

    if (entry.attribute === 'on update') {
        return `Foreign key "${objectRef}" on update would change from ${entry.source} to ${entry.target}`;
    }

    return undefined;
}

function classifyIndexBreakingChange(entry: ComparisonEntry, tableName: string | undefined): string | undefined {
    // Renaming an index is not a breaking change, and neither is adding or
    // dropping a non-unique index (the Indexes group only holds those).
    if (entry.attribute === 'name' || entry.status !== 'changed') {
        return undefined;
    }

    if (entry.attribute === 'unique') {
        return `Index "${qualify(tableName, entry.object)}" would become unique`;
    }

    // Index type (btree/hash) is a performance detail, not a contract.
    return undefined;
}

function classifyBreakingChange(entry: ComparisonEntry, tableName: string | undefined, options: ComparisonOptions): string | undefined {
    // Attribute rows are emitted for every attribute of a changed object, so
    // matching rows must never be reported as breaking.
    if (entry.status === 'identical') {
        return undefined;
    }

    switch (entry.group) {
        case 'table':
            if (entry.status !== 'changed') {
                return undefined;
            }

            if (entry.attribute === 'engine') {
                return `Table "${tableName ?? 'table'}" engine would change from ${entry.source} to ${entry.target}`;
            }

            return entry.attribute === 'collation' ? `Table "${tableName ?? 'table'}" collation would change from ${entry.source} to ${entry.target}` : undefined;
        case 'columns':
            return classifyColumnBreakingChange(entry, tableName);
        case 'keys':
            return classifyKeyBreakingChange(entry, tableName);
        case 'foreignKeys':
            return options.foreignKeys.ignoreBreaking ? undefined : classifyForeignKeyBreakingChange(entry, tableName);
        case 'indexes':
            return classifyIndexBreakingChange(entry, tableName);
    }
}

type BreakingChangeCollection = {
    changes: BreakingChange[];
    ignoredCount: number;
};

function collectBreakingChanges(entries: ComparisonEntry[], tableName: string | undefined, options: ComparisonOptions): BreakingChangeCollection {
    const changes: BreakingChange[] = [];
    let ignoredCount = 0;

    for (const entry of entries) {
        const text = classifyBreakingChange(entry, tableName, options);

        if (text) {
            changes.push({ id: `breaking:${tableName ?? ''}:${entry.group}:${entry.object}:${entry.attribute}`, text });
            continue;
        }

        // Keep track of what the foreign-key option is hiding so the results can
        // say "0 breaking changes, but N foreign key differences are ignored".
        if (entry.group === 'foreignKeys' && options.foreignKeys.ignoreBreaking && entry.status !== 'identical' && classifyForeignKeyBreakingChange(entry, tableName)) {
            ignoredCount += 1;
        }
    }

    return { changes, ignoredCount };
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function createSection(
    id: string,
    title: string,
    columns: string[],
    rows: Array<Record<string, string>>,
    summary?: string,
    actions?: Array<ComparisonFixAction | undefined>
): ComparisonSection {
    return {
        id,
        title,
        columns,
        rows,
        differenceCount: rows.filter((row) => row.Status !== 'identical').length,
        summary,
        actions,
    };
}

function createGroupedSections(entries: ComparisonEntry[], prefix?: string): ComparisonSection[] {
    const sections: ComparisonSection[] = [];

    for (const group of COMPARISON_GROUPS) {
        const groupEntries = entries.filter((entry) => entry.group === group.id);

        if (groupEntries.length === 0) {
            continue;
        }

        const columns = group.id === 'table' ? ['Attribute', 'Source', 'Target', 'Status'] : [group.objectColumn, 'Attribute', 'Source', 'Target', 'Status'];
        const rows = groupEntries.map((entry) =>
            group.id === 'table'
                ? { Attribute: entry.attribute, Source: entry.source, Target: entry.target, Status: entry.status }
                : { [group.objectColumn]: entry.object, Attribute: entry.attribute, Source: entry.source, Target: entry.target, Status: entry.status }
        );
        const actions = groupEntries.map((entry) => entry.action);

        sections.push(
            createSection(
                prefix ? `${prefix}:${group.id}` : group.id,
                prefix ? `${prefix} · ${group.title}` : group.title,
                columns,
                rows,
                undefined,
                actions.some(Boolean) ? actions : undefined
            )
        );
    }

    return sections;
}

/** Sections and breaking changes for a single table, one section per object group. */
export function collectTableComparison(source: TableInfo, target: TableInfo, options: ComparisonOptions, prefix?: string): ComparisonResult {
    const entries = collectTableComparisonEntries(source, target, options);
    const breaking = collectBreakingChanges(entries, source.name, options);

    return {
        sections: createGroupedSections(entries, prefix),
        breakingChanges: breaking.changes,
        ignoredBreakingCount: breaking.ignoredCount,
    };
}

export function buildTableComparisonSections(source: TableInfo, target: TableInfo, options: ComparisonOptions, prefix?: string): ComparisonSection[] {
    return collectTableComparison(source, target, options, prefix).sections;
}

/**
 * Database comparison: one overview table plus one detail table per differing
 * table (objects from every group merged into a single table so a 100-table
 * diff does not render hundreds of tables). Dropping a table is breaking;
 * creating one is not.
 */
export function collectDatabaseComparison(sourceTables: TableInfo[], targetTables: TableInfo[], options: ComparisonOptions): ComparisonResult {
    const pairs = matchBySignature(sourceTables, targetTables, (table) => normalizeText(table.name));
    const overviewRows: Array<Record<string, string>> = [];
    const overviewActions: Array<ComparisonFixAction | undefined> = [];
    const detailSections: ComparisonSection[] = [];
    const breakingChanges: BreakingChange[] = [];
    let ignoredBreakingCount = 0;
    let missingTableCount = 0;
    let changedTableCount = 0;

    for (const pair of pairs) {
        const tableName = pair.source?.name ?? pair.target?.name ?? pair.key;

        if (!pair.source || !pair.target) {
            missingTableCount += 1;
            overviewRows.push({
                Table: tableName,
                Status: statusOf(pair.source !== undefined, pair.target !== undefined, false),
                Differences: pair.source ? 'missing in target' : 'missing in source',
            });
            // The side that has the table donates its DDL to the side missing it.
            overviewActions.push({
                kind: 'create-table',
                destination: pair.source ? 'target' : 'source',
                tableName: tableName,
                label: `table "${tableName}"`,
            });

            if (!pair.source) {
                breakingChanges.push({ id: `breaking:table:${tableName}:dropped`, text: `Table "${tableName}" exists only in the target and would be dropped, losing its data` });
            }

            continue;
        }

        const entries = collectTableComparisonEntries(pair.source, pair.target, options);
        const differences = entries.filter((entry) => entry.status !== 'identical');
        const breaking = collectBreakingChanges(entries, tableName, options);

        ignoredBreakingCount += breaking.ignoredCount;

        if (differences.length > 0) {
            changedTableCount += 1;
        }

        overviewRows.push({
            Table: tableName,
            Status: differences.length > 0 ? 'changed' : 'identical',
            Differences: differences.length > 0 ? `${differences.length} ${differences.length === 1 ? 'difference' : 'differences'}` : EMPTY_VALUE,
        });
        overviewActions.push(undefined);
        breakingChanges.push(...breaking.changes);

        if (differences.length === 0) {
            continue;
        }

        const rows = entries.map((entry) => ({
            Object: entry.group === 'table' ? 'table' : `${COMPARISON_GROUPS.find((group) => group.id === entry.group)?.title.toLowerCase()} · ${entry.object}`,
            Attribute: entry.attribute,
            Source: entry.source,
            Target: entry.target,
            Status: entry.status,
        }));
        const actions = entries.map((entry) => entry.action);

        detailSections.push(
            createSection(`table:${tableName}`, tableName, ['Object', 'Attribute', 'Source', 'Target', 'Status'], rows, undefined, actions.some(Boolean) ? actions : undefined)
        );
    }

    // The overview counts tables, not attribute differences: those are counted by
    // each table's own section (and would otherwise be counted twice).
    const summary = [missingTableCount > 0 ? `${missingTableCount} missing` : undefined, changedTableCount > 0 ? `${changedTableCount} changed` : undefined]
        .filter((part): part is string => Boolean(part))
        .join(' · ');
    const overview = createSection(
        databaseOverviewSectionId,
        'Tables',
        ['Table', 'Status', 'Differences'],
        overviewRows,
        summary || 'no differences',
        overviewActions.some(Boolean) ? overviewActions : undefined
    );

    return { sections: [overview, ...detailSections], breakingChanges, ignoredBreakingCount };
}

export function buildDatabaseComparisonSections(sourceTables: TableInfo[], targetTables: TableInfo[], options: ComparisonOptions): ComparisonSection[] {
    return collectDatabaseComparison(sourceTables, targetTables, options).sections;
}

/** Drops identical rows (and the sections left empty) unless `showIdentical` is on. */
export function filterComparisonSections(sections: ComparisonSection[], showIdentical: boolean): ComparisonSection[] {
    if (showIdentical) {
        return sections;
    }

    return sections
        .map((section) => {
            const keptIndices = section.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.Status !== 'identical');

            return {
                ...section,
                rows: keptIndices.map(({ row }) => row),
                actions: section.actions ? keptIndices.map(({ index }) => section.actions?.[index]) : undefined,
            };
        })
        .filter((section) => section.rows.length > 0);
}

export function countComparisonDifferences(sections: ComparisonSection[]): number {
    return sections.reduce((total, section) => total + section.differenceCount, 0);
}

/**
 * Database comparison counts each differing attribute once: the overview's
 * "changed" rows summarize tables whose attributes are already counted by their
 * own detail section, so only added/removed tables are counted from it.
 */
export function countDatabaseComparisonDifferences(sections: ComparisonSection[]): number {
    let total = 0;

    for (const section of sections) {
        if (section.id !== databaseOverviewSectionId) {
            total += section.differenceCount;
            continue;
        }

        total += section.rows.filter((row) => row.Status === 'added' || row.Status === 'removed').length;
    }

    return total;
}

/* -------------------------------------------------------------------------- */
/* Markdown export                                                            */
/* -------------------------------------------------------------------------- */

function escapeMarkdownCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>');
}

export function formatComparisonMarkdown(params: {
    title: string;
    sourceLabel: string;
    targetLabel: string;
    sections: ComparisonSection[];
    breakingChanges?: BreakingChange[];
    ignoredBreakingCount?: number;
    generatedAt?: string;
}): string {
    const lines = [`# ${params.title}`, '', `- **Source:** ${params.sourceLabel}`, `- **Target:** ${params.targetLabel}`];

    if (params.generatedAt) {
        lines.push(`- **Generated:** ${params.generatedAt}`);
    }

    lines.push('');

    const breakingChanges = params.breakingChanges ?? [];
    const ignoredBreakingCount = params.ignoredBreakingCount ?? 0;

    if (breakingChanges.length > 0 || ignoredBreakingCount > 0) {
        lines.push(`## Breaking changes (${breakingChanges.length})`, '');

        for (const change of breakingChanges) {
            lines.push(`- ${change.text}`);
        }

        if (ignoredBreakingCount > 0) {
            lines.push(
                breakingChanges.length > 0 ? '' : '- No counted breaking changes.',
                `_${ignoredBreakingCount} foreign key ${ignoredBreakingCount === 1 ? 'difference is' : 'differences are'} not counted as breaking (see the comparison options)._`
            );
        }

        lines.push('');
    }

    if (params.sections.length === 0) {
        lines.push('No differences found.', '');
        return lines.join('\n');
    }

    for (const section of params.sections) {
        lines.push(`## ${section.title}`, '');
        lines.push(`| ${section.columns.join(' | ')} |`);
        lines.push(`| ${section.columns.map(() => '---').join(' | ')} |`);

        for (const row of section.rows) {
            lines.push(`| ${section.columns.map((column) => escapeMarkdownCell(row[column] ?? '')).join(' | ')} |`);
        }

        lines.push('');
    }

    return lines.join('\n');
}
