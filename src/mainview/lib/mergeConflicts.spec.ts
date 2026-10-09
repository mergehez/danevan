import { describe, expect, it } from 'vitest';
import { parseMergeConflictBlocks, resolveMergeConflictBlock } from './mergeConflicts';

const singleConflict = ['line1', '<<<<<<< HEAD', 'ours-1', 'ours-2', '=======', 'theirs-1', '>>>>>>> feature/x', 'line2', ''].join('\n');

const twoConflicts = ['<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b', '<<<<<<< c', 'z', '=======', 'w', '>>>>>>> d', ''].join('\n');

const lastLineConflict = ['<<<<<<< a', 'ours', '=======', 'theirs', '>>>>>>> x'].join('\n');

describe('parseMergeConflictBlocks', () => {
    it('returns no blocks for content without markers', () => {
        expect(parseMergeConflictBlocks('SELECT 1 FROM users\n')).toEqual([]);
        expect(parseMergeConflictBlocks('')).toEqual([]);
    });

    it('ignores conflict markers that are not at the start of a line', () => {
        expect(parseMergeConflictBlocks('SELECT "x <<<<<<< HEAD" FROM t\n')).toEqual([]);
        expect(parseMergeConflictBlocks('note ======= not a separator\n')).toEqual([]);
    });

    it('parses one conflict block with exact offsets and line numbers', () => {
        expect(parseMergeConflictBlocks(singleConflict)).toEqual([
            {
                index: 0,
                fullMatch: '<<<<<<< HEAD\nours-1\nours-2\n=======\ntheirs-1\n>>>>>>> feature/x\n',
                currentHeader: '<<<<<<< HEAD\n',
                separator: '=======\n',
                incomingHeader: '>>>>>>> feature/x\n',
                current: 'ours-1\nours-2\n',
                incoming: 'theirs-1\n',
                startOffset: 6,
                endOffset: 68,
                currentHeaderStartOffset: 6,
                currentHeaderEndOffset: 19,
                currentStartOffset: 19,
                currentEndOffset: 33,
                incomingStartOffset: 41,
                incomingEndOffset: 50,
                incomingHeaderStartOffset: 50,
                incomingHeaderEndOffset: 68,
                startLine: 2,
                endLine: 8,
            },
        ]);
    });

    it('parses several conflict blocks in document order', () => {
        const blocks = parseMergeConflictBlocks(twoConflicts);

        expect(blocks.map((block) => block.index)).toEqual([0, 1]);
        expect(
            blocks.map((block) => ({
                fullMatch: block.fullMatch,
                current: block.current,
                incoming: block.incoming,
                startOffset: block.startOffset,
                endOffset: block.endOffset,
                startLine: block.startLine,
                endLine: block.endLine,
                currentHeader: block.currentHeader,
                separator: block.separator,
                incomingHeader: block.incomingHeader,
            }))
        ).toEqual([
            {
                fullMatch: '<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n',
                current: 'x\n',
                incoming: 'y\n',
                startOffset: 0,
                endOffset: 32,
                startLine: 1,
                endLine: 6,
                currentHeader: '<<<<<<< a\n',
                separator: '=======\n',
                incomingHeader: '>>>>>>> b\n',
            },
            {
                fullMatch: '<<<<<<< c\nz\n=======\nw\n>>>>>>> d\n',
                current: 'z\n',
                incoming: 'w\n',
                startOffset: 32,
                endOffset: 64,
                startLine: 6,
                endLine: 11,
                currentHeader: '<<<<<<< c\n',
                separator: '=======\n',
                incomingHeader: '>>>>>>> d\n',
            },
        ]);
    });

    it('keeps an empty side as an empty string', () => {
        const [block] = parseMergeConflictBlocks('<<<<<<< a\n=======\ny\n>>>>>>> b\n');

        expect(block?.current).toBe('');
        expect(block?.incoming).toBe('y\n');
        expect(block?.startOffset).toBe(0);
        expect(block?.endOffset).toBe(30);
    });

    it('parses a terminator on the last line without a trailing newline', () => {
        const content = '<<<<<<< a\nx\n=======\ny\n>>>>>>> b';

        expect(parseMergeConflictBlocks(content)).toEqual([
            {
                index: 0,
                fullMatch: content,
                currentHeader: '<<<<<<< a\n',
                separator: '=======\n',
                incomingHeader: '>>>>>>> b',
                current: 'x\n',
                incoming: 'y\n',
                startOffset: 0,
                endOffset: 31,
                currentHeaderStartOffset: 0,
                currentHeaderEndOffset: 10,
                currentStartOffset: 10,
                currentEndOffset: 12,
                incomingStartOffset: 20,
                incomingEndOffset: 22,
                incomingHeaderStartOffset: 22,
                incomingHeaderEndOffset: 31,
                startLine: 1,
                endLine: 5,
            },
        ]);
    });

    it('returns no blocks when the separator is missing', () => {
        expect(parseMergeConflictBlocks('<<<<<<< a\nx\n>>>>>>> b\n')).toEqual([]);
    });

    it('returns no blocks when the incoming terminator is missing', () => {
        expect(parseMergeConflictBlocks('<<<<<<< a\nx\n=======\ny\n')).toEqual([]);
        expect(parseMergeConflictBlocks('<<<<<<< a\nx\n=======\ny\n>>>>>> shorter\n')).toEqual([]);
    });

    it('returns no blocks for a stray separator or terminator', () => {
        expect(parseMergeConflictBlocks('=======\ny\n>>>>>>> b\n')).toEqual([]);
        expect(parseMergeConflictBlocks('y\n>>>>>>> b\n')).toEqual([]);
    });

    it('splits on the first separator and closes on the first terminator', () => {
        const blocks = parseMergeConflictBlocks('<<<<<<< a\nx\n=======\ny\n=======\nz\n>>>>>>> b\n');

        expect(blocks.map((block) => [block.current, block.incoming])).toEqual([['x\n', 'y\n=======\nz\n']]);
    });

    it('swallows a nested marker inside the incoming side of an unterminated block', () => {
        const blocks = parseMergeConflictBlocks('<<<<<<< a\nx\n=======\ny\n<<<<<<< b\np\n=======\nq\n>>>>>>> c\n');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]?.current).toBe('x\n');
        expect(blocks[0]?.incoming).toBe('y\n<<<<<<< b\np\n=======\nq\n');
        expect(blocks[0]?.incomingHeader).toBe('>>>>>>> c\n');
    });
});

describe('resolveMergeConflictBlock', () => {
    it('resolves to the current side', () => {
        const blocks = parseMergeConflictBlocks(singleConflict);

        expect(resolveMergeConflictBlock(singleConflict, blocks[0]!, 'current')).toBe('line1\nours-1\nours-2\nline2\n');
    });

    it('resolves to the incoming side', () => {
        const blocks = parseMergeConflictBlocks(singleConflict);

        expect(resolveMergeConflictBlock(singleConflict, blocks[0]!, 'incoming')).toBe('line1\ntheirs-1\nline2\n');
    });

    it('resolves to both sides with no added separator', () => {
        const blocks = parseMergeConflictBlocks(singleConflict);

        expect(resolveMergeConflictBlock(singleConflict, blocks[0]!, 'both')).toBe('line1\nours-1\nours-2\ntheirs-1\nline2\n');
    });

    it('leaves the other blocks untouched', () => {
        const blocks = parseMergeConflictBlocks(twoConflicts);

        expect(resolveMergeConflictBlock(twoConflicts, blocks[1]!, 'current')).toBe('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\nz\n');
    });

    it('resolves several blocks when applied from the last one', () => {
        const blocks = parseMergeConflictBlocks(twoConflicts);
        const withoutSecond = resolveMergeConflictBlock(twoConflicts, blocks[1]!, 'current');

        expect(resolveMergeConflictBlock(withoutSecond, blocks[0]!, 'incoming')).toBe('y\nz\n');
    });

    it('resolves a block whose terminator is the last line', () => {
        const blocks = parseMergeConflictBlocks(lastLineConflict);

        expect(resolveMergeConflictBlock(lastLineConflict, blocks[0]!, 'both')).toBe('ours\ntheirs\n');
    });

    it('removes every marker when all blocks are resolved', () => {
        const blocks = parseMergeConflictBlocks(twoConflicts);
        const withoutSecond = resolveMergeConflictBlock(twoConflicts, blocks[1]!, 'both');

        expect(resolveMergeConflictBlock(withoutSecond, blocks[0]!, 'both')).toBe('x\ny\nz\nw\n');
    });

    it('resolves a block with an empty current side', () => {
        const content = '<<<<<<< a\n=======\ny\n>>>>>>> b\n';
        const [block] = parseMergeConflictBlocks(content);

        expect(resolveMergeConflictBlock(content, block!, 'current')).toBe('');
        expect(resolveMergeConflictBlock(content, block!, 'incoming')).toBe('y\n');
    });
});
