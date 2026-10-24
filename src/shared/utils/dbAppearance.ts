/**
 * A database's appearance is free-form: a colour (any `#rrggbb` the picker produces, stored lower
 * case) and a short code of one or two upper-case letters for the tabs.
 */
export function normalizeDbColor(value: string | null | undefined) {
    const normalizedValue = value?.trim().toLowerCase();
    return normalizedValue && /^#[0-9a-f]{6}$/.test(normalizedValue) ? normalizedValue : undefined;
}

/** One or two upper-case letters; anything else is dropped, a longer code keeps its first two. */
export function normalizeDbShortCode(value: string | null | undefined) {
    const normalizedValue = value
        ?.trim()
        .toUpperCase()
        .replaceAll(/[^A-Z]/g, '')
        .slice(0, 2);
    return normalizedValue ? normalizedValue : undefined;
}

/**
 * The appearance a table tab shows for its connection: a file source keeps both on the server row,
 * a server-based database on the connection row.
 */
export function resolveDbAppearance(source: { serverColor?: string; connectionColor?: string; serverShortCode?: string; connectionShortCode?: string }) {
    return {
        color: normalizeDbColor(source.serverColor) ?? normalizeDbColor(source.connectionColor),
        shortCode: normalizeDbShortCode(source.serverShortCode) ?? normalizeDbShortCode(source.connectionShortCode),
    };
}
