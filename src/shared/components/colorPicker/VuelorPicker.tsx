import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type PropType, type Ref } from 'vue';

type RGBA = { r: number; g: number; b: number; a: number };
type HSVA = { h: number; s: number; v: number; a: number };

export type ColorPickerState = {
    rgba: Ref<RGBA>;
    hsva: Ref<HSVA>;
    alpha: Ref<number>;
    disabled: ComputedRef<boolean>;
    isAlphaEnabled: ComputedRef<boolean>;
    hex: ComputedRef<string>;
    hexa: Ref<string>;
    commitValue: () => void;
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function channelToHex(value: number) {
    return Math.round(clamp(value, 0, 255))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
}

function rgbaToHex(rgba: RGBA) {
    return `#${channelToHex(rgba.r)}${channelToHex(rgba.g)}${channelToHex(rgba.b)}`;
}

function rgbaToHexa(rgba: RGBA) {
    return `${rgbaToHex(rgba)}${channelToHex(rgba.a * 255)}`;
}

const NAMED_COLORS: Record<string, string> = {
    transparent: '00000000',
    aliceblue: 'F0F8FF',
    antiquewhite: 'FAEBD7',
    aqua: '00FFFF',
    aquamarine: '7FFFD4',
    azure: 'F0FFFF',
    beige: 'F5F5DC',
    bisque: 'FFE4C4',
    black: '000000',
    blanchedalmond: 'FFEBCD',
    blue: '0000FF',
    blueviolet: '8A2BE2',
    brown: 'A52A2A',
    burlywood: 'DEB887',
    cadetblue: '5F9EA0',
    chartreuse: '7FFF00',
    chocolate: 'D2691E',
    coral: 'FF7F50',
    cornflowerblue: '6495ED',
    cornsilk: 'FFF8DC',
    crimson: 'DC143C',
    cyan: '00FFFF',
    darkblue: '00008B',
    darkcyan: '008B8B',
    darkgoldenrod: 'B8860B',
    darkgray: 'A9A9A9',
    darkgreen: '006400',
    darkgrey: 'A9A9A9',
    darkkhaki: 'BDB76B',
    darkmagenta: '8B008B',
    darkolivegreen: '556B2F',
    darkorange: 'FF8C00',
    darkorchid: '9932CC',
    darkred: '8B0000',
    darksalmon: 'E9967A',
    darkseagreen: '8FBC8F',
    darkslateblue: '483D8B',
    darkslategray: '2F4F4F',
    darkslategrey: '2F4F4F',
    darkturquoise: '00CED1',
    darkviolet: '9400D3',
    deeppink: 'FF1493',
    deepskyblue: '00BFFF',
    dimgray: '696969',
    dimgrey: '696969',
    dodgerblue: '1E90FF',
    firebrick: 'B22222',
    floralwhite: 'FFFAF0',
    forestgreen: '228B22',
    fuchsia: 'FF00FF',
    gainsboro: 'DCDCDC',
    ghostwhite: 'F8F8FF',
    gold: 'FFD700',
    goldenrod: 'DAA520',
    gray: '808080',
    green: '008000',
    greenyellow: 'ADFF2F',
    grey: '808080',
    honeydew: 'F0FFF0',
    hotpink: 'FF69B4',
    indianred: 'CD5C5C',
    indigo: '4B0082',
    ivory: 'FFFFF0',
    khaki: 'F0E68C',
    lavender: 'E6E6FA',
    lavenderblush: 'FFF0F5',
    lawngreen: '7CFC00',
    lemonchiffon: 'FFFACD',
    lightblue: 'ADD8E6',
    lightcoral: 'F08080',
    lightcyan: 'E0FFFF',
    lightgoldenrodyellow: 'FAFAD2',
    lightgray: 'D3D3D3',
    lightgreen: '90EE90',
    lightgrey: 'D3D3D3',
    lightpink: 'FFB6C1',
    lightsalmon: 'FFA07A',
    lightseagreen: '20B2AA',
    lightskyblue: '87CEFA',
    lightslategray: '778899',
    lightslategrey: '778899',
    lightsteelblue: 'B0C4DE',
    lightyellow: 'FFFFE0',
    lime: '00FF00',
    limegreen: '32CD32',
    linen: 'FAF0E6',
    magenta: 'FF00FF',
    maroon: '800000',
    mediumaquamarine: '66CDAA',
    mediumblue: '0000CD',
    mediumorchid: 'BA55D3',
    mediumpurple: '9370DB',
    mediumseagreen: '3CB371',
    mediumslateblue: '7B68EE',
    mediumspringgreen: '00FA9A',
    mediumturquoise: '48D1CC',
    mediumvioletred: 'C71585',
    midnightblue: '191970',
    mintcream: 'F5FFFA',
    mistyrose: 'FFE4E1',
    moccasin: 'FFE4B5',
    navajowhite: 'FFDEAD',
    navy: '000080',
    oldlace: 'FDF5E6',
    olive: '808000',
    olivedrab: '6B8E23',
    orange: 'FFA500',
    orangered: 'FF4500',
    orchid: 'DA70D6',
    palegoldenrod: 'EEE8AA',
    palegreen: '98FB98',
    paleturquoise: 'AFEEEE',
    palevioletred: 'DB7093',
    papayawhip: 'FFEFD5',
    peachpuff: 'FFDAB9',
    peru: 'CD853F',
    pink: 'FFC0CB',
    plum: 'DDA0DD',
    powderblue: 'B0E0E6',
    purple: '800080',
    rebeccapurple: '663399',
    red: 'FF0000',
    rosybrown: 'BC8F8F',
    royalblue: '4169E1',
    saddlebrown: '8B4513',
    salmon: 'FA8072',
    sandybrown: 'F4A460',
    seagreen: '2E8B57',
    seashell: 'FFF5EE',
    sienna: 'A0522D',
    silver: 'C0C0C0',
    skyblue: '87CEEB',
    slateblue: '6A5ACD',
    slategray: '708090',
    slategrey: '708090',
    snow: 'FFFAFA',
    springgreen: '00FF7F',
    steelblue: '4682B4',
    tan: 'D2B48C',
    teal: '008080',
    thistle: 'D8BFD8',
    tomato: 'FF6347',
    turquoise: '40E0D0',
    violet: 'EE82EE',
    wheat: 'F5DEB3',
    white: 'FFFFFF',
    whitesmoke: 'F5F5F5',
    yellow: 'FFFF00',
    yellowgreen: '9ACD32',
};

function hexToRgba(value: string | null | undefined) {
    const normalized = value?.trim();
    if (!normalized) {
        return null;
    }

    const named = NAMED_COLORS[normalized.toLowerCase()];
    if (named) {
        const hex = named;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a } satisfies RGBA;
    }

    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
    if (![6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) {
        return null;
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a } satisfies RGBA;
}

function rgbaToHsva(rgba: RGBA): HSVA {
    const r = rgba.r / 255;
    const g = rgba.g / 255;
    const b = rgba.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta !== 0) {
        if (max === r) {
            h = 60 * (((g - b) / delta) % 6);
        } else if (max === g) {
            h = 60 * ((b - r) / delta + 2);
        } else {
            h = 60 * ((r - g) / delta + 4);
        }
    }

    if (h < 0) {
        h += 360;
    }

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max,
        a: rgba.a,
    };
}

function hsvaToRgba(hsva: HSVA): RGBA {
    const h = ((hsva.h % 360) + 360) % 360;
    const c = hsva.v * hsva.s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = hsva.v - c;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
        a: clamp(hsva.a, 0, 1),
    };
}

function sliderClass(className?: string) {
    return ['relative h-4 w-full cursor-pointer appearance-none rounded-full', className].filter(Boolean).join(' ');
}

function handleRangeInput(event: Event, update: (value: number) => void) {
    const target = event.target as HTMLInputElement;
    update(Number(target.value));
}

export const ColorPickerRoot = defineComponent({
    name: 'ColorPickerRoot',
    props: {
        state: { type: Object as PropType<ColorPickerState>, required: true },
        class: { type: String },
    },
    setup(props, { slots, expose }) {
        const state = props.state;

        expose({
            color: {
                rgba: state.rgba,
                hsva: state.hsva,
                alpha: state.alpha,
                hex: state.hex,
                hexa: state.hexa,
            },
        });

        return () => <div class={['w-60 rounded-[13px] bg-x2 p-4 shadow-md flex flex-col gap-2', props.class].filter(Boolean).join(' ')}>{slots.default?.()}</div>;
    },
});

export function useColorPicker(options: {
    value: () => string | null | undefined;
    onChange?: (value: string) => void;
    defaultValue?: string;
    disabled?: boolean;
    format?: string;
}) {
    const fallback = hexToRgba(options.defaultValue ?? '#B63DDAFF') ?? { r: 182, g: 61, b: 218, a: 1 };
    const rgba = ref<RGBA>(fallback);
    const lastEmittedValue = ref<string | null>(null);
    const disabled = computed(() => options.disabled === true);
    const isAlphaEnabled = computed(() => ['hexa', 'rgba', 'hsva', 'object'].includes(options.format ?? 'hexa'));
    const hex = computed(() => rgbaToHex(rgba.value));
    const hexa = computed({
        get: () => rgbaToHexa(rgba.value),
        set: (value: string) => {
            const parsed = hexToRgba(value);
            if (parsed) {
                rgba.value = parsed;
            }
        },
    });
    const alpha = computed({
        get: () => Math.round(rgba.value.a * 100),
        set: (value: number) => {
            rgba.value = { ...rgba.value, a: clamp(value, 0, 100) / 100 };
        },
    });
    const hsva = computed({
        get: () => rgbaToHsva(rgba.value),
        set: (value: HSVA) => {
            rgba.value = hsvaToRgba(value);
        },
    });

    // `hex` leaves the alpha out (a solid tag); `hexa` keeps it. Both emit in lower case, which is
    // what a CSS/store value is compared with.
    function currentValue() {
        return (options.format === 'hex' ? rgbaToHex(rgba.value) : rgbaToHexa(rgba.value)).toLowerCase();
    }

    function syncFromModel(value: string | null | undefined) {
        const parsed = hexToRgba(value) ?? fallback;
        rgba.value = parsed;
        lastEmittedValue.value = value ? value.toLowerCase() : currentValue();
    }

    function emitValue() {
        const nextValue = currentValue();
        if (nextValue === lastEmittedValue.value) {
            return;
        }

        lastEmittedValue.value = nextValue;
        options.onChange?.(nextValue);
    }

    watch(options.value, (value) => syncFromModel(value), { immediate: true });

    watch(
        rgba,
        () => {
            emitValue();
        },
        { deep: true }
    );

    function commitValue() {
        emitValue();
    }

    return {
        rgba,
        hsva,
        alpha,
        disabled,
        isAlphaEnabled,
        hex,
        hexa,
        commitValue,
    } satisfies ColorPickerState;
}

export const ColorPickerCanvas = defineComponent({
    name: 'ColorPickerCanvas',
    props: {
        state: { type: Object as PropType<ColorPickerState>, required: true },
        type: { type: String as PropType<'HSV' | 'HSL'>, default: 'HSV' },
        wheel: { type: Boolean, default: true },
        class: { type: String },
    },
    setup(props) {
        const context = props.state;
        const rootRef = ref<HTMLDivElement | null>(null);
        const bounds = ref({ left: 0, top: 0, width: 1, height: 1 });

        function updateBounds() {
            const element = rootRef.value;
            if (!element) {
                return;
            }
            const rect = element.getBoundingClientRect();
            bounds.value = { left: rect.left, top: rect.top, width: rect.width || 1, height: rect.height || 1 };
        }

        function updateFromPointer(event: PointerEvent) {
            event.preventDefault();
            const x = clamp(event.clientX - bounds.value.left, 0, bounds.value.width) / bounds.value.width;
            const y = clamp(event.clientY - bounds.value.top, 0, bounds.value.height) / bounds.value.height;
            context.hsva.value = { ...context.hsva.value, s: x, v: 1 - y };
        }

        function stopPointer() {
            document.removeEventListener('pointermove', updateFromPointer);
            document.removeEventListener('pointerup', stopPointer);
            context.commitValue();
        }

        function onPointerDown(event: PointerEvent) {
            if (context.disabled.value) {
                return;
            }
            updateBounds();
            document.addEventListener('pointermove', updateFromPointer);
            document.addEventListener('pointerup', stopPointer, { once: true });
            updateFromPointer(event);
        }

        function onWheel(event: WheelEvent) {
            if (!props.wheel || context.disabled.value) {
                return;
            }
            event.preventDefault();
            context.hsva.value = { ...context.hsva.value, h: (((context.hsva.value.h + event.deltaY * 0.1) % 360) + 360) % 360 };
            context.commitValue();
        }

        onMounted(() => window.addEventListener('resize', updateBounds));
        onBeforeUnmount(() => {
            window.removeEventListener('resize', updateBounds);
            document.removeEventListener('pointermove', updateFromPointer);
            document.removeEventListener('pointerup', stopPointer);
        });

        const thumbStyle = computed(() => ({
            left: `${context.hsva.value.s * 100}%`,
            top: `${(1 - context.hsva.value.v) * 100}%`,
            backgroundColor: `rgba(${context.rgba.value.r}, ${context.rgba.value.g}, ${context.rgba.value.b}, 1)`,
            transform: 'translate(-50%, -50%)',
        }));
        const canvasStyle = computed(() => ({
            background: ['linear-gradient(to bottom, transparent, black)', 'linear-gradient(to right, white, transparent)', `hsl(${context.hsva.value.h}deg 100% 50%)`].join(', '),
        }));

        return () => (
            <div
                ref={rootRef}
                style={canvasStyle.value}
                class={['relative h-52 w-full touch-none rounded-[5px] shadow-inner', context.disabled.value ? 'pointer-events-none opacity-50' : '', props.class]
                    .filter(Boolean)
                    .join(' ')}
                onContextmenu={(event) => event.preventDefault()}
                onPointerdown={onPointerDown}
                onWheel={onWheel}
            >
                <span tabindex={0} class="absolute block h-4 w-4 rounded-full border-4 border-white shadow-md outline-none" style={thumbStyle.value}></span>
            </div>
        );
    },
});

function createRangeSlider(
    name: string,
    getValue: (context: ColorPickerState) => number,
    setValue: (context: ColorPickerState, value: number) => void,
    getBackground: (context: ColorPickerState) => string,
    max: number,
    step = 1
) {
    return defineComponent({
        name,
        props: {
            state: { type: Object as PropType<ColorPickerState>, required: true },
            class: { type: String },
            orientation: { type: String as PropType<'horizontal' | 'vertical'>, default: 'horizontal' },
        },
        setup(props) {
            const context = props.state;
            const style = computed(() => ({ background: getBackground(context) }));

            return () => (
                <input
                    type="range"
                    min={0}
                    max={max}
                    step={step}
                    disabled={context.disabled.value}
                    value={getValue(context)}
                    class={sliderClass(props.class)}
                    style={style.value}
                    onInput={(event) => handleRangeInput(event, (value) => setValue(context, value))}
                    onChange={() => context.commitValue()}
                />
            );
        },
    });
}

export const ColorPickerSliderHue = createRangeSlider(
    'ColorPickerSliderHue',
    (context) => context.hsva.value.h,
    (context, value) => {
        context.hsva.value = { ...context.hsva.value, h: value };
    },
    () => 'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)',
    360
);

export const ColorPickerSliderAlpha = createRangeSlider(
    'ColorPickerSliderAlpha',
    (context) => context.alpha.value,
    (context, value) => {
        context.alpha.value = value;
    },
    (context) => {
        return [`linear-gradient(to right, rgba(0, 0, 0, 0) 0%, ${context.hex.value} 100%)`, 'repeating-conic-gradient(#ddd 0% 25%, transparent 0% 50%) 50% / 8px 8px'].join(',');
    },
    100
);

export const ColorPickerSliderRed = createRangeSlider(
    'ColorPickerSliderRed',
    (context) => context.rgba.value.r,
    (context, value) => {
        context.rgba.value = { ...context.rgba.value, r: value };
    },
    (context) => {
        return `linear-gradient(to right, rgb(0, ${context.rgba.value.g}, ${context.rgba.value.b}), rgb(255, ${context.rgba.value.g}, ${context.rgba.value.b}))`;
    },
    255
);

export const ColorPickerSliderGreen = createRangeSlider(
    'ColorPickerSliderGreen',
    (context) => context.rgba.value.g,
    (context, value) => {
        context.rgba.value = { ...context.rgba.value, g: value };
    },
    (context) => {
        return `linear-gradient(to right, rgb(${context.rgba.value.r}, 0, ${context.rgba.value.b}), rgb(${context.rgba.value.r}, 255, ${context.rgba.value.b}))`;
    },
    255
);

export const ColorPickerSliderBlue = createRangeSlider(
    'ColorPickerSliderBlue',
    (context) => context.rgba.value.b,
    (context, value) => {
        context.rgba.value = { ...context.rgba.value, b: value };
    },
    (context) => {
        return `linear-gradient(to right, rgb(${context.rgba.value.r}, ${context.rgba.value.g}, 0), rgb(${context.rgba.value.r}, ${context.rgba.value.g}, 255))`;
    },
    255
);

export const ColorPickerInputHex = defineComponent({
    name: 'ColorPickerInputHex',
    props: {
        state: { type: Object as PropType<ColorPickerState>, required: true },
        class: { type: String },
    },
    setup(props) {
        const context = props.state;

        function onHexBlur(event: Event) {
            const target = event.target as HTMLInputElement;
            const parsed = hexToRgba(`#${target.value.replace(/^#/, '')}${context.isAlphaEnabled.value ? channelToHex(context.rgba.value.a * 255) : ''}`);
            if (!parsed) {
                target.value = context.hex.value.replace('#', '');
                return;
            }
            context.rgba.value = { ...parsed, a: context.rgba.value.a };
            context.commitValue();
        }

        function onAlphaBlur(event: Event) {
            const target = event.target as HTMLInputElement;
            const nextValue = Number(target.value);
            if (Number.isNaN(nextValue)) {
                target.value = `${context.alpha.value}`;
                return;
            }
            context.alpha.value = nextValue;
            context.commitValue();
        }

        function onAlphaKeyDown(event: KeyboardEvent) {
            const key = event.key;
            const step = event.shiftKey ? 10 : 1;
            if (key === 'ArrowUp') {
                event.preventDefault();
                context.alpha.value = clamp(context.alpha.value + step, 0, 100);
                context.commitValue();
            } else if (key === 'ArrowDown') {
                event.preventDefault();
                context.alpha.value = clamp(context.alpha.value - step, 0, 100);
                context.commitValue();
            }
        }

        return () => (
            <div
                class={[
                    'flex w-full gap-px rounded-[5px] outline-1 outline-x4 focus-within:outline-x6 px-1 items-center',
                    context.disabled.value ? 'pointer-events-none opacity-50' : '',
                    props.class,
                ]
                    .filter(Boolean)
                    .join(' ')}
            >
                <span class="select-none text-[11px] opacity-40">#</span>
                <input
                    type="text"
                    name="hex"
                    aria-label="Hex"
                    value={context.hex.value.replace('#', '')}
                    disabled={context.disabled.value}
                    class="h-6 min-w-5 flex-1 bg-transparent text-[11px] focus:outline-none"
                    onBlur={onHexBlur}
                />
                {context.isAlphaEnabled.value ? (
                    <>
                        <input
                            type="text"
                            name="opacity"
                            aria-label="Opacity"
                            value={context.alpha.value}
                            disabled={context.disabled.value}
                            class="h-6 w-5 bg-transparent text-[11px] focus:outline-none"
                            onBlur={onAlphaBlur}
                            onKeydown={onAlphaKeyDown}
                        />
                        <span class="select-none text-[11px] opacity-40">%</span>
                    </>
                ) : null}
            </div>
        );
    },
});

export const ColorPickerEyeDropper = defineComponent({
    name: 'ColorPickerEyeDropper',
    props: {
        state: { type: Object as PropType<ColorPickerState>, required: true },
        class: { type: String },
    },
    setup(props, { slots }) {
        const context = props.state;
        const isSupported = computed(() => typeof window !== 'undefined' && 'EyeDropper' in window);

        async function openEyeDropper() {
            if (!isSupported.value || context.disabled.value) {
                return;
            }

            try {
                const EyeDropperClass = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
                const eyeDropper = EyeDropperClass ? new EyeDropperClass() : null;
                const result = await eyeDropper?.open();
                if (result?.sRGBHex) {
                    context.hexa.value = `${result.sRGBHex}${channelToHex(context.rgba.value.a * 255)}`;
                    context.commitValue();
                }
            } catch (error) {
                if ((error as Error | undefined)?.name !== 'AbortError') {
                    console.error(error);
                }
            }
        }

        return () =>
            isSupported.value ? (
                <button
                    type="button"
                    disabled={context.disabled.value}
                    class={['rounded-[5px] p-1 enabled:hover:bg-black/5', props.class].filter(Boolean).join(' ')}
                    onClick={openEyeDropper}
                >
                    {slots.default?.()}
                </button>
            ) : null;
    },
});
