import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

/**
 * The lock a read-only connection shows in the sidebar. A file source has no connection row of its
 * own, so its source row carries the mark; a server connection shows it on its connection row.
 */
export const ReadOnlyLock = component(
    () => () => (
        <span
            v-tooltip={{ value: 'Read-only connection: writes are refused', xs: true, nowrap: true }}
            data-testid="readonly-lock"
            aria-label="Read-only connection"
            class="icon-[mdi--lock-outline] ml-1 text-2xs leading-none text-amber-200"
        />
    ),
    { name: 'ReadOnlyLock', props: ensureAllTsxProps<{ foo?: never }>()(['foo']) }
);

export default ReadOnlyLock;
