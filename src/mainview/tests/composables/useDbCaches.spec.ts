// The sidebar reads the persisted collapse state on every row render, so one
// toggle used to re-parse the whole stored tree once per visible row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _useDbCaches } from '../../composables/useDbCaches';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('persisted tree state', () => {
    it('parses the stored state once however many rows ask for it', () => {
        const caches = _useDbCaches();
        const parse = vi.spyOn(JSON, 'parse');

        caches.setPersistedTreeState(1, { collapsed: true, groups: { '42': false } });

        for (let row = 0; row < 50; row += 1) {
            expect(caches.getPersistedTreeState(1)).toEqual({ collapsed: true, groups: { '42': false } });
        }

        expect(parse).toHaveBeenCalledTimes(1);
    });

    it('re-parses only the server whose state changed', () => {
        const caches = _useDbCaches();
        const parse = vi.spyOn(JSON, 'parse');

        caches.setPersistedTreeState(1, { collapsed: true });
        caches.setPersistedTreeState(2, { collapsed: false });
        caches.getPersistedTreeState(1);
        caches.getPersistedTreeState(2);
        expect(parse).toHaveBeenCalledTimes(2);

        parse.mockClear();
        caches.setPersistedTreeState(2, { collapsed: true });

        // Both servers are read again, but only server 2's string changed.
        expect(caches.getPersistedTreeState(1)).toEqual({ collapsed: true });
        expect(caches.getPersistedTreeState(2)).toEqual({ collapsed: true });
        expect(parse).toHaveBeenCalledTimes(1);
    });

    it('returns an empty state for a server that has none stored', () => {
        const caches = _useDbCaches();

        expect(caches.getPersistedTreeState(99)).toEqual({});
    });
});
