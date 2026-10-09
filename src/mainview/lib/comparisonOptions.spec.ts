import { beforeEach, describe, expect, it } from 'vitest';
import {
    comparisonOptionsStorageKey,
    createDefaultComparisonOptions,
    getComparisonOption,
    normalizeComparisonOptions,
    readComparisonOptions,
    setComparisonOption,
    toggleComparisonOption,
    writeComparisonOptions,
} from './comparisonOptions';

describe('comparison options', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults every ignore rule to off, except foreign keys in breaking changes', () => {
        const defaults = createDefaultComparisonOptions();

        // Foreign keys are advisory, so their changes never count as breaking unless asked for.
        expect(defaults.foreignKeys).toEqual({ ignoreName: false, ignoreOnDelete: false, ignoreOnUpdate: false, ignoreBreaking: true });
        expect(defaults.keys).toEqual({ ignoreName: false });
        expect(defaults.indexes).toEqual({ ignoreName: false });
        expect(defaults.table).toEqual({ ignoreEngine: false, ignoreCollation: false });
        expect(defaults.columns).toEqual({ ignoreCollation: false, ignoreNullability: false, ignoreDefaultValue: false, ignoreOnUpdate: false });
    });

    it('restores a persisted choice to count foreign keys as breaking', () => {
        localStorage.setItem(comparisonOptionsStorageKey, JSON.stringify({ foreignKeys: { ignoreBreaking: false } }));

        expect(readComparisonOptions().foreignKeys.ignoreBreaking).toBe(false);
    });

    it('toggles and sets individual rules', () => {
        const options = createDefaultComparisonOptions();

        expect(getComparisonOption(options, 'keys.ignoreName')).toBe(false);
        toggleComparisonOption(options, 'keys.ignoreName');
        expect(getComparisonOption(options, 'keys.ignoreName')).toBe(true);
        setComparisonOption(options, 'keys.ignoreName', false);
        expect(getComparisonOption(options, 'keys.ignoreName')).toBe(false);
    });

    it('round-trips through localStorage', () => {
        const options = createDefaultComparisonOptions();
        options.columns.ignoreCollation = true;
        options.foreignKeys.ignoreOnDelete = true;
        writeComparisonOptions(options);

        expect(JSON.parse(localStorage.getItem(comparisonOptionsStorageKey) ?? '{}')).toMatchObject({
            columns: { ignoreCollation: true },
            foreignKeys: { ignoreOnDelete: true },
        });
        expect(readComparisonOptions()).toEqual(options);
    });

    it('ignores unknown or non-boolean stored values', () => {
        const options = normalizeComparisonOptions({
            keys: { ignoreName: 'yes', unknown: true },
            bogus: { ignoreName: true },
            indexes: { ignoreName: true },
        });

        expect(options.keys.ignoreName).toBe(false);
        expect(options.indexes.ignoreName).toBe(true);
    });

    it('falls back to defaults for broken stored JSON', () => {
        localStorage.setItem(comparisonOptionsStorageKey, 'not json');

        expect(readComparisonOptions()).toEqual(createDefaultComparisonOptions());
    });
});
