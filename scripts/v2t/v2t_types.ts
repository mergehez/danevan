// Shared types for the Vue -> TSX converter pipeline.
//
// v2t_parser.ts produces a ParsedComponent: a fully-structured, plain-data
// object with NO Vue AST nodes, NO JSX, and NO references to the source file.
// It ONLY parses — it does not transform the script, build types, or generate
// any output.
//
// t2t_converter.ts consumes the ParsedComponent and emits the final TSX. It
// does ALL output generation (script transformation, type building, JSX,
// assembly) and touches NO Vue APIs and NO source file.

// ---- Template tree (plain data, expressions pre-processed to strings) ----

export type TNode = TElement | TText | TExpr | TComment | TSlot | TIf | TFor | TFragment;

export interface TComment {
    kind: 'comment';
    content: string;
}

export type ExpressionContext = {
    props: string[]; // identifiers exposed as component props in template expressions
    refs: string[]; // setup bindings whose values should be unwrapped like Vue refs
    bindings: string[]; // other setup-scope identifiers that must not be context-prefixed
    locals: string[]; // template-local identifiers from v-for and scoped-slot bindings
};

export type EventHandler = {
    body: string; // raw handler expression from the Vue template
    modifiers: string[]; // Vue event modifiers, such as prevent or enter
    isReference: boolean; // true when body is a callable reference rather than an inline expression
};

export type ParsedExpression = {
    source: string; // raw Vue expression; Vue-specific rewriting is done by the converter
};

export type SourceRange = {
    start: number; // inclusive character offset in the script-setup source
    end: number; // exclusive character offset in the script-setup source
};

export type ScriptEdit = SourceRange & {
    // The converter uses this range to remove a script statement or macro.
    kind: 'remove' | 'defineProps' | 'defineEmits' | 'defineModel' | 'defineExpose' | 'defineOptions';
    // Keeps the range but replaces its text (see the useTemplateRef rewrite).
    replacement?: string;
};

export type EmitCall = SourceRange & {
    eventName: string; // statically known event name passed to emit(...)
    firstArgumentEnd: number;
    secondArgumentStart?: number;
};

export interface TElement {
    kind: 'element';
    tag: string;
    isNative: boolean; // lowercase HTML element vs component
    attrs: TAttr[];
    children: TNode[];
    key?: ParsedExpression;
    showCond?: string; // v-show -> style display toggle
    scopedSlots?: TScopedSlot[]; // scoped slots passed to this child component
}

export interface TText {
    kind: 'text';
    content: string;
}

export interface TExpr {
    kind: 'expr';
    content: ParsedExpression;
}

export interface TSlot {
    kind: 'slot';
    name: string; // camelCased slot key
    fallback: TNode[];
    bindings: { name: string; value: ParsedExpression }[];
}

export interface TIf {
    kind: 'if';
    branches: { cond: ParsedExpression | null; node: TNode }[];
}

export interface TFor {
    kind: 'for';
    source: ParsedExpression;
    pattern: string; // v-for alias/destructuring pattern
    key?: ParsedExpression;
    isArray: boolean; // true -> .map(), false -> objEntries()
    node: TNode;
}

export interface TFragment {
    kind: 'fragment';
    children: TNode[];
}

export type TAttr =
    | { kind: 'static'; name: string; value: string }
    | { kind: 'bool'; name: string }
    | { kind: 'bind'; name: string; value: ParsedExpression }
    | { kind: 'class'; value: ParsedExpression }
    | { kind: 'style'; value: ParsedExpression }
    | { kind: 'event'; name: string; handlers: EventHandler[] }
    | {
          kind: 'model';
          name: string;
          target: ParsedExpression;
          arg?: string;
          modifiers?: string[];
          isNative: boolean;
          isRadio?: boolean;
          radioValue?: string;
          skipUpdateHandler?: boolean;
      }
    | { kind: 'spread'; value: ParsedExpression }
    | { kind: 'html'; value: ParsedExpression }
    | { kind: 'directive'; name: string; value?: ParsedExpression; modifiers?: string[] }
    | { kind: 'slotAttr'; name: string }
    | { kind: 'ref'; name: string };

// Scoped slot passed to a child component: `<template #name="scope">...</template>`.
export interface TScopedSlot {
    name: string; // camelCased slot key
    scope: string; // raw scope param (e.g. `{ close }`)
    inner: TNode[];
    condition?: ParsedExpression;
}

// ---- Component metadata (raw data only, no output) ----

export interface GenericParam {
    name: string;
    constraint: string | null;
    default: string | null;
}

export interface ModelInfo {
    name: string;
    type: string;
    arg: string;
}

export type Prop = {
    name: string;
    type: string;
    required: boolean;
    defaultValue?: string;
    comment?: string;
};

export type PropsBlock = {
    kind: 'object';
    props: Prop[];
    rawType: string;
};
export type PropsReference = {
    kind: 'reference';
    name: string;
    rawType: string;
};
export type PropsBlocks = {
    blocks: (PropsBlock | PropsReference)[]; // declarations gathered from defineProps calls
    combineWith: 'intersection' | 'union'; // how multiple declarations are combined in the generated type
};

export type EmitArg = {
    name?: string; // tuple or function parameter name, when one was declared
    type: string; // source-written TypeScript type
    optional: boolean; // whether the argument may be omitted
};

export type Emit = {
    name: string; // Vue event name
    args: EmitArg[]; // arguments accepted by the event
    usedInScript: boolean; // whether a static emit call was found in script setup
};

export type SlotArg = {
    name: string; // slot-prop name
    type: string; // slot-prop type
    optional: boolean; // whether the slot prop is optional
};

export type Slot = {
    name: string; // normalized slot name; default is represented as 'default'
    args: SlotArg[]; // props supplied to the slot function
    used: boolean; // whether the slot is rendered by the component template
};

export type Expose = {
    name: string; // public instance member name
    type: string; // source or inferred type of the exposed member
    expression?: string; // source expression used to produce the member
};

// e.g. const modelValue = defineModel<string>('value', { required: true, default: 'foo' })
// -> { propName: 'value', varName: 'modelValue', type: 'string', required: true, defaultValue: 'foo' }
// e.g. const modelValue = defineModel<boolean>();
// -> { propName: 'modelValue', varName: 'modelValue', type: 'boolean', required: false }
// e.g. const modelValue = defineModel<boolean>({ default: true });
// -> { propName: 'modelValue', varName: 'modelValue', type: 'boolean', required: false, defaultValue: 'true' }
// e.g. const modelValue = defineModel<boolean>({ required: true });
// -> { propName: 'modelValue', varName: 'modelValue', type: 'boolean', required: true }
export type Model = {
    propName: string; // this will be the name we use in the Props type
    varName: string; // this info is needed so that we create a proxy prop
    type: string;
    required: boolean;
    defaultValue?: string; // we use this in the 'withDefaults' call to generate the default value for the prop
};

export type ImportedPart = {
    imported: string; // exported name; '*' for namespace imports
    local: string; // local binding name used by the script
    isType: boolean; // type-only import or type-only named specifier
    isWrapped: boolean; // named import enclosed in braces
    isNamespace: boolean; // namespace import, for example '* as utils'
};
// e.g. `import C, { type A, B } from '@/pages/x.vue'`
// ->
// parts = [
//   { text: 'C', isType: false, isWrapped: false },
//   { text: 'A', isType: true, isWrapped: true },
//   { text: 'B', isType: false, isWrapped: true }
// ]
// source = '@/pages/x.vue'
export type Import = {
    parts: ImportedPart[];
    source: string;
};
export type ParsedComponent = {
    name: string; // component name (from filename)
    genericParams: GenericParam[]; // generic type params (from <script setup lang="ts" generic="[HERE]">)
    imports: Import[];
    typesInScriptTag: string[]; // all custom types defined in the script tag
    declaredTypeNames: string[]; // names of custom types defined in the script tag
    propsVarName: string; // variable name assigned to defineProps (e.g. `props` / `_props`)
    attrs: string[]; // named $attrs members used by the template
    propsBlocks: PropsBlocks; // defineProps info (excludes defineModel)
    emits: Emit[]; // defineEmits info
    slots: Slot[]; // all slots used (this will normally be a simple 'default' slot, but can include named slots)
    exposes: Expose[]; // defineExpose info
    exposedTypes: Record<string, string>;
    models: Model[]; // defineModel info (there can be multiple models, but usually only one or none)
    scriptLang: 'js' | 'ts';
    scriptBody: string; // RAW script body (without imports and custom types, macros NOT removed)
    withDefaults: string | null; // raw defaults object passed to withDefaults, if present
    scriptEdits: ScriptEdit[]; // AST ranges for script statements the converter must remove
    emitCalls: EmitCall[]; // statically identifiable emit calls available for range rewriting
    tree: TNode[]; // template tree
    styleTag: string; // <style> tag content including the tag, or empty string if no <style> tag was present
    expressionContext: ExpressionContext; // identifiers needed to rewrite template expressions
    layoutName: string | null; // local binding used as the value of defineOptions({ layout })
    inheritAttrs: boolean; // defineOptions({ inheritAttrs }) — false means the component places attrs itself
};

// export interface ParsedComponentOld {
//     name: string; // component name (from filename)
//     tree: TNode[]; // template tree
//     imports: string[]; // raw import lines from <script setup>
//     scriptBody: string; // RAW script body (macros NOT removed)
//     typeText: string; // raw defineProps type text (may be empty)
//     propNames: string[]; // resolved prop names
//     propTypes: Record<string, string>; // prop name -> exact written type (from declaration range)
//     propsVarName: string; // variable name assigned to defineProps (e.g. `props` / `_props`)
//     model: ModelInfo | null; // defineModel info
//     genericParams: GenericParam[];
//     meta: null | {
//         type: TypeMeta;
//         props: PropertyMeta[];
//         events: EventMeta[];
//         slots: SlotMeta[];
//         exposed: ExposeMeta[];
//     };
//     exportNames: string[]; // names exported from <script setup>
//     manualEmits: any;
//     manualProps: any;
//     manualRefs: any;
//     emitNames: string[];
//     emitsTypeMap: string; // raw type map for Emits
//     slotNames: string[]; // slots rendered by this component's own template
//     styleComment: string; // commented-out <style> block (may be empty)
// }
