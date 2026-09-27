# TODOs before conversion

- convert all $event to (e) and use the corresponding event type so that the conversion is done correctly
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
