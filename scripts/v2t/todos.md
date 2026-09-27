# TODOs before conversion

- convert all `@bla="action($event)"` to `@bla="(e: EventType) => action(e)"`, so that the conversion is done correctly
- try to convert untyped emits to the types variant
    - from
        ```ts
        defineEmits(['eventName']);
        ```
    - to
        ```ts
        defineEmits<{ eventName: [PayloadType] }>();
        ```

# Notes

- during creation of slots types `unknown` is used when the type is too large, please manually refine it if needed
- custom directives with dotted modifiers are not supported in tsx that's why they are converted like this:
    - from:

    ```ts
        v-my-directive.foo.bar="abcde"
    ```

    - to:

    ```ts
        v-my-directive={{ value: "abcde", foo: true, bar: true }}
    ```

    - `value` is hard-coded. the directive has to accept this shape: modifier keys are read with
      `resolveDirectiveModifiers()` (`src/directives/directiveModifiers.ts`), which is what `v-tooltip`,
      `v-menu` and `v-error` do.
    - a modifier name that is not a usable identifier (e.g. `.foo-bar`) is dropped instead of emitted.

- `v-model.number` / `v-model.trim` on a plain element stay `value` + `onInput`, with the coercion in the
  handler (`looseToNumber(e.target.value)`, `e.target.value.trim()`). `v-model` is not used in tsx because
  the directive form is not type-safe.
- a `v-model` modifier on a _component_ is still dropped — `vModel()` spreads `modelValue` + `onChange`
  and has no modifier support; fix that by hand.
- `v-menu.button` in tsx is `v-menu={{ value: getMenuItems, button: true }}` — without the `button` key the
  menu only opens on right-click.
