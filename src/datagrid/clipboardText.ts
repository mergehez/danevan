/**
 * Parses clipboard text into the grid of values pasted into the grid: tabs separate cells, newlines
 * separate rows. Spreadsheets quote a cell that contains a tab, a newline or a quote (`"a""b"`), so
 * the parser honours that quoting too — a block copied from Excel or Sheets lands in the right cells.
 */
export function parseDataGridClipboardText(text: string): string[][] {
    if (!text) {
        return [];
    }

    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let index = 0;

    const pushField = () => {
        row.push(field);
        field = '';
    };

    const pushRow = () => {
        pushField();
        rows.push(row);
        row = [];
    };

    while (index < text.length) {
        const character = text[index] ?? '';

        if (inQuotes) {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 2;
                    continue;
                }

                inQuotes = false;
                index += 1;
                continue;
            }

            field += character;
            index += 1;
            continue;
        }

        // A quote only opens a quoted cell at its start; elsewhere it is the value itself.
        if (character === '"' && field === '') {
            inQuotes = true;
            index += 1;
            continue;
        }

        if (character === '\t') {
            pushField();
            index += 1;
            continue;
        }

        if (character === '\r' || character === '\n') {
            if (character === '\r' && text[index + 1] === '\n') {
                index += 1;
            }

            pushRow();
            index += 1;
            continue;
        }

        field += character;
        index += 1;
    }

    // A final newline is the terminator of the row above, not an empty row after it.
    if (field !== '' || row.length) {
        pushRow();
    }

    return rows;
}
