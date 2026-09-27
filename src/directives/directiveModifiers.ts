// TSX cannot express dotted directive modifiers, so the converter folds them into the binding value
// (`v-tooltip.xs.nowrap="'Open'"` -> `v-tooltip={{value: 'Open', xs: true, nowrap: true}}`).
// Keys flagged `true` in the value count as modifiers; real modifiers win when both are present.
export function resolveDirectiveModifiers<Modifiers extends object>(binding: { modifiers?: Modifiers | undefined; value?: unknown }): Modifiers {
    const modifiers: Record<string, boolean> = {};
    const value = binding.value;

    if (value && typeof value === 'object') {
        for (const [key, flag] of Object.entries(value)) {
            if (flag === true) {
                modifiers[key] = true;
            }
        }
    }

    return { ...modifiers, ...binding.modifiers } as Modifiers;
}
