import { nextTick } from 'vue';
import { sidebarTreeRef } from './useServerTree';

export function useSidebarKeyboardNavigation() {
    function toggleSidebarRow(currentRow: HTMLElement) {
        const nodeId = currentRow.dataset.nodeId;

        if (nodeId) {
            const toggleButton = sidebarTreeRef.value?.querySelector<HTMLElement>(`[data-sidebar-toggle-for="${CSS.escape(nodeId)}"]`);

            if (toggleButton) {
                toggleButton.click();
                return true;
            }
        }

        if (currentRow.dataset.sidebarSelfToggle === 'true') {
            currentRow.click();
            return true;
        }

        return false;
    }

    function handleSidebarRowKeydown(event: KeyboardEvent) {
        function focusSidebarRow(row: HTMLElement | undefined) {
            if (!row) {
                return;
            }

            row.focus();
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const currentRow = event.currentTarget as HTMLElement;
        const rows = Array.from(sidebarTreeRef.value?.querySelectorAll<HTMLElement>('[data-sidebar-row="true"]') ?? []);
        const currentIndex = rows.findIndex((row) => row === currentRow);

        if (currentIndex < 0) {
            return;
        }

        if (event.metaKey && event.key === 'Enter') {
            event.preventDefault();
            currentRow.openContextMenu({ autoFocus: true });

            nextTick();
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusSidebarRow(rows[currentIndex - 1]);
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusSidebarRow(rows[currentIndex + 1]);
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();

            if (currentRow.dataset.sidebarExpandable === 'true' && currentRow.dataset.sidebarCollapsed === 'false') {
                console.log('toggle');
                toggleSidebarRow(currentRow);
                return;
            }

            const parentId = currentRow.dataset.parentId;

            if (parentId) {
                focusSidebarRow(rows.find((row) => row.dataset.nodeId === parentId));
            }

            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();

            if (currentRow.dataset.sidebarExpandable === 'true' && currentRow.dataset.sidebarCollapsed === 'true') {
                toggleSidebarRow(currentRow);
                return;
            }

            const nodeId = currentRow.dataset.nodeId;

            if (nodeId) {
                focusSidebarRow(rows.find((row) => row.dataset.parentId === nodeId));
            }

            return;
        }

        if (event.key === ' ') {
            event.preventDefault();
            currentRow.click();
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            currentRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }
    }

    return {
        handleSidebarRowKeydown,
    };
}
