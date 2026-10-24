/**
 * A database colour is any `#rrggbb` value the picker produces (lower case when stored); it is not
 * limited to a palette. `resolveDbColor` prefers the server row, which is where a file source keeps
 * its colour.
 */
export function normalizeDbColor(value: string | null | undefined) {
    const normalizedValue = value?.trim().toLowerCase();
    return normalizedValue && /^#[0-9a-f]{6}$/.test(normalizedValue) ? normalizedValue : undefined;
}

/** The color a tab shows for its connection: a file source carries it on the server row. */
export function resolveDbColor(source: { serverColor?: string; connectionColor?: string }) {
    return normalizeDbColor(source.serverColor) ?? normalizeDbColor(source.connectionColor);
}
