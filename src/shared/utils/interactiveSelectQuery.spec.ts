// The interactive bar turns its controls into one statement; these are the statements it must
// build, including the pagination each dialect accepts (SQL Server and MySQL reject the naive one).
import { describe, expect, it } from 'vitest';
import { buildInteractiveSelectSql, cloneInteractiveSelectDraft, createInteractiveSelectDraft } from './interactiveSelectQuery';

function build(draft: ReturnType<typeof createInteractiveSelectDraft>, options: { tableName?: string; dialect?: Parameters<typeof buildInteractiveSelectSql>[0]['dialect'] } = {}) {
    return buildInteractiveSelectSql({ tableName: 'tableName' in options ? options.tableName : 'people', draft, dialect: options.dialect ?? 'sqlite' });
}

describe('buildInteractiveSelectSql', () => {
    it('selects every column with the row limit the bar starts on', () => {
        expect(build(createInteractiveSelectDraft({ limit: 500 }))).toBe('SELECT * FROM "people" LIMIT 500');
    });

    it('selects nothing at all without a table', () => {
        expect(build(createInteractiveSelectDraft({ limit: 500 }), { tableName: undefined })).toBe('');
        expect(build(createInteractiveSelectDraft({ limit: 500 }), { tableName: '   ' })).toBe('');
    });

    it('quotes the picked columns and keeps a table expression after them', () => {
        const draft = createInteractiveSelectDraft({ columns: ['id', 'name', 'age'] });
        draft.selectMode = 'custom';
        draft.columns = ['name', 'age'];
        draft.expressions = ['count(*) as total', '  '];

        expect(build(draft)).toBe('SELECT "name", "age", count(*) as total FROM "people"');
    });

    it('falls back to every column when a custom list is empty', () => {
        const draft = createInteractiveSelectDraft({ columns: ['id'] });
        draft.selectMode = 'custom';
        draft.columns = [];

        expect(build(draft)).toBe('SELECT * FROM "people"');
    });

    it('wraps each condition in parentheses so an OR cannot widen the filter', () => {
        const draft = createInteractiveSelectDraft({ limit: 10 });
        draft.where = ['age > 30', '  ', 'name = "x" or name = "y"'];

        expect(build(draft)).toBe('SELECT * FROM "people" WHERE (age > 30) AND (name = "x" or name = "y") LIMIT 10');
    });

    it('orders by every picked column with its own direction', () => {
        const draft = createInteractiveSelectDraft({ limit: 10 });
        draft.orderBy = [
            { column: 'age', direction: 'DESC' },
            { column: 'name', direction: 'ASC' },
        ];

        expect(build(draft)).toBe('SELECT * FROM "people" ORDER BY "age" DESC, "name" ASC LIMIT 10');
    });

    it('quotes per dialect', () => {
        const draft = createInteractiveSelectDraft({ columns: ['id'], limit: 5 });
        draft.selectMode = 'custom';

        expect(build(draft, { dialect: 'mysql' })).toBe('SELECT `id` FROM `people` LIMIT 5');
        expect(build(draft, { dialect: 'sqlserver' })).toBe('SELECT [id] FROM [people] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
        expect(build(draft, { dialect: 'msaccess' })).toBe('SELECT TOP 5 [id] FROM [people]');
    });

    it('gives MySQL the unlimited LIMIT it needs before an OFFSET', () => {
        const draft = createInteractiveSelectDraft();
        draft.offset = 20;

        expect(build(draft, { dialect: 'mysql' })).toBe('SELECT * FROM `people` LIMIT 18446744073709551615 OFFSET 20');
        expect(build(draft, { dialect: 'postgresql' })).toBe('SELECT * FROM "people" OFFSET 20');
        expect(build(draft, { dialect: 'sqlite' })).toBe('SELECT * FROM "people" LIMIT -1 OFFSET 20');
    });

    it('gives SQL Server the ORDER BY its OFFSET needs, and keeps the one the user asked for', () => {
        const draft = createInteractiveSelectDraft({ limit: 5 });
        draft.offset = 10;

        expect(build(draft, { dialect: 'sqlserver' })).toBe('SELECT * FROM [people] ORDER BY (SELECT NULL) OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY');

        draft.orderBy = [{ column: 'id', direction: 'ASC' }];
        expect(build(draft, { dialect: 'sqlserver' })).toBe('SELECT * FROM [people] ORDER BY [id] ASC OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY');
    });

    it('leaves MS Access rows unpaged when only an offset is set', () => {
        const draft = createInteractiveSelectDraft();
        draft.offset = 10;

        expect(build(draft, { dialect: 'msaccess' })).toBe('SELECT * FROM [people]');
    });

    it('treats an empty or negative limit as unlimited', () => {
        const draft = createInteractiveSelectDraft();
        expect(build(draft)).toBe('SELECT * FROM "people"');

        draft.limit = -1;
        expect(build(draft)).toBe('SELECT * FROM "people"');
    });
});

describe('createInteractiveSelectDraft', () => {
    it('starts on all columns with the grid row limit and no filters', () => {
        const draft = createInteractiveSelectDraft({ columns: ['id', 'name'], limit: 250 });

        expect(draft).toEqual({
            selectMode: 'all',
            columns: ['id', 'name'],
            expressions: [],
            where: [],
            orderBy: [],
            limit: 250,
            offset: '',
        });
    });

    it('shows no limit when the grid is unlimited', () => {
        expect(createInteractiveSelectDraft({ limit: -1 }).limit).toBe('');
    });
});

describe('cloneInteractiveSelectDraft', () => {
    it('copies the rows, so a remembered draft cannot be edited by the current one', () => {
        const draft = createInteractiveSelectDraft({ columns: ['id'], limit: 100 });
        draft.where = ['id > 1'];
        draft.orderBy = [{ column: 'id', direction: 'DESC' }];

        const copy = cloneInteractiveSelectDraft(draft);
        copy.where.push('id < 9');
        copy.orderBy[0].direction = 'ASC';
        copy.columns.push('name');

        expect(draft.where).toEqual(['id > 1']);
        expect(draft.orderBy[0].direction).toBe('DESC');
        expect(draft.columns).toEqual(['id']);
    });
});
