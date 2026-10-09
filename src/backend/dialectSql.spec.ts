// What the remote drivers send to MySQL and PostgreSQL. These are the functions that decide the
// identifier quoting, the referential actions and the statement that reaches the server, so a wrong
// string here changes data — and none of it needs a live server.
import { describe, expect, it } from 'vitest';
import {
    createTypeOrmForeignKey,
    normalizeCountValue,
    normalizeMySqlReferentialAction,
    normalizePostgresTableName,
    preparePostgresStatement,
    quoteMySqlIdentifier,
    quotePostgresIdentifier,
} from './dialectSql.ts';

describe('normalizeCountValue', () => {
    it('converts bigint, string and null counts to numbers', () => {
        expect(normalizeCountValue(12n)).toBe(12);
        expect(normalizeCountValue('34')).toBe(34);
        expect(normalizeCountValue(null)).toBe(0);
        expect(normalizeCountValue(undefined)).toBe(0);
        expect(normalizeCountValue(7)).toBe(7);
    });
});

describe('identifier quoting', () => {
    it('quotes each part of a qualified MySQL name', () => {
        expect(quoteMySqlIdentifier('orders')).toBe('`orders`');
        expect(quoteMySqlIdentifier('shop.orders')).toBe('`shop`.`orders`');
        expect(quoteMySqlIdentifier('order items.id')).toBe('`order items`.`id`');
    });

    it('escapes a backtick inside a MySQL name', () => {
        expect(quoteMySqlIdentifier('we`ird')).toBe('`we``ird`');
    });

    it('quotes each part of a qualified PostgreSQL name', () => {
        expect(quotePostgresIdentifier('orders')).toBe('"orders"');
        expect(quotePostgresIdentifier('public.orders')).toBe('"public"."orders"');
        expect(quotePostgresIdentifier('order items.id')).toBe('"order items"."id"');
    });

    it('escapes a double quote inside a PostgreSQL name', () => {
        expect(quotePostgresIdentifier('we"ird')).toBe('"we""ird"');
    });
});

describe('normalizeMySqlReferentialAction', () => {
    it.each([
        ['NO ACTION', 'NO ACTION'],
        ['no action', 'NO ACTION'],
        ['no_action', 'NO ACTION'],
        ['  CASCADE  ', 'CASCADE'],
        ['Restrict', 'RESTRICT'],
        ['set null', 'SET NULL'],
        ['set_default', 'SET DEFAULT'],
    ])('normalizes %s to %s', (input, expected) => {
        expect(normalizeMySqlReferentialAction(input)).toBe(expected);
    });

    it('keeps an action it does not know, so nothing is silently dropped', () => {
        expect(normalizeMySqlReferentialAction('SOMETHING NEW')).toBe('SOMETHING NEW');
    });

    it('reports nothing for an absent action', () => {
        expect(normalizeMySqlReferentialAction(null)).toBeUndefined();
        expect(normalizeMySqlReferentialAction(undefined)).toBeUndefined();
        expect(normalizeMySqlReferentialAction('   ')).toBeUndefined();
    });
});

describe('createTypeOrmForeignKey', () => {
    it('maps a modify-plan foreign key onto TypeORM with normalized actions', () => {
        const foreignKey = createTypeOrmForeignKey({
            name: 'fk_orders_owner',
            targetTable: 'users',
            columns: [{ columnName: 'owner_id', targetName: 'id' }],
            onUpdate: 'no action',
            onDelete: 'cascade',
            match: 'NONE',
        });

        expect(foreignKey.name).toBe('fk_orders_owner');
        expect(foreignKey.columnNames).toEqual(['owner_id']);
        expect(foreignKey.referencedTableName).toBe('users');
        expect(foreignKey.referencedColumnNames).toEqual(['id']);
        expect(foreignKey.onUpdate).toBe('NO ACTION');
        expect(foreignKey.onDelete).toBe('CASCADE');
    });

    it('keeps the column order of a composite foreign key', () => {
        const foreignKey = createTypeOrmForeignKey({
            name: 'fk_composite',
            targetTable: 'pairs',
            columns: [
                { columnName: 'left_id', targetName: 'left' },
                { columnName: 'right_id', targetName: 'right' },
            ],
            onUpdate: null,
            onDelete: null,
            match: null,
        });

        expect(foreignKey.columnNames).toEqual(['left_id', 'right_id']);
        expect(foreignKey.referencedColumnNames).toEqual(['left', 'right']);
        expect(foreignKey.onUpdate).toBeUndefined();
        expect(foreignKey.onDelete).toBeUndefined();
    });
});

describe('normalizePostgresTableName', () => {
    it('drops the schema Postgres prefixes onto a table name', () => {
        expect(normalizePostgresTableName({ name: 'public.orders' })).toBe('orders');
        expect(normalizePostgresTableName({ name: 'orders' })).toBe('orders');
    });
});

describe('preparePostgresStatement', () => {
    it('rewrites question marks into one-based Postgres placeholders', () => {
        expect(preparePostgresStatement({ sql: 'SELECT * FROM users WHERE email = ? AND tenant_id = ?', params: ['a@b.c', 7] })).toEqual({
            sql: 'SELECT * FROM users WHERE email = $1 AND tenant_id = $2',
            params: ['a@b.c', 7],
        });
    });

    it('passes a statement without placeholders through', () => {
        expect(preparePostgresStatement({ sql: 'SELECT 1', params: [] })).toEqual({ sql: 'SELECT 1', params: [] });
    });

    it('refuses a statement whose placeholder count does not match its parameters', () => {
        expect(() => preparePostgresStatement({ sql: 'SELECT * FROM users WHERE id = ?', params: [1, 2] })).toThrow('PostgreSQL expected 1 parameter(s) but received 2.');
        expect(() => preparePostgresStatement({ sql: 'SELECT * FROM users WHERE id = ? AND name = ?', params: [1] })).toThrow('PostgreSQL expected 2 parameter(s) but received 1.');
    });
});
