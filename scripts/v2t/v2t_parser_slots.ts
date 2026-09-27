// Slot outlets (`<slot :prop="expr">`) and the prop types they expose.
//
// The template carries no types, so each binding expression is resolved to a type
// expression that is valid where the component's props type is declared: the root
// becomes a prop's declared text, a `ref<T>()` / `computed<T>()` type argument, or a
// v-for alias's iterated collection; properties become indexed accesses and calls
// become `ReturnType<...>`. Anything else falls back to
// `fallbackTypeForComplexSlotPropTypes`.
import { resolve } from 'node:path';
import ts from 'typescript';
import { fallbackTypeForComplexSlotPropTypes } from './v2t_const.ts';
import type { PropsBlock, PropsReference, Slot, SlotArg } from './v2t_types.ts';

export interface SlotTypeScriptContext {
    checker: ts.TypeChecker;
    sources: Map<string, ts.SourceFile>;
}

interface SlotScopeContext {
    props: Map<string, string>;
    propsVars: Set<string>;
    bindings: Map<string, string>;
    aliasSources: Map<string, string>;
    indexAliases: Set<string>;
}

const emptySlotScope = (): SlotScopeContext => ({
    props: new Map(),
    propsVars: new Set(),
    bindings: new Map(),
    aliasSources: new Map(),
    indexAliases: new Set(),
});

let slotScope = emptySlotScope();
let slotNames = new Set<string>();
let slotArgs = new Map<string, SlotArg[]>();
let typedBindingTypes = new Map<string, string>();

// Start a file: outlets, aliases and binding types are collected afterwards.
export function resetSlotState(): void {
    slotScope = emptySlotScope();
    slotNames = new Set();
    slotArgs = new Map();
    typedBindingTypes = new Map();
}

// `v-for="alias in iteratedSource"`: the alias resolves to the iterated collection
// (element-wise) and key/index aliases resolve to `number`.
export function recordSlotAlias(valueNames: string[], indexNames: string[], iteratedSource: string): void {
    for (const name of valueNames) slotScope.aliasSources.set(name, iteratedSource);
    for (const name of indexNames) slotScope.indexAliases.add(name);
}

// The same outlet name can be declared more than once (e.g. in both branches of a
// `v-if`); merge the args by name so every branch sees all of them.
export function recordSlotOutlet(name: string, args: SlotArg[]): void {
    slotNames.add(name);
    const existing = slotArgs.get(name) ?? [];
    slotArgs.set(name, [...existing, ...args.filter((arg) => !existing.some((existingArg) => existingArg.name === arg.name))]);
}

export function collectSlots(): Slot[] {
    return [...slotNames].map((name): Slot => ({ name, args: slotArgs.get(name) ?? [], used: true }));
}

// ---- binding types ----

const SLOT_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

// Babel 7 stores call type arguments on `typeParameters`, Babel 8 on `typeArguments`.
const callTypeArguments = (call: any): any[] => call?.typeArguments?.params ?? call?.typeParameters?.params ?? [];
const sourceText = (src: string, node: any): string => (typeof node?.start === 'number' && typeof node?.end === 'number' ? src.slice(node.start, node.end).trim() : '');

// A template name is either a setup binding (declaration) or a `defineProps` key (used
// as `props.<name>`). Usages are skipped: inside `if (!props.children)` the prop is
// narrowed to `() => TChild[]` and would overwrite the local `children`.
function bindingTypeKind(node: ts.Identifier): 'declaration' | 'prop' | null {
    const parent = node.parent;
    if (
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node)
    )
        return 'declaration';
    if (ts.isPropertyAccessExpression(parent) && parent.name === node && ts.isIdentifier(parent.expression) && parent.expression.text === 'props') return 'prop';
    return null;
}

// Types of the script's own bindings, so `:item="row"` can be typed from `row`.
function collectBindingTypes(script: SlotTypeScriptContext, file: string): Map<string, string> {
    const declarations = new Map<string, string>();
    const propAccesses = new Map<string, string>();
    const sourceFile = script.sources.get(`${resolve(file)}.ts`);
    const checker = script.checker;
    if (!sourceFile || !checker) return declarations;
    const refTypeNames = new Set(['Ref', 'ComputedRef', 'WritableComputedRef', 'ShallowRef']);
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            const kind = bindingTypeKind(node);
            const target = kind === 'declaration' ? declarations : kind === 'prop' ? propAccesses : null;
            if (target) {
                const type = checker.getTypeAtLocation(node);
                const symbolName = type.aliasSymbol?.getName() ?? type.symbol?.getName();
                const typeArguments = 'typeArguments' in type && Array.isArray(type.typeArguments) ? type.typeArguments : [];
                const valueType = symbolName && refTypeNames.has(symbolName) && typeArguments[0] ? typeArguments[0] : type;
                if (type.flags !== ts.TypeFlags.Any && !target.has(node.text)) {
                    const typeText = checker.typeToString(valueType, undefined, ts.TypeFormatFlags.NoTruncation);
                    target.set(node.text, typeText.length <= 50 ? typeText : fallbackTypeForComplexSlotPropTypes);
                }
            }
        }
        node.forEachChild(visit);
    };
    visit(sourceFile);
    // A real setup binding shadows a prop of the same name.
    return new Map([...propAccesses, ...declarations]);
}

// Declared type texts a chain root can resolve to: `ref<T>()` / `computed<T>()` type
// arguments, and `const s = computed(() => p.state)` typed as the prop it reads (so a
// chain stays short instead of expanding the whole state type).
function collectDeclaredBindingTypes(ast: any, scriptSrc: string, props: Map<string, string>, propsVars: Set<string>): Map<string, string> {
    const bindings = new Map<string, string>();
    for (const statement of ast.program.body) {
        if (statement.type !== 'VariableDeclaration') continue;
        for (const declaration of statement.declarations) {
            const name = declaration?.id?.type === 'Identifier' ? declaration.id.name : null;
            const call = declaration?.init;
            if (!name || call?.type !== 'CallExpression' || call.callee?.type !== 'Identifier') continue;
            if (!['ref', 'computed', 'shallowRef', 'reactive'].includes(call.callee.name)) continue;
            const declared = sourceText(scriptSrc, callTypeArguments(call)[0]);
            const body = call.arguments?.[0]?.type === 'ArrowFunctionExpression' ? sourceText(scriptSrc, call.arguments[0].body) : '';
            const parts = SLOT_CHAIN.test(body) ? body.split('.') : [];
            if (declared) bindings.set(name, declared);
            else if (parts.length === 2 && propsVars.has(parts[0]) && props.has(parts[1])) bindings.set(name, props.get(parts[1])!);
        }
    }
    return bindings;
}

export function buildSlotScope(input: {
    file: string;
    ast: any;
    scriptSrc: string;
    propsBlocks: { blocks: (PropsBlock | PropsReference)[] };
    propsVarName: string;
    typeScript: SlotTypeScriptContext | null;
}): void {
    const props = new Map<string, string>();
    for (const block of input.propsBlocks.blocks) {
        if (block.kind === 'object') for (const prop of block.props) if (prop.type) props.set(prop.name, prop.type);
    }
    const propsVars = new Set([input.propsVarName, 'props']);
    const bindings = collectDeclaredBindingTypes(input.ast, input.scriptSrc, props, propsVars);
    if (input.typeScript) typedBindingTypes = collectBindingTypes(input.typeScript, input.file);
    // The v-for aliases were recorded before this point; keep their maps.
    slotScope = { props, propsVars, bindings, aliasSources: slotScope.aliasSources, indexAliases: slotScope.indexAliases };
}

// ---- resolving a binding expression to a type expression ----

// Append an index, parenthesising anything that does not already read as one unit.
function indexSlotType(text: string, index: string): string {
    return /^(?:[A-Za-z_$][\w$]*|\(.+\))(?:\[\])*(?:\[[^\]]+\])*$/.test(text) ? `${text}${index}` : `(${text})${index}`;
}

// `e.data` -> `Item[][number]['data']`, `s.item` -> `Type['item']`. Null when a root is
// not resolvable, so the arg falls back to the configured placeholder.
function slotChainType(chain: string): string | null {
    const [root, ...props] = chain.split('.');
    if (slotScope.indexAliases.has(root)) return props.length ? null : 'number';
    let base: string | null | undefined;
    const iterated = slotScope.aliasSources.get(root);
    if (iterated && props.length) {
        const source = slotChainType(iterated);
        base = source && indexSlotType(source, '[number]');
    } else if (slotScope.propsVars.has(root) && props.length) {
        base = slotScope.props.get(props.shift()!);
    } else {
        base = slotScope.bindings.get(root);
    }
    return base ? props.reduce((text, prop) => indexSlotType(text, `['${prop}']`), base) : null;
}

// `s.isSelected(entryState.item)` -> `ReturnType<...['isSelected']>`: the outlet exposes
// what the call returns, not the function.
function slotCallType(expression: string): string | null {
    const call = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(\?\.)?\s*\([\s\S]*\)$/.exec(expression);
    if (!call) return null;
    const callee = slotChainType(call[1]);
    if (!callee) return null;
    return `ReturnType<${call[2] ? `NonNullable<${callee}>` : callee}>`;
}

export function slotArgTypeFor(source: string): string {
    const known = typedBindingTypes.get(source);
    if (known && known !== fallbackTypeForComplexSlotPropTypes) return known;
    const expression = source.trim();
    return (SLOT_CHAIN.test(expression) ? slotChainType(expression) : slotCallType(expression)) ?? fallbackTypeForComplexSlotPropTypes;
}
