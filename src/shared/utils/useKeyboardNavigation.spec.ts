import { describe, expect, it, vi } from 'vitest';
import { useKeyboardNavigation, type KeyboardNavigationGrid, type KeyboardNavigationPosition } from './useKeyboardNavigation';

// 3 rows x 4 columns = 12 cells.
const grid: KeyboardNavigationGrid = { rowCount: 3, columnCount: 4 };
const emptyGrid: KeyboardNavigationGrid = { rowCount: 0, columnCount: 0 };

function setup(currentGrid: KeyboardNavigationGrid = grid, position: KeyboardNavigationPosition = { rowIndex: 0, columnIndex: 0 }) {
    const setActiveCell = vi.fn();
    const nav = useKeyboardNavigation({
        getGrid: () => currentGrid,
        getPosition: () => position,
        setActiveCell,
    });

    return { nav, setActiveCell };
}

function keydown(key: string, init: KeyboardEventInit = {}) {
    return new KeyboardEvent('keydown', { key, cancelable: true, ...init });
}

describe('useKeyboardNavigation horizontal moves', () => {
    it('steps one column right and left', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.getHorizontalTarget(1, { rowIndex: 0, columnIndex: 0 })).toEqual({ rowIndex: 0, columnIndex: 1 });
        expect(nav.getHorizontalTarget(1, { rowIndex: 2, columnIndex: 0 })).toEqual({ rowIndex: 2, columnIndex: 1 });
        expect(nav.getHorizontalTarget(-1, { rowIndex: 2, columnIndex: 3 })).toEqual({ rowIndex: 2, columnIndex: 2 });
    });

    it('wraps across the row boundary in both directions', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.getHorizontalTarget(-1, { rowIndex: 0, columnIndex: 0 })).toEqual({ rowIndex: 2, columnIndex: 3 });
        expect(nav.getHorizontalTarget(1, { rowIndex: 2, columnIndex: 3 })).toEqual({ rowIndex: 0, columnIndex: 0 });
    });

    it('returns undefined for a grid without cells', () => {
        const { nav, setActiveCell } = setup(emptyGrid);

        expect(nav.getHorizontalTarget(1, { rowIndex: 0, columnIndex: 0 })).toBeUndefined();
        expect(nav.moveHorizontally(1)).toBeUndefined();
        expect(setActiveCell).not.toHaveBeenCalled();
    });
});

describe('useKeyboardNavigation vertical moves', () => {
    it('steps one row down and up', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.getVerticalTarget(1, { rowIndex: 0, columnIndex: 1 })).toEqual({ rowIndex: 1, columnIndex: 1 });
        expect(nav.getVerticalTarget(-1, { rowIndex: 2, columnIndex: 2 })).toEqual({ rowIndex: 1, columnIndex: 2 });
    });

    it('wraps into the next column at the bottom edge and the previous one at the top', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.getVerticalTarget(1, { rowIndex: 2, columnIndex: 0 })).toEqual({ rowIndex: 0, columnIndex: 1 });
        expect(nav.getVerticalTarget(-1, { rowIndex: 0, columnIndex: 0 })).toEqual({ rowIndex: 2, columnIndex: 3 });
    });

    it('returns undefined for a grid without cells', () => {
        const { nav, setActiveCell } = setup(emptyGrid);

        expect(nav.getVerticalTarget(1, { rowIndex: 0, columnIndex: 0 })).toBeUndefined();
        expect(nav.moveVertically(1)).toBeUndefined();
        expect(setActiveCell).not.toHaveBeenCalled();
    });
});

describe('useKeyboardNavigation edges', () => {
    it('keeps the row and jumps to its first or last column', () => {
        const { nav } = setup(grid, { rowIndex: 1, columnIndex: 2 });

        expect(nav.getRowEdgeTarget(false, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 1, columnIndex: 0 });
        expect(nav.getRowEdgeTarget(true, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 1, columnIndex: 3 });
    });

    it('keeps the column and jumps to its first or last row', () => {
        const { nav } = setup(grid, { rowIndex: 1, columnIndex: 2 });

        expect(nav.getColumnEdgeTarget(false, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 0, columnIndex: 2 });
        expect(nav.getColumnEdgeTarget(true, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 2, columnIndex: 2 });
    });

    it('returns undefined for a grid without cells', () => {
        const { nav, setActiveCell } = setup(emptyGrid);

        expect(nav.getRowEdgeTarget(true, { rowIndex: 0, columnIndex: 0 })).toBeUndefined();
        expect(nav.getColumnEdgeTarget(true, { rowIndex: 0, columnIndex: 0 })).toBeUndefined();
        expect(nav.moveToRowEdge(true)).toBeUndefined();
        expect(nav.moveToColumnEdge(true)).toBeUndefined();
        expect(setActiveCell).not.toHaveBeenCalled();
    });
});

describe('useKeyboardNavigation key mapping', () => {
    it('maps plain arrows onto single-cell moves', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 1 });

        expect(nav.getTargetPosition({ key: 'ArrowUp' }, { rowIndex: 0, columnIndex: 1 })).toEqual({ rowIndex: 2, columnIndex: 0 });
        expect(nav.getTargetPosition({ key: 'ArrowDown' }, { rowIndex: 0, columnIndex: 1 })).toEqual({ rowIndex: 1, columnIndex: 1 });
        expect(nav.getTargetPosition({ key: 'ArrowLeft' }, { rowIndex: 0, columnIndex: 1 })).toEqual({ rowIndex: 0, columnIndex: 0 });
        expect(nav.getTargetPosition({ key: 'ArrowRight' }, { rowIndex: 0, columnIndex: 1 })).toEqual({ rowIndex: 0, columnIndex: 2 });
    });

    it('maps meta+arrows onto the row and column edges', () => {
        const { nav } = setup(grid, { rowIndex: 1, columnIndex: 2 });

        expect(nav.getTargetPosition({ key: 'ArrowUp', metaKey: true }, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 0, columnIndex: 2 });
        expect(nav.getTargetPosition({ key: 'ArrowDown', metaKey: true }, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 2, columnIndex: 2 });
        expect(nav.getTargetPosition({ key: 'ArrowLeft', metaKey: true }, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 1, columnIndex: 0 });
        expect(nav.getTargetPosition({ key: 'ArrowRight', metaKey: true }, { rowIndex: 1, columnIndex: 2 })).toEqual({ rowIndex: 1, columnIndex: 3 });
    });

    it('maps Tab and shift+Tab onto horizontal moves', () => {
        const { nav } = setup(grid, { rowIndex: 0, columnIndex: 2 });

        expect(nav.getTargetPosition({ key: 'Tab' }, { rowIndex: 0, columnIndex: 2 })).toEqual({ rowIndex: 0, columnIndex: 3 });
        expect(nav.getTargetPosition({ key: 'Tab', shiftKey: true }, { rowIndex: 0, columnIndex: 0 })).toEqual({ rowIndex: 2, columnIndex: 3 });
    });

    it('returns undefined for keys it does not handle', () => {
        const { nav } = setup(grid);

        expect(nav.getTargetPosition({ key: 'Enter' })).toBeUndefined();
        expect(nav.getTargetPosition({ key: 'a' })).toBeUndefined();
        expect(nav.getTargetPosition({ key: 'Home' })).toBeUndefined();
    });

    it('falls back to the position reported by the options', () => {
        const { nav } = setup(grid, { rowIndex: 1, columnIndex: 0 });

        expect(nav.getTargetPosition({ key: 'ArrowRight' })).toEqual({ rowIndex: 1, columnIndex: 1 });
    });
});

describe('useKeyboardNavigation apply', () => {
    it('applies the target and returns it', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.moveHorizontally(1, { focus: true })).toEqual({ rowIndex: 0, columnIndex: 1 });
        expect(setActiveCell.mock.calls).toEqual([[0, 1, { focus: true }]]);
    });

    it('applies vertical, row-edge and column-edge moves without focus options', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 1, columnIndex: 1 });

        nav.moveVertically(1);
        nav.moveToRowEdge(true);
        nav.moveToColumnEdge(false);
        nav.moveByEvent({ key: 'ArrowLeft' });

        expect(setActiveCell.mock.calls).toEqual([
            [2, 1, undefined],
            [1, 3, undefined],
            [0, 1, undefined],
            [1, 0, undefined],
        ]);
    });

    it('does not touch the active cell for an unhandled key', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 0, columnIndex: 0 });

        expect(nav.moveByEvent({ key: 'Escape' })).toBeUndefined();
        expect(setActiveCell).not.toHaveBeenCalled();
    });
});

describe('useKeyboardNavigation tryNavigate', () => {
    it('moves one cell down and prevents the default scroll', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 0, columnIndex: 0 });
        const event = keydown('ArrowDown');

        expect(nav.tryNavigate(event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(setActiveCell.mock.calls).toEqual([[1, 0, { focus: true }]]);
    });

    it('jumps to the column edges with meta and the row edges with shift-free meta arrows', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 1, columnIndex: 2 });

        expect(nav.tryNavigate(keydown('ArrowUp', { metaKey: true }))).toBe(true);
        expect(nav.tryNavigate(keydown('ArrowDown', { metaKey: true }))).toBe(true);
        expect(nav.tryNavigate(keydown('ArrowLeft', { metaKey: true }))).toBe(true);
        expect(nav.tryNavigate(keydown('ArrowRight', { metaKey: true }))).toBe(true);

        expect(setActiveCell.mock.calls).toEqual([
            [0, 2, { focus: true }],
            [2, 2, { focus: true }],
            [1, 0, { focus: true }],
            [1, 3, { focus: true }],
        ]);
    });

    it('moves one cell with plain ArrowUp, ArrowLeft and ArrowRight', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 1, columnIndex: 1 });

        expect(nav.tryNavigate(keydown('ArrowUp'))).toBe(true);
        expect(nav.tryNavigate(keydown('ArrowLeft'))).toBe(true);
        expect(nav.tryNavigate(keydown('ArrowRight'))).toBe(true);

        expect(setActiveCell.mock.calls).toEqual([
            [0, 1, { focus: true }],
            [1, 0, { focus: true }],
            [1, 2, { focus: true }],
        ]);
    });

    it('tabs forward and back', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 0, columnIndex: 2 });

        expect(nav.tryNavigate(keydown('Tab'))).toBe(true);
        expect(nav.tryNavigate(keydown('Tab', { shiftKey: true }))).toBe(true);
        expect(setActiveCell.mock.calls).toEqual([
            [0, 3, { focus: true }],
            [0, 1, { focus: true }],
        ]);
    });

    it('ignores keys it does not handle', () => {
        const { nav, setActiveCell } = setup(grid, { rowIndex: 0, columnIndex: 0 });
        const event = keydown('Enter');

        expect(nav.tryNavigate(event)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        expect(setActiveCell).not.toHaveBeenCalled();
    });

    it('consumes the arrow key but moves nothing on an empty grid', () => {
        const { nav, setActiveCell } = setup(emptyGrid);
        const event = keydown('ArrowDown');

        expect(nav.tryNavigate(event)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(setActiveCell).not.toHaveBeenCalled();
    });
});
