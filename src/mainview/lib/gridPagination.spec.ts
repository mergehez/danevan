import { describe, expect, it } from 'vitest';
import { buildPageMenuEntries, type GridPageMenuEntry } from './gridPagination';

/** The pages a menu lists, with `…` standing in for a gap row. */
function menuLabels(currentPage: number, pageCount: number) {
    return buildPageMenuEntries(currentPage, pageCount).map((entry: GridPageMenuEntry) => (entry.kind === 'gap' ? '…' : String(entry.page)));
}

describe('buildPageMenuEntries', () => {
    it('lists every page while there are only a few', () => {
        expect(menuLabels(1, 1)).toEqual(['1']);
        expect(menuLabels(3, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    });

    it('keeps the first, the last and the pages around the current one for a long table', () => {
        expect(menuLabels(50, 1000)).toEqual(['1', '…', '48', '49', '50', '51', '52', '…', '1000']);
    });

    it('lists the current page between the first and the last near either end', () => {
        expect(menuLabels(1, 1000)).toEqual(['1', '2', '3', '…', '1000']);
        expect(menuLabels(2, 1000)).toEqual(['1', '2', '3', '4', '…', '1000']);
        expect(menuLabels(999, 1000)).toEqual(['1', '…', '997', '998', '999', '1000']);
        expect(menuLabels(1000, 1000)).toEqual(['1', '…', '998', '999', '1000']);
    });

    it('clamps a page outside the table so the menu still names the real pages', () => {
        expect(menuLabels(5000, 12)).toEqual(['1', '…', '10', '11', '12']);
        expect(menuLabels(0, 20)).toEqual(['1', '2', '3', '…', '20']);
    });
});
