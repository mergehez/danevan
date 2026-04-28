export type MergeConflictBlock = {
    index: number;
    fullMatch: string;
    currentHeader: string;
    separator: string;
    incomingHeader: string;
    current: string;
    incoming: string;
    startOffset: number;
    endOffset: number;
    currentHeaderStartOffset: number;
    currentHeaderEndOffset: number;
    currentStartOffset: number;
    currentEndOffset: number;
    incomingStartOffset: number;
    incomingEndOffset: number;
    incomingHeaderStartOffset: number;
    incomingHeaderEndOffset: number;
    startLine: number;
    endLine: number;
};

const conflictPattern = /^(<<<<<<<[^\n]*\n)([\s\S]*?)(^=======\n)([\s\S]*?)(^>>>>>>>[^\n]*(?:\n|$))/gm;

function countLines(input: string) {
    if (!input) {
        return 0;
    }

    return (input.match(/\n/g) ?? []).length;
}

export function parseMergeConflictBlocks(content: string): MergeConflictBlock[] {
    const matches: MergeConflictBlock[] = [];

    for (const match of content.matchAll(conflictPattern)) {
        const startOffset = match.index ?? 0;
        const fullMatch = match[0] ?? '';
        const currentHeader = match[1] ?? '';
        const current = match[2] ?? '';
        const separator = match[3] ?? '';
        const incoming = match[4] ?? '';
        const incomingHeader = match[5] ?? '';
        const endOffset = startOffset + fullMatch.length;
        const currentHeaderStartOffset = startOffset;
        const currentHeaderEndOffset = currentHeaderStartOffset + currentHeader.length;
        const currentStartOffset = startOffset + currentHeader.length;
        const currentEndOffset = currentStartOffset + current.length;
        const incomingStartOffset = currentEndOffset + separator.length;
        const incomingEndOffset = incomingStartOffset + incoming.length;
        const incomingHeaderStartOffset = incomingEndOffset;
        const incomingHeaderEndOffset = incomingHeaderStartOffset + incomingHeader.length;
        const startLine = countLines(content.slice(0, startOffset)) + 1;
        const endLine = startLine + countLines(fullMatch);

        matches.push({
            index: matches.length,
            fullMatch,
            currentHeader,
            separator,
            incomingHeader,
            current,
            incoming,
            startOffset,
            endOffset,
            currentHeaderStartOffset,
            currentHeaderEndOffset,
            currentStartOffset,
            currentEndOffset,
            incomingStartOffset,
            incomingEndOffset,
            incomingHeaderStartOffset,
            incomingHeaderEndOffset,
            startLine,
            endLine,
        });
    }

    return matches;
}

export function resolveMergeConflictBlock(content: string, block: MergeConflictBlock, resolution: 'current' | 'incoming' | 'both') {
    const replacement = resolution === 'current' ? block.current : resolution === 'incoming' ? block.incoming : `${block.current}${block.incoming}`;

    return `${content.slice(0, block.startOffset)}${replacement}${content.slice(block.endOffset)}`;
}
