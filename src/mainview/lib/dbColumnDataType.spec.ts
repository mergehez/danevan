import { describe, expect, it } from 'vitest';
import { getDbColumnDataTypeOptions } from './dbColumnDataType';

describe('getDbColumnDataTypeOptions', () => {
    it('lists the MySQL data types in declaration order', () => {
        const options = getDbColumnDataTypeOptions('mysql');

        expect(options).toHaveLength(53);
        expect(options.slice(0, 4)).toEqual([
            { value: 'bit', label: 'bit' },
            { value: 'int', label: 'int' },
            { value: 'integer', label: 'integer' },
            { value: 'tinyint', label: 'tinyint' },
        ]);
        expect(options.at(-1)).toEqual({ value: 'inet6', label: 'inet6' });
    });

    it('lists the PostgreSQL data types in declaration order', () => {
        const options = getDbColumnDataTypeOptions('postgresql');

        expect(options).toHaveLength(74);
        expect(options.slice(0, 3)).toEqual([
            { value: 'int', label: 'int' },
            { value: 'int2', label: 'int2' },
            { value: 'int4', label: 'int4' },
        ]);
        expect(options.at(-1)).toEqual({ value: 'halfvec', label: 'halfvec' });
    });

    it('de-duplicates the SQLite list and reuses it for drivers without their own list', () => {
        const options = getDbColumnDataTypeOptions('sqlite');

        expect(options).toHaveLength(29);
        expect(options.filter((option) => option.value === 'integer')).toHaveLength(1);
        expect(options.filter((option) => option.value === 'text')).toHaveLength(1);
        expect(options.filter((option) => option.value === 'real')).toHaveLength(1);
        expect(getDbColumnDataTypeOptions(undefined)).toEqual(options);
        expect(getDbColumnDataTypeOptions('sqlserver')).toEqual(options);
        expect(getDbColumnDataTypeOptions('msaccess')).toEqual(options);
    });

    it('moves a known current value to the front without duplicating it', () => {
        const options = getDbColumnDataTypeOptions('mysql', 'varchar');

        expect(options).toHaveLength(53);
        expect(options[0]).toEqual({ value: 'varchar', label: 'varchar' });
        expect(options[1]).toEqual({ value: 'bit', label: 'bit' });
        expect(options.filter((option) => option.value === 'varchar')).toHaveLength(1);
    });

    it('prepends an unknown current value, trimmed', () => {
        const options = getDbColumnDataTypeOptions('sqlite', '  uuid_blob(16)  ');

        expect(options[0]).toEqual({ value: 'uuid_blob(16)', label: 'uuid_blob(16)' });
        expect(options).toHaveLength(30);
        expect(options.slice(1)).toEqual(getDbColumnDataTypeOptions('sqlite'));
    });

    it('ignores a blank current value', () => {
        expect(getDbColumnDataTypeOptions('sqlite', '   ')).toEqual(getDbColumnDataTypeOptions('sqlite'));
        expect(getDbColumnDataTypeOptions('sqlite', '')).toEqual(getDbColumnDataTypeOptions('sqlite'));
        expect(getDbColumnDataTypeOptions('sqlite', null)).toEqual(getDbColumnDataTypeOptions('sqlite'));
        expect(getDbColumnDataTypeOptions('sqlite', undefined)).toEqual(getDbColumnDataTypeOptions('sqlite'));
    });
});
