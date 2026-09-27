// Vue's built-in `v-model` in TSX. TS ignores undeclared hyphenated JSX attributes, so without these
// declarations `v-model` is invisible to the checker:
//
//   <input v-model={form.name} />        checked against the element's own value attribute
//   <Checkbox v-model={state.checked} /> checked against the component's `modelValue` prop
//
// Elements: `HTMLAttributes` covers every element, but Vue types `value` as `any` for all of them
// except `textarea`, so only `textarea` gets a real check. Components: `LibraryManagedAttributes`
// maps `v-model` onto the component's own `modelValue` type — for a required `modelValue` it stands
// in for the prop, otherwise it is an optional alternative.
//
// The `[value, 'arg', ['mod']]` array form is accepted with its first element checked. The
// `v-model_number` / `v-model:arg` spellings stay unchecked: TS never checks those names.
declare module 'vue' {
    interface HTMLAttributes {
        'v-model'?: unknown;
    }

    // The only element whose `value` Vue types itself (`string | number`).
    interface TextareaHTMLAttributes {
        'v-model'?: string | number | undefined;
    }
}

type VModelBinding<M> = M | [M, ...unknown[]];

declare module 'vue/jsx-runtime' {
    namespace JSX {
        type LibraryManagedAttributes<C, P> = P extends { modelValue: infer M }
            ? Omit<P, 'modelValue'> & ({ modelValue: M } | { 'v-model': VModelBinding<M> })
            : P & (P extends { modelValue?: infer M } ? { 'v-model'?: VModelBinding<M> } : {});
    }
}

export {};
