import { describe, expect, it } from 'vitest';
import { findSingleSourceTable } from './sqlSourceTable';

describe('findSingleSourceTable', () => {
    it('names the table of a plain select, whatever the casing and quoting', () => {
        expect(findSingleSourceTable('select * from people')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('SELECT id, name FROM People WHERE id = 1;')).toEqual({ tableName: 'People', qualifier: undefined });
        expect(findSingleSourceTable('select * from "people"')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('select * from `people`')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('select * from [people]')).toEqual({ tableName: 'people', qualifier: undefined });
    });

    it('keeps the table when the select adds clauses, an alias or trailing text', () => {
        expect(findSingleSourceTable('select * from people p order by p.name limit 10')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('select count(*) from people where id > 1 group by name having count(*) > 2')).toEqual({
            tableName: 'people',
            qualifier: undefined,
        });
        expect(findSingleSourceTable('select * from people use index (idx_name)')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('select * from only people')).toEqual({ tableName: 'people', qualifier: undefined });
    });

    it('reads the outer query, not a subquery in its select list or its where clause', () => {
        expect(findSingleSourceTable('select (select count(*) from accounts) as total from people')).toEqual({ tableName: 'people', qualifier: undefined });
        expect(findSingleSourceTable('select * from people where id in (select id from accounts)')).toEqual({ tableName: 'people', qualifier: undefined });
    });

    it('refuses a statement that reads from more than one table', () => {
        expect(findSingleSourceTable('select * from people join accounts on accounts.id = people.id')).toBeUndefined();
        expect(findSingleSourceTable('select * from people left outer join accounts on accounts.id = people.id')).toBeUndefined();
        expect(findSingleSourceTable('select * from people, accounts')).toBeUndefined();
        expect(findSingleSourceTable('select * from people straight_join accounts on accounts.id = people.id')).toBeUndefined();
        expect(findSingleSourceTable('select * from people union select * from accounts')).toBeUndefined();
    });

    it('refuses a derived table, a table-valued function and a statement that reads no table', () => {
        expect(findSingleSourceTable('select * from (select * from people) t')).toBeUndefined();
        expect(findSingleSourceTable('select * from json_each(\'[1]\')')).toBeUndefined();
        expect(findSingleSourceTable('select 1 as ok')).toBeUndefined();
    });

    it('refuses a statement that only mentions the table inside a comment or a string', () => {
        expect(findSingleSourceTable('select 1 as ok -- from people')).toBeUndefined();
        expect(findSingleSourceTable("select ' from people' as note")).toBeUndefined();
    });

    it('refuses a qualified name unless that qualifier is allowed', () => {
        expect(findSingleSourceTable('select * from main.people')).toBeUndefined();
        expect(findSingleSourceTable('select * from main.people', { allowedQualifiers: ['main'] })).toEqual({ tableName: 'people', qualifier: 'main' });
        expect(findSingleSourceTable('select * from shop.people', { allowedQualifiers: ['main', 'shop'] })).toEqual({ tableName: 'people', qualifier: 'shop' });
        expect(findSingleSourceTable('select * from shop.people', { allowedQualifiers: ['main'] })).toBeUndefined();
    });

    it('refuses anything that is not a single select statement', () => {
        expect(findSingleSourceTable('insert into people (name) select name from accounts')).toBeUndefined();
        expect(findSingleSourceTable('update people set name = \'x\'')).toBeUndefined();
        expect(findSingleSourceTable('with recent as (select * from people) select * from recent')).toBeUndefined();
        expect(findSingleSourceTable('select * from people; select * from accounts')).toBeUndefined();
    });
});
