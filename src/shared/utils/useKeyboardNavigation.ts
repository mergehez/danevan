export type KeyboardNavigationGrid = {
    rowCount: number;
    columnCount: number;
};

export type KeyboardNavigationPosition = {
    rowIndex: number;
    columnIndex: number;
};

type KeyboardNavigationEvent = {
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
};

type UseKeyboardNavigationOptions = {
    getGrid: () => KeyboardNavigationGrid;
    getPosition: () => KeyboardNavigationPosition;
    setActiveCell: (rowIndex: number, columnIndex: number, options?: { focus?: boolean }) => void;
};

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
    function hasCells(grid: KeyboardNavigationGrid) {
        return grid.rowCount > 0 && grid.columnCount > 0;
    }

    function getWrappedIndex(index: number, size: number) {
        return ((index % size) + size) % size;
    }

    function getGrid() {
        return options.getGrid();
    }

    function getPosition(position?: KeyboardNavigationPosition) {
        return position ?? options.getPosition();
    }

    function applyTarget(position: KeyboardNavigationPosition | undefined, moveOptions?: { focus?: boolean }) {
        if (!position) {
            return undefined;
        }

        options.setActiveCell(position.rowIndex, position.columnIndex, moveOptions);
        return position;
    }

    function getHorizontalTarget(step: number, position?: KeyboardNavigationPosition) {
        const currentPosition = getPosition(position);
        const grid = getGrid();

        if (!hasCells(grid)) {
            return undefined;
        }

        const totalCellCount = grid.rowCount * grid.columnCount;
        const currentIndex = currentPosition.rowIndex * grid.columnCount + currentPosition.columnIndex;
        const nextIndex = getWrappedIndex(currentIndex + step, totalCellCount);

        return {
            rowIndex: Math.floor(nextIndex / grid.columnCount),
            columnIndex: nextIndex % grid.columnCount,
        } satisfies KeyboardNavigationPosition;
    }

    function getVerticalTarget(step: number, position?: KeyboardNavigationPosition) {
        const currentPosition = getPosition(position);
        const grid = getGrid();

        if (!hasCells(grid)) {
            return undefined;
        }

        const totalCellCount = grid.rowCount * grid.columnCount;
        const currentIndex = currentPosition.columnIndex * grid.rowCount + currentPosition.rowIndex;
        const nextIndex = getWrappedIndex(currentIndex + step, totalCellCount);

        return {
            rowIndex: nextIndex % grid.rowCount,
            columnIndex: Math.floor(nextIndex / grid.rowCount),
        } satisfies KeyboardNavigationPosition;
    }

    function getRowEdgeTarget(toEnd: boolean, position?: KeyboardNavigationPosition) {
        const currentPosition = getPosition(position);
        const grid = getGrid();

        if (!hasCells(grid)) {
            return undefined;
        }

        return {
            rowIndex: currentPosition.rowIndex,
            columnIndex: toEnd ? grid.columnCount - 1 : 0,
        } satisfies KeyboardNavigationPosition;
    }

    function getColumnEdgeTarget(toEnd: boolean, position?: KeyboardNavigationPosition) {
        const currentPosition = getPosition(position);
        const grid = getGrid();

        if (!hasCells(grid)) {
            return undefined;
        }

        return {
            rowIndex: toEnd ? grid.rowCount - 1 : 0,
            columnIndex: currentPosition.columnIndex,
        } satisfies KeyboardNavigationPosition;
    }

    function getTargetPosition(event: KeyboardNavigationEvent, position?: KeyboardNavigationPosition) {
        switch (event.key) {
            case 'ArrowUp':
                return event.metaKey ? getColumnEdgeTarget(false, position) : getVerticalTarget(-1, position);
            case 'ArrowDown':
                return event.metaKey ? getColumnEdgeTarget(true, position) : getVerticalTarget(1, position);
            case 'ArrowLeft':
                return event.metaKey ? getRowEdgeTarget(false, position) : getHorizontalTarget(-1, position);
            case 'ArrowRight':
                return event.metaKey ? getRowEdgeTarget(true, position) : getHorizontalTarget(1, position);
            case 'Tab':
                return getHorizontalTarget(event.shiftKey ? -1 : 1, position);
            default:
                return undefined;
        }
    }

    function moveHorizontally(step: number, moveOptions?: { focus?: boolean }, position?: KeyboardNavigationPosition) {
        return applyTarget(getHorizontalTarget(step, position), moveOptions);
    }

    function moveVertically(step: number, moveOptions?: { focus?: boolean }, position?: KeyboardNavigationPosition) {
        return applyTarget(getVerticalTarget(step, position), moveOptions);
    }

    function moveToRowEdge(toEnd: boolean, moveOptions?: { focus?: boolean }, position?: KeyboardNavigationPosition) {
        return applyTarget(getRowEdgeTarget(toEnd, position), moveOptions);
    }

    function moveToColumnEdge(toEnd: boolean, moveOptions?: { focus?: boolean }, position?: KeyboardNavigationPosition) {
        return applyTarget(getColumnEdgeTarget(toEnd, position), moveOptions);
    }

    function moveByEvent(event: KeyboardNavigationEvent, moveOptions?: { focus?: boolean }, position?: KeyboardNavigationPosition) {
        return applyTarget(getTargetPosition(event, position), moveOptions);
    }

    function tryNavigate(event: KeyboardEvent) {
        switch (event.key) {
            case 'ArrowUp':
                event.preventDefault();
                if (event.metaKey) {
                    moveToColumnEdge(false, { focus: true });
                    return true;
                }

                moveVertically(-1, { focus: true });
                return true;
            case 'ArrowDown':
                event.preventDefault();
                if (event.metaKey) {
                    moveToColumnEdge(true, { focus: true });
                    return true;
                }

                moveVertically(1, { focus: true });
                return true;
            case 'ArrowLeft':
                event.preventDefault();
                if (event.metaKey) {
                    moveToRowEdge(false, { focus: true });
                    return true;
                }

                moveHorizontally(-1, { focus: true });
                return true;
            case 'ArrowRight':
                event.preventDefault();
                if (event.metaKey) {
                    moveToRowEdge(true, { focus: true });
                    return true;
                }

                moveHorizontally(1, { focus: true });
                return true;
            case 'Tab':
                event.preventDefault();
                moveHorizontally(event.shiftKey ? -1 : 1, { focus: true });
                return true;
            default:
                return false;
        }
    }

    return {
        getColumnEdgeTarget,
        getHorizontalTarget,
        getRowEdgeTarget,
        getTargetPosition,
        getVerticalTarget,
        moveByEvent,
        moveHorizontally,
        moveToColumnEdge,
        moveToRowEdge,
        moveVertically,
        tryNavigate,
    };
}
