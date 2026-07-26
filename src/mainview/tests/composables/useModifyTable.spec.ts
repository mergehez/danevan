import { describe, expect, it } from 'vitest';
import { resolveForeignKeyDraftName } from '@composables/useModifyTable';

describe('resolveForeignKeyDraftName', () => {
    it('prefers the matching foreign index name when mysql foreign key rows are unnamed', () => {
        const name = resolveForeignKeyDraftName(
            'key_values',
            {
                indexes: [
                    {
                        name: 'key_values_created_by_foreign',
                        columns: ['created_by'],
                        comment: null,
                        isUnique: false,
                        origin: 'BTREE',
                        isPartial: false,
                        type: 'BTREE',
                        orders: ['A'],
                    },
                    {
                        name: 'key_values_updated_by_foreign',
                        columns: ['updated_by'],
                        comment: null,
                        isUnique: false,
                        origin: 'BTREE',
                        isPartial: false,
                        type: 'BTREE',
                        orders: ['A'],
                    },
                ],
            },
            [
                {
                    id: 0,
                    sequence: 0,
                    table: 'users',
                    from: 'created_by',
                    to: 'id',
                    onUpdate: 'NO ACTION',
                    onDelete: 'NO ACTION',
                    match: 'NONE',
                },
            ],
            '0'
        );

        expect(name).toBe('key_values_created_by_foreign');
    });

    it('keeps the explicit foreign key name when the driver provides it', () => {
        const name = resolveForeignKeyDraftName(
            'key_values',
            { indexes: [] },
            [
                {
                    id: 0,
                    name: 'key_values_created_by_foreign',
                    sequence: 0,
                    table: 'users',
                    from: 'created_by',
                    to: 'id',
                    onUpdate: 'NO ACTION',
                    onDelete: 'NO ACTION',
                    match: 'NONE',
                },
            ],
            '0'
        );

        expect(name).toBe('key_values_created_by_foreign');
    });
});
