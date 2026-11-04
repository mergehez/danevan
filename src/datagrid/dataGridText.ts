import { DATA_GRID_MAX_DISPLAY_TEXT_LENGTH, DATA_GRID_NEWLINE_TOKEN } from './dataGrid';

/** Text runs of a cell, split at the `⏎` marker a multi-line value is drawn with. */
export type DataGridTextRun = {
    text: string;
    isMarker: boolean;
};

/** Two newlines become one marker token, the way the grid has always shown a multi-line value. */
export function replaceDataGridNewlines(text: string) {
    return text.replaceAll(/\r?\n/g, DATA_GRID_NEWLINE_TOKEN);
}

/** The drawn text of a cell: newline markers, and a hard cap on multi-MB values. */
export function formatDataGridDisplayText(raw: string) {
    return raw.length > DATA_GRID_MAX_DISPLAY_TEXT_LENGTH ? replaceDataGridNewlines(`${raw.slice(0, DATA_GRID_MAX_DISPLAY_TEXT_LENGTH)}…`) : replaceDataGridNewlines(raw);
}

export function getDataGridTextRuns(text: string): DataGridTextRun[] {
    if (!text) {
        return [];
    }

    const runs: DataGridTextRun[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const markerIndex = text.indexOf(DATA_GRID_NEWLINE_TOKEN, cursor);

        if (markerIndex < 0) {
            runs.push({ text: text.slice(cursor), isMarker: false });
            break;
        }

        if (markerIndex > cursor) {
            runs.push({ text: text.slice(cursor, markerIndex), isMarker: false });
        }

        runs.push({ text: DATA_GRID_NEWLINE_TOKEN, isMarker: true });
        cursor = markerIndex + DATA_GRID_NEWLINE_TOKEN.length;
    }

    return runs;
}

/** Every occurrence of `query` in `text`, matched case-insensitively like the grid's search. */
export function findDataGridTextMatches(text: string, query: string) {
    if (!text || !query) {
        return [] as Array<{ start: number; end: number }>;
    }

    const normalizedText = text.toLocaleLowerCase();
    const matches: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;

    while (searchFrom < normalizedText.length) {
        const index = normalizedText.indexOf(query, searchFrom);

        if (index < 0) {
            break;
        }

        matches.push({ start: index, end: index + query.length });
        searchFrom = index + Math.max(query.length, 1);
    }

    return matches;
}

/**
 * The text a cell draws in its column: the same `...` truncation the grid has always used, so a
 * long value and its search highlights end at the same character as before.
 */
export function ellipsizeDataGridText(text: string, maxWidth: number, measure: (text: string) => number) {
    if (measure(text) <= maxWidth) {
        return text;
    }

    const ellipsis = '...';
    let low = 0;
    let high = text.length;

    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = `${text.slice(0, middle)}${ellipsis}`;

        if (measure(candidate) <= maxWidth) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return `${text.slice(0, Math.max(0, low - 1))}${ellipsis}`;
}

export type DataGridTextSegment = {
    text: string;
    isMarker: boolean;
    isMatch: boolean;
    /** Offset from the start of the drawn text, measured the way the renderer places it. */
    left: number;
    width: number;
};

export type DataGridCellTextLayout = {
    text: string;
    segments: DataGridTextSegment[];
    /** Highlight bands behind the matched runs, relative to the cell's text origin. */
    highlights: Array<{ left: number; width: number }>;
};

/**
 * Splits the drawn text into the runs the grid paints: plain text, the muted newline marker, and
 * the search matches (which get a highlight band and the highlight text colour). Rendered as
 * inline spans, so the text is real DOM text — selectable by `page.getByText`, findable by tests
 * and readable by assistive technology.
 */
export function layoutDataGridCellText(text: string, query: string, measure: (text: string) => number): DataGridCellTextLayout {
    const matches = findDataGridTextMatches(text, query);
    const segments: DataGridTextSegment[] = [];
    const highlights: Array<{ left: number; width: number }> = [];
    let cursor = 0;
    let left = 0;

    const pushRun = (runText: string, isMarker: boolean, isMatch: boolean) => {
        if (!runText) {
            return;
        }

        const width = measure(runText);

        segments.push({ text: runText, isMarker, isMatch, left, width });
        left += width;
    };

    for (const match of matches) {
        const prefix = text.slice(cursor, match.start);

        for (const run of getDataGridTextRuns(prefix)) {
            pushRun(run.text, run.isMarker, false);
        }

        const matchedText = text.slice(match.start, match.end);

        if (!matchedText) {
            cursor = match.end;
            continue;
        }

        const width = measure(matchedText);

        highlights.push({ left, width });
        pushRun(matchedText, false, true);
        cursor = match.end;
    }

    for (const run of getDataGridTextRuns(text.slice(cursor))) {
        pushRun(run.text, run.isMarker, false);
    }

    return { text, segments, highlights };
}
