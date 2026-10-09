import { effectScope } from 'vue';
import { useCache } from '../shared/utils/useCache';

/**
 * Preferences of the "Edit cell value" dialog. They are app-wide, not per table,
 * so every grid instance shares one cached object.
 *
 * The cache lives in a detached scope: `useCache`'s persistence watcher would
 * otherwise belong to the first grid that mounted it and stop writing when that
 * grid unmounts.
 */
const preferencesScope = effectScope(true);

export const DATA_GRID_MODAL_PREFERENCES_KEY = 'data-grid-modal-editor';

export const dataGridModalPreferences = preferencesScope.run(() =>
    useCache({
        key: DATA_GRID_MODAL_PREFERENCES_KEY,
        initialValue: () => ({ textWrap: false }),
    })
)!;
