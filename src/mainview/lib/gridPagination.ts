/** One row of the toolbar's page menu: a page number, or the break between distant ones. */
export type GridPageMenuEntry = { kind: 'page'; page: number } | { kind: 'gap' };

/** Pages listed on each side of the current one before the range is cut. */
const PAGE_MENU_WINDOW = 2;
/** Up to this many pages, the menu lists every one of them. */
const PAGE_MENU_FULL_LIST_LIMIT = 9;

/**
 * The pages the toolbar's page menu lists: all of them while there are only a few, otherwise the
 * first, the last and the pages around the current one. A menu that named every page of a large
 * table would build one button per page — millions of them.
 */
export function buildPageMenuEntries(currentPage: number, pageCount: number): GridPageMenuEntry[] {
    const total = Math.max(1, Math.round(pageCount));

    if (total <= PAGE_MENU_FULL_LIST_LIMIT) {
        return Array.from({ length: total }, (_, index) => ({ kind: 'page', page: index + 1 }));
    }

    const current = Math.min(Math.max(1, Math.round(currentPage)), total);
    const pages = new Set<number>([1, total, current]);

    for (let delta = 1; delta <= PAGE_MENU_WINDOW; delta += 1) {
        if (current - delta >= 1) {
            pages.add(current - delta);
        }

        if (current + delta <= total) {
            pages.add(current + delta);
        }
    }

    const entries: GridPageMenuEntry[] = [];
    let previousPage = 0;

    for (const page of [...pages].sort((left, right) => left - right)) {
        if (page - previousPage > 1) {
            entries.push({ kind: 'gap' });
        }

        entries.push({ kind: 'page', page });
        previousPage = page;
    }

    return entries;
}
