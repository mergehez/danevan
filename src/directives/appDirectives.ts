import type { App, ComponentCustomProps, Directive } from 'vue';
import { type ContextMenuBindingValue, vContextMenu } from './VContextMenu';
import { type ErrorBindingValue, vError } from './VError';
import { type LoadingBindingValue, vLoading } from './VLoading';
import { type TooltipBindingValue, vTooltip } from './VTooltip';

// JSX cannot express dotted directive modifiers, so a directive name is invisible to the compiler and a
// wrong binding silently does nothing at runtime. Declaring the names here makes tsserver check the
// binding, complete the attribute and show its type on hover; each type comes from the directive it
// belongs to. These are also the directive names `main.ts` registers (checked below).
declare module 'vue' {
    interface ComponentCustomProps {
        'v-loading'?: LoadingBindingValue;
        'v-tooltip'?: TooltipBindingValue;
        'v-menu'?: ContextMenuBindingValue;
        'v-error'?: ErrorBindingValue;
    }
}

type DirectiveNames = keyof ComponentCustomProps extends `v-${infer TName}` ? TName : never;

// Single source of truth for registration: `main.ts` installs this map, and `DirectiveNames` keeps it in
// sync with the declarations above — a directive cannot be registered without being declared, or
// declared without being registered.
export const appDirectives = {
    loading: vLoading,
    tooltip: vTooltip,
    menu: vContextMenu,
    error: vError,
} satisfies Record<DirectiveNames, Directive<any, any, string>>;

export function installAppDirectives(app: App) {
    // Widened, not asserted: `app.directive` takes one directive type while the map holds all of them.
    const directives: Record<string, Directive<any, any, string>> = appDirectives;

    for (const [name, directive] of Object.entries(directives)) {
        app.directive(name, directive);
    }
}
