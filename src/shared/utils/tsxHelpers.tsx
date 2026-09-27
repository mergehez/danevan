import { type DefineSetupFnComponent, type VNodeChild, defineComponent, h } from 'vue';

type SetupContext<Expose = {}> = {
    attrs: Record<string, unknown>;
    expose: (exposed?: Expose) => void;
    slots: Readonly<Record<string, ((...args: any[]) => VNodeChild) | undefined>>;
};
type Setup<TProps = any, TExpose = {}> = (props: TProps, context: SetupContext<TExpose>) => () => VNodeChild;

// Components declare their models as `onChange` / `onOpenChange` callbacks; Vue's own `v-model`
// hands the component `onUpdate:modelValue` / `onUpdate:open` instead. Since a declared prop never
// reaches `attrs`, a read of the callback name falls back to the standard one when it is absent.
function standardModelProp(property: string) {
    return property === 'onChange' ? 'onUpdate:modelValue' : `onUpdate:${property.charAt(2).toLowerCase()}${property.slice(3, -'Change'.length)}`;
}

function isModelCallback(property: PropertyKey): property is string {
    return typeof property === 'string' && property.startsWith('on') && property.endsWith('Change');
}

function withSlots<TProps extends Record<string, unknown>, TExpose = {}>(props: TProps, context: SetupContext<TExpose>): TProps {
    return new Proxy(props, {
        get(target, property, receiver) {
            if (property === 'tdClasses') {
                console.log('withSlots: tdClasses', target, context);
            }
            if (isModelCallback(property)) {
                const own = Reflect.get(target, property, receiver);
                if (own !== undefined) return own;
                const standard = context.attrs[standardModelProp(property)];
                if (standard !== undefined) return standard;
            }
            if (property === 'slots') {
                const slots = Reflect.get(target, property, receiver);
                if (context.slots.default) {
                    const s = slots && typeof slots === 'object' ? slots : ({} as any);
                    if (!s.default && context.slots.default) {
                        // console.log('withSlots: merging slots', slots, toValue(target));
                        s.default = context.slots.default;
                        return s;
                    }
                }
                return slots ?? context.slots;
            }

            return Reflect.get(target, property, receiver);
        },
    });
}

export function componentGeneric<Props extends Record<string, any>, TExpose extends Record<string, any> = {}>(
    setup: (props: Props, context: SetupContext<TExpose>) => () => VNodeChild,
    options: { layout?: any; props: readonly string[]; name?: string }
) {
    const genericComponent = defineComponent(
        (props: Props, { attrs, expose, slots }: SetupContext<TExpose>) => {
            const context: SetupContext<TExpose> = { attrs, slots, expose };

            return setup(withSlots(props as Props, context), context);
        },
        {
            name: options.name,
            props: [...options.props],
        }
    );
    if (options.layout) {
        Object.assign(genericComponent, { layout: options.layout });
    }
    return genericComponent;
}

type TsxComponent<Props> = (props: Props) => any;
type NativeAttrs = import('vue').HTMLAttributes & import('vue').TextareaHTMLAttributes;
// Distribute native attributes over each member of a props union. Without
// this, `keyof TProps` only contains keys shared by every union member and
// Vue's `DefineComponent` loses variant-specific props such as `as` or `href`.
type ComponentProps<TProps extends object> = TProps extends unknown ? TProps & Partial<Omit<NativeAttrs, keyof TProps>> : never;
export function component<TProps extends object, TContext extends SetupContext = SetupContext>(
    setup: (props: TProps, context: TContext) => () => VNodeChild,
    options?: { name?: string; layout?: any; props?: readonly string[]; inheritAttrs?: boolean }
): DefineSetupFnComponent<ComponentProps<TProps>>;
export function component<P>(options: { name?: string; layout?: any; props?: P; setup: (props: P) => () => any }): TsxComponent<P>;
export function component(
    setupOrOptions: Setup | { name?: string; props?: unknown; setup: Setup },
    _options?: { name?: string; layout?: any; props?: readonly string[]; inheritAttrs?: boolean }
): unknown {
    if (typeof setupOrOptions === 'function') {
        const setup = (props: Record<string, unknown>, context: SetupContext) => setupOrOptions(withSlots(props, context), context);
        const component = defineComponent(setup, {
            props: _options?.props ? [..._options.props] : undefined,
            inheritAttrs: _options?.inheritAttrs,
        });
        if (_options?.layout) {
            Object.assign(component, { layout: _options.layout });
        }
        if (_options?.name) {
            Object.assign(component, { name: _options.name });
        }
        return component;
    }

    const options = setupOrOptions.name ? { name: setupOrOptions.name } : {};
    const setup = (props: Record<string, unknown>, context: SetupContext) => setupOrOptions.setup(withSlots(props, context), context);
    const component = defineComponent(setup, {
        ...options,
        props: setupOrOptions.props as string[] | undefined,
        inheritAttrs: _options?.inheritAttrs,
    });
    return 'layout' in setupOrOptions && setupOrOptions.layout ? Object.assign(component, { layout: setupOrOptions.layout }) : component;
}

export const defineSlots = 0 as unknown as never;
export const defineEmits = 0 as unknown as never;
export const defineProps = 0 as unknown as never;
export const defineOptions = 0 as unknown as never;

export type SingleChildSlot = ((...args: any[]) => VNodeChild) | { default?: (...args: any[]) => VNodeChild };
export function renderSlot(slots?: SingleChildSlot, fallback?: () => VNodeChild): VNodeChild {
    return typeof slots === 'function' ? slots() : (slots?.default?.() ?? fallback?.());
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};
type EventCallback<T> = { bivarianceHack(value: T): void }['bivarianceHack'];
export function vModel<T extends Record<string, any>, K extends keyof T>(refOrComputed: T, key: K): Prettify<{ onChange: EventCallback<T[K]>; modelValue: T[K] }>;
export function vModel<T extends Record<string, any>, K extends keyof T, A extends string>(
    refOrComputed: T,
    key: K,
    modelName: A
): Prettify<
    { [P in `on${Capitalize<A>}Change`]: (v?: any) => void } & {
        [P in A]: T[K];
    }
>;
export function vModel<T extends Record<string, any>, K extends keyof T, A extends string = 'modelValue'>(
    refOrComputed: T,
    key: K,
    modelName?: A
): Prettify<
    { [P in `on${Capitalize<A>}Change`]: EventCallback<T[K]> } & {
        [P in A]: T[K];
    }
> {
    modelName ??= 'modelValue' as A;
    const onUpdateKey = modelName === 'modelValue' ? 'onChange' : `on${modelName.charAt(0).toUpperCase()}${modelName.slice(1)}Change`;
    return {
        [modelName]: refOrComputed[key],
        [onUpdateKey]: (v: T[K]) => {
            refOrComputed[key] = v;
        },
    } as any;
}

type EnforceAllKeys<AllKeys extends string | number | symbol, TKeys extends readonly AllKeys[]> =
    Exclude<AllKeys, TKeys[number]> extends never
        ? unknown // All keys are present!
        : { missing: Exclude<AllKeys, TKeys[number]> };
type AllPossibleKeys<T> = T extends any ? keyof T : never;
// 2. Curried function for partial inference
export function ensureAllTsxProps<TProps>() {
    type AllKeys = AllPossibleKeys<TProps>;
    // The `const` modifier ensures TypeScript reads the array as literal values
    return function <const TKeys extends readonly AllKeys[]>(keys: TKeys & EnforceAllKeys<AllKeys, TKeys>) {
        return keys as unknown as (keyof TProps)[];
    };
}

// Same idea for the `emits` option: checks the runtime emits array against the
// `Emits` type (compile-time only), so a missing emit name is a type error.
export function ensureAllTsxEmits<TEmits>() {
    type AllKeys = AllPossibleKeys<TEmits>;
    return function <const TKeys extends readonly AllKeys[]>(keys: TKeys & EnforceAllKeys<AllKeys, TKeys>) {
        return keys as unknown as AllKeys[];
    };
}
// // Type helper used on the defineComponent `props` option so the runtime props
// // array is checked against the Props type (compile-time only).
// export function ensureAllTsxProps<T>(arr: Exclude<T, undefined>) {
//     type Props = Exclude<T, undefined>;
//     return arr as unknown as Props; // extends { props: infer P } ? P : never;
// }

// Apply prop defaults to a props object (replaces Vue's withDefaults macro in
// render-function components). `defaults` may contain plain values or factories.
// The return type makes any defaulted key non-optional (mirroring Vue's
// withDefaults), so e.g. `step?: number` with default `{ step: 1 }` becomes
// `step: number` after the call.
//
// Each default value is typed as `T[K] | ((props: T) => T[K])`, so a factory
// like `(_) => uniqueId()` gets its `_` parameter contextually typed as the
// props object (no implicit `any`).
type DefaultValue<T, K extends keyof T> = T[K] | ((props: T) => T[K]);

export function tsxWithDefaults<T extends Record<string, any>, D extends { [K in keyof T]?: DefaultValue<T, K> }>(
    props: T,
    defaults: D
): T & { [K in keyof D]-?: K extends keyof T ? NonNullable<T[K]> : never } {
    type Result = T & { [K in keyof D]-?: K extends keyof T ? NonNullable<T[K]> : never };

    // Do not spread `props`: Vue's setup props are reactive, while spreading
    // them creates a static snapshot. Resolve defaults lazily through a Proxy
    // so reads still go through the original reactive props object.
    return new Proxy(props, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (value !== undefined || typeof key !== 'string' || !(key in defaults)) {
                return value;
            }

            const defaultValue = defaults[key as keyof D];
            return typeof defaultValue === 'function' ? defaultValue(props) : defaultValue;
        },
    }) as Result;
}

export const Component = (props: { is: any } & Record<string, any>, { slots }: { slots: Record<string, (...args: any[]) => any> }) => {
    const { is, slots: _, ...rest } = props;
    return h(is, rest, slots);
};

export function prevented<T extends Event>(cb: (e: T) => void) {
    return (e: T) => {
        e.preventDefault();
        e.stopPropagation();
        cb(e);
    };
}

// Vue's `.self` modifier: only fire when the event target is the element itself.
export function selfOnly<T extends Event>(cb: (e: T) => void) {
    return (e: T) => {
        if (e.target === e.currentTarget) {
            cb(e);
        }
    };
}

// `v-model.number` on a text field: an empty or non-numeric value stays empty instead of becoming NaN,
// which is also what the `'' | number` form fields expect.
export function looseToNumber(value: string): '' | number {
    const parsed = parseFloat(value);

    return Number.isNaN(parsed) ? '' : parsed;
}
