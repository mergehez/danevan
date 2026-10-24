import { computed, defineComponent, type PropType } from 'vue';
import { Icon } from '../Icon.tsx';
import {
    ColorPickerCanvas,
    ColorPickerEyeDropper,
    ColorPickerInputHex,
    ColorPickerRoot,
    ColorPickerSliderAlpha,
    ColorPickerSliderBlue,
    ColorPickerSliderGreen,
    ColorPickerSliderHue,
    ColorPickerSliderRed,
    useColorPicker,
} from './VuelorPicker.tsx';

/**
 * The colour canvas/sliders panel from `VuelorPicker`, composed the way the editor uses it. A
 * database colour is a solid tag, so `hex` (no alpha) is the default; the picker is free-form, not
 * limited to a palette.
 */
export const ColorPicker = defineComponent({
    name: 'ColorPicker',
    props: {
        value: { type: String as PropType<string | null | undefined>, default: undefined },
        onChange: { type: Function as PropType<(value: string | undefined) => void>, default: undefined },
        format: { type: String as PropType<'hex' | 'hexa'>, default: 'hex' },
        class: { type: String, default: undefined },
    },
    setup(props) {
        const state = useColorPicker({
            value: () => props.value,
            onChange: (value) => props.onChange?.(value),
            format: props.format,
        });

        const showAlpha = computed(() => state.isAlphaEnabled.value);

        return () => (
            <ColorPickerRoot state={state} class={props.class}>
                <ColorPickerCanvas state={state} />
                <ColorPickerSliderHue state={state} />
                <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                    {showAlpha.value ? (
                        <>
                            <span class="text-xs font-bold">A</span>
                            <ColorPickerSliderAlpha state={state} />
                        </>
                    ) : null}
                    <span class="text-xs font-bold">R</span>
                    <ColorPickerSliderRed state={state} />
                    <span class="text-xs font-bold">G</span>
                    <ColorPickerSliderGreen state={state} />
                    <span class="text-xs font-bold">B</span>
                    <ColorPickerSliderBlue state={state} />
                </div>
                <div class="flex gap-2 w-full items-center">
                    <ColorPickerEyeDropper state={state} class="inline-flex items-center justify-center p-1">
                        <Icon icon="icon-[mdi--eyedropper]" />
                    </ColorPickerEyeDropper>
                    <ColorPickerInputHex state={state} />
                </div>
            </ColorPickerRoot>
        );
    },
});

export default ColorPicker;
