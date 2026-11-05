import { describe, expect, it } from 'vitest';
import { parseDataGridClipboardText } from './clipboardText';

describe('parseDataGridClipboardText', () => {
    it('splits the tab/newline block a copy writes', () => {
        expect(parseDataGridClipboardText('ada\t0\n1\t2')).toEqual([
            ['ada', '0'],
            ['1', '2'],
        ]);
    });

    it('treats the trailing newline as a terminator, not as an extra empty row', () => {
        expect(parseDataGridClipboardText('a\tb\nc\td\n')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
        expect(parseDataGridClipboardText('single\n')).toEqual([['single']]);
    });

    it('accepts CRLF rows', () => {
        expect(parseDataGridClipboardText('a\tb\r\nc\td')).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('keeps empty cells, so a pasted block keeps its shape', () => {
        expect(parseDataGridClipboardText('\t\t\n1\t\t')).toEqual([
            ['', '', ''],
            ['1', '', ''],
        ]);
    });

    it('unquotes a cell a spreadsheet quoted, including the delimiter and a newline in it', () => {
        expect(parseDataGridClipboardText('"a\tb"\t"line one\nline two"\t"say ""hi"""')).toEqual([['a\tb', 'line one\nline two', 'say "hi"']]);
    });

    it('treats a quote that does not open a cell as part of the value', () => {
        expect(parseDataGridClipboardText('5" pipe')).toEqual([['5" pipe']]);
    });

    it('returns no rows for an empty clipboard', () => {
        expect(parseDataGridClipboardText('')).toEqual([]);
    });

    it('keeps a single value as a one-cell grid', () => {
        expect(parseDataGridClipboardText('0')).toEqual([['0']]);
        expect(parseDataGridClipboardText(' ')).toEqual([[' ']]);
    });
});
