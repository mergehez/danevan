// Convert a ParsedComponent (produced by v2t_parser) into the final TSX.
//
// This file does ALL output generation: script transformation (macro removal),
// type building (Props/Emits/generics), JSX generation from the template tree,
// and final assembly. It touches NO Vue APIs and NO source file — it only
// consumes the plain-data ParsedComponent.
import { BindingTypes, createRoot, createSimpleExpression, createTransformContext, processExpression, stringifyExpression } from '@vue/compiler-core';
import { tsxHelpersImportSource } from './v2t_const.ts';
import type { EventHandler, ParsedComponent, ParsedExpression, TAttr, TNode, TScopedSlot } from './v2t_types.ts';

const expressionRoot = createRoot([]);

// `v-model.trim` / `v-model.number` on a plain element are coercion on the way in. Emitting `value` +
// `onInput` keeps that explicit and lets TS check the target, unlike the untyped `v-model` JSX form.
function nativeModelValue(valueExpression: string, modifiers: string[]): string {
    const trimmed = modifiers.includes('trim') ? `${valueExpression}.trim()` : valueExpression;

    return modifiers.includes('number') ? `looseToNumber(${trimmed})` : trimmed;
}

function expr(p: ParsedComponent, value: ParsedExpression, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    const context = p.expressionContext;
    const bindingMetadata: Record<string, BindingTypes> = {};
    for (const name of context.props) bindingMetadata[name] = BindingTypes.PROPS;
    for (const name of context.refs) bindingMetadata[name] = BindingTypes.SETUP_REF;
    const propNames = new Set(context.props);
    const refNames = new Set(context.refs);
    const locals: Record<string, number> = Object.fromEntries(
        [...context.bindings, ...context.locals, 'props', 'attrs', 'emit', 'slots', 'e'].filter((name) => !propNames.has(name) && !refNames.has(name)).map((name) => [name, 1])
    );
    const source = value.source
        .replace(/(?:\$emit|\bemit)\(\s*(['"])([^'"]+)\1\s*(?:,\s*)?/g, (_match, _quote: string, event: string) => `props.${eventPropName(event)}?.(`)
        .replace(/\$attrs/g, 'props')
        .replace(/\$props/g, 'props')
        .replace(/\$slots\./g, 'props.slots?.')
        .replace(/\$slots\b/g, 'props.slots')
        .replace(/\$event/g, 'e');
    try {
        const transformContext = createTransformContext(expressionRoot, { prefixIdentifiers: true, inline: true, expressionPlugins: ['typescript'], bindingMetadata });
        // A statement list (`@click="a(); b();"`) is not a single expression, so
        // processExpression rejects it — and then the `catch` below returned the raw
        // source with nothing prefixed, leaving prop names undefined. Wrap it in an
        // arrow body so it parses, then strip that wrapper again; renderEvent
        // re-wraps the statements itself.
        const isStatementList = source.includes(';');
        const parseable = isStatementList ? `(() => { ${source} })` : source;
        let output = stringifyExpression(processExpression(createSimpleExpression(parseable, false), transformContext, false, false, locals))
            .replace(/__props\./g, 'props.')
            .replace(/\be\.target\.value\b/g, '(e.target as HTMLInputElement).value');
        if (isStatementList) output = output.replace(/^\(\(\)\s*=>\s*\{\s*/, '').replace(/\s*\}\)\s*$/, '');
        // Narrowed expressions can overlap (for example `question` and
        // `question.value`). Apply the most specific path first; otherwise
        // the shorter identifier is matched at the beginning of the longer
        // member expression and the assertion is emitted as `question!.value`.
        if (!applyNarrowing) return output;
        for (const name of [...narrowed].sort((a, b) => b.length - a.length)) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const refValue = new RegExp(`(?<![\\w$])(${escaped}\\.value)(?![!?\\w$])`, 'g');
            output = output.replace(refValue, '$1!');
            output = output.replace(new RegExp(`(?<![\\w$])(${escaped})(?![.!?\\w$])`, 'g'), '$1!');
        }
        return output;
    } catch {
        return source;
    }
}

function exprFor(p: ParsedComponent, value: ParsedExpression | null, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    return value ? expr(p, value, narrowed, applyNarrowing) : '';
}

// ---- script transformation (macro removal) ----

function applyScriptEdits(body: string, p: ParsedComponent): string {
    const edits = [
        ...p.scriptEdits.map((edit) => ({ ...edit, replacement: edit.replacement ?? '' })),
        ...p.emitCalls.map((call) => ({
            start: call.start,
            end: call.secondArgumentStart ?? call.firstArgumentEnd,
            replacement: `props.${eventPropName(call.eventName)}?.(`,
        })),
    ].sort((a, b) => b.start - a.start);
    let output = body;
    for (const edit of edits) {
        output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    }
    for (const model of p.models) {
        const propName = model.propName || 'modelValue';
        output = `const ${model.varName} = computed({\n    get: () => props.${propName},\n    set: (value) => props.${modelChangePropName(propName)}?.(value),\n});\n${output}`;
    }
    if (p.exposes.length) {
        const exposed = p.exposes.map((expose) => `${expose.name}: ${expose.expression ?? expose.name}`).join(', ');
        output = `expose({ ${exposed} });\n${output}`;
    }
    return output;
}

function usesIdentifier(source: string, name: string): boolean {
    return new RegExp(`\\b${name}\\b`).test(source);
}

function modelChangePropName(arg: string): string {
    return arg && arg !== 'modelValue' ? `on${arg.charAt(0).toUpperCase()}${arg.slice(1)}Change` : 'onChange';
}

function eventPropName(event: string): string {
    if (event === 'update:modelValue') return 'onChange';
    if (event.startsWith('update:')) return modelChangePropName(event.slice('update:'.length));
    if (event.includes(':'))
        return `on${event
            .split(':')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('')}`;
    return `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
}

function stripTypeAssertion(source: string): string {
    return source.replace(/\s+as\s+(?:const|[A-Za-z_$][\w$]*(?:\s*[[\]<>|&,.][\w$ .<>|&,[\]]*)*)\s*$/, '').trim();
}

function generatedPropsTypeName(p: ParsedComponent): string {
    const declaredTypeNames = new Set(p.declaredTypeNames);
    if (!declaredTypeNames.has('Props')) return 'Props';

    const baseName = `${p.name}Props`;
    if (!declaredTypeNames.has(baseName)) return baseName;
    let index = 2;
    while (declaredTypeNames.has(`${baseName}${index}`)) index++;
    return `${baseName}${index}`;
}

function genScopedSlots(slots: TScopedSlot[], comp: ParsedComponent): string {
    return `{{ ${slots
        .map((slot) => {
            const scope = slot.scope ? (slot.scope.startsWith('{') ? slot.scope : `{ ${slot.scope} }`) : '';
            const callback = `${scope ? `(${scope})` : '()'} => (${wrapChildren(slot.inner, comp, new Set(), true)})`;
            return `${slot.name}: ${slot.condition ? `${expr(comp, slot.condition)} ? ${callback} : undefined` : callback}`;
        })
        .join(', ')} }}`;
}

const nativeVueTags: Record<string, string> = {
    transition: 'Transition',
    'transition-group': 'TransitionGroup',
    teleport: 'Teleport',
    keepalive: 'KeepAlive',
    suspense: 'Suspense',
};

function toCamel(value: string): string {
    return value.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

function wrapChildren(nodes: TNode[], comp: ParsedComponent, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    const children = genChildren(nodes, comp, narrowed, applyNarrowing);
    return nodes.length > 1 || !children.trimStart().startsWith('<') ? `<>${children}</>` : children;
}

function importText(imp: ParsedComponent['imports'][number]): string {
    const defaults = imp.parts.filter((part) => !part.isWrapped && !part.isNamespace);
    const namespaces = imp.parts.filter((part) => part.isNamespace);
    const named = imp.parts.filter((part) => part.isWrapped && !part.isNamespace);
    const defaultPart = defaults[0];
    const namespacePart = namespaces[0];
    const allTypeOnly = imp.parts.length > 0 && imp.parts.every((part) => part.isType);
    const namedPart = named.length
        ? `{ ${named.map((part) => `${!allTypeOnly && part.isType ? 'type ' : ''}${part.imported === part.local ? part.imported : `${part.imported} as ${part.local}`}`).join(', ')} }`
        : '';
    const specifiers = [defaultPart?.local, namespacePart && `* as ${namespacePart.local}`, namedPart].filter(Boolean).join(', ');
    if (!specifiers) return `import '${imp.source}';`;
    return `import ${allTypeOnly ? 'type ' : ''}${specifiers} from '${imp.source}';`;
}

// ---- JSX generation from the template tree ----

let currentComponent: ParsedComponent;

// Split a v-model target into the object to bind and its key. Only member
// accesses at the outermost level count, so `a.value[col.name]` yields
// (`a.value`, `col.name`) instead of splitting on the dot inside the brackets.
function splitModelTarget(target: string): { targetExpr: string; keyExpr: string } | null {
    let depth = 0;
    for (let i = target.length - 1; i >= 0; i--) {
        const ch = target[i];
        if (ch === ']' || ch === ')' || ch === '}') depth++;
        else if (ch === '[' || ch === '(' || ch === '{') {
            depth--;
            if (depth === 0 && ch === '[') return { targetExpr: target.slice(0, i), keyExpr: target.slice(i + 1, -1) };
        } else if (ch === '.' && depth === 0) {
            return { targetExpr: target.slice(0, i), keyExpr: `'${target.slice(i + 1)}'` };
        }
    }
    return null;
}

function renderEvent(event: string, handlers: EventHandler[], comp: ParsedComponent, narrowed: Set<string>): string {
    // Vue's key aliases (see `keyNames` in @vue/runtime-dom). `left`/`right` were
    // missing, so `@keydown.left.stop` dropped the key filter entirely.
    const keyModifiers = new Set(['enter', 'esc', 'tab', 'delete', 'space', 'up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end']);
    const expressions = handlers.map(({ body, modifiers, isReference }) => {
        const usesEvent = /\$event\b/.test(body);
        const expression = expr(comp, { source: body }, narrowed, true);
        const eventType = event.startsWith('key') ? 'KeyboardEvent' : 'Event';
        let result = isReference && !body.includes(';') ? expression : `${usesEvent ? `(e: ${eventType}) => ` : '() => '}${body.includes(';') ? `{ ${expression} }` : expression}`;
        // Modifier-only handlers (`@keydown.left.stop`, `@click.stop`, `@mousedown.stop`)
        // carry no expression at all — the template above then emitted a dangling
        // `() => `, which is a syntax error and made the whole file unconvertible.
        if (!body.trim()) result = '() => {}';
        const typedParameters = [...body.matchAll(/\(\s*([\w$]+)\s*:\s*([^,)]+)(?:\s*,[^)]*)?\)\s*=>/g)];
        for (const parameter of typedParameters) {
            const parameterName = parameter[1];
            const parameterType = parameter[2].trim();
            result = result.replace(new RegExp(`\\b${parameterName}\\b`), `${parameterName}: ${parameterType}`);
        }
        const keys = modifiers.filter((modifier) => keyModifiers.has(modifier));
        const hasSelf = modifiers.includes('self');
        const others = modifiers.filter((modifier) => !keyModifiers.has(modifier) && modifier !== 'self');
        if (keys.length) result = `withKeys(${result}, [${keys.map((key) => `'${key}'`).join(', ')}])`;
        if (others.length) result = `prevented(${result})`;
        // `.self` gates the whole handler, so it wraps last (Vue's `@click.self`).
        if (hasSelf) result = `selfOnly(${result})`;
        return result;
    });
    const prop = eventPropName(event);
    return `${prop}={${expressions[0] ?? 'undefined'}}`;
}

function genAttrs(attrs: TAttr[], comp: ParsedComponent, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    const parts: string[] = [];
    for (const a of attrs) {
        switch (a.kind) {
            case 'static':
                parts.push(`${a.name}="${a.value}"`);
                break;
            case 'bool':
                parts.push(`${a.name}={true}`);
                break;
            case 'bind':
                parts.push(`${a.name}={${expr(comp, a.value, narrowed, applyNarrowing)}}`);
                break;
            case 'class':
                parts.push(`class={${expr(comp, a.value, narrowed, applyNarrowing)}}`);
                break;
            case 'style':
                parts.push(`style={${expr(comp, a.value, narrowed, applyNarrowing)}}`);
                break;
            case 'event':
                parts.push(renderEvent(a.name, a.handlers, comp, narrowed));
                break;
            case 'model': {
                if (a.isRadio) {
                    // Radio: bind `checked` and keep the static `value` (the
                    // radio's value). Emit onChange to update the target.
                    const target = expr(comp, a.target);
                    parts.push(`checked={${target} === '${(a.radioValue ?? '').replace(/'/g, "\\'")}'}`);
                    if (!a.skipUpdateHandler) parts.push(`onChange={(e: any) => (${target} = (e.target as HTMLInputElement).value)}`);
                } else if (a.isNative) {
                    const target = expr(comp, a.target);
                    const modifiers = a.modifiers ?? [];

                    parts.push(`value={${target}}`);

                    if (!a.skipUpdateHandler) {
                        parts.push(`onInput={(e: any) => (${target} = ${nativeModelValue('e.target.value', modifiers)})}`);
                    }
                } else {
                    const target = expr(comp, { source: stripTypeAssertion(a.target.source) });
                    const split = splitModelTarget(target);
                    const targetExpr = split?.targetExpr ?? target;
                    const keyExpr = split?.keyExpr ?? `'${a.name}'`;
                    const argSuffix = a.arg ? `, '${a.arg}'` : '';
                    parts.push(`{...vModel(${targetExpr}, ${keyExpr}${argSuffix})}`);
                }
                break;
            }
            case 'spread':
                // `v-bind="$attrs"` forwards fallthrough attrs only. Spreading
                // `props` would also push declared props — and their handlers —
                // onto the element, where mergeProps turns them into DOM listeners.
                parts.push(a.value.source === '$attrs' ? '{...attrs}' : `{...${expr(comp, a.value, narrowed, applyNarrowing)}}`);
                break;
            case 'html':
                parts.push(`innerHTML={${expr(comp, a.value, narrowed, applyNarrowing)}}`);
                break;
            case 'directive':
                // Modifiers have no dotted form in JSX, so they ride along in the value object
                // (`v-tooltip.xs.nowrap="'Open'"` -> `v-tooltip={{value: 'Open', xs: true, nowrap: true}}`).
                if (a.modifiers?.length) {
                    const entries = a.value ? [`value: ${expr(comp, a.value)}`, ...a.modifiers.map((name) => `${name}: true`)] : a.modifiers.map((name) => `${name}: true`);
                    parts.push(`v-${a.name}={{ ${entries.join(', ')} }}`);
                    break;
                }

                parts.push(a.value ? `v-${a.name}={${expr(comp, a.value)}}` : `v-${a.name}`);
                break;
            case 'slotAttr':
                parts.push(`slot="${a.name}"`);
                break;
            case 'ref':
                parts.push(`ref={${a.name}}`);
                break;
        }
    }
    return parts.length ? ' ' + parts.join(' ') : '';
}

function normalizeBuiltinAttrs(attrs: TAttr[], tag: string): TAttr[] {
    if (!nativeVueTags[tag.toLowerCase()]) return attrs;
    return attrs.map((attr) => {
        if (attr.kind === 'static' || attr.kind === 'bool' || attr.kind === 'bind' || attr.kind === 'event' || attr.kind === 'model') {
            return { ...attr, name: toCamel(attr.name) };
        }
        return attr;
    });
}

function genNode(n: TNode, comp: ParsedComponent = currentComponent, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    switch (n.kind) {
        case 'text': {
            // TSX rejects raw `<` / `>` / `{` / `}` inside text, so any such
            // text must become a string expression (e.g. `' -> '`).
            if (/[<>{}]/.test(n.content)) return `{${JSON.stringify(n.content)}}`;
            return n.content === ' ' ? "{' '}" : n.content;
        }
        case 'comment':
            return `{/*${n.content}*/}`;
        case 'expr':
            return `{${expr(comp, n.content, narrowed, applyNarrowing)}}`;
        case 'element': {
            const attrs = genAttrs(normalizeBuiltinAttrs(n.attrs, n.tag), comp, narrowed, applyNarrowing);
            const inner = genChildren(n.children, comp, narrowed, applyNarrowing);
            const key = n.key && !n.attrs.some((attr) => attr.kind === 'bind' && attr.name === 'key') ? ` key={${expr(comp, n.key, narrowed, applyNarrowing)}}` : '';
            const isDynamicComp = n.tag === 'component';
            const tag = isDynamicComp ? 'Component' : (nativeVueTags[n.tag.toLowerCase()] ?? n.tag);
            const acceptsSlots = isDynamicComp || (!n.isNative && !['Transition', 'TransitionGroup', 'Teleport', 'KeepAlive', 'Suspense'].includes(n.tag));
            const slots: string[] = [];
            if (inner.trim() && acceptsSlots && !hasSingleDefaultSlot(comp)) slots.push(`default: () => (${wrapChildren(n.children, comp)})`);
            if (acceptsSlots && n.scopedSlots?.length) {
                slots.push(genScopedSlots(n.scopedSlots, comp).slice(3, -3).trim());
            }
            const compSlots = slots.length ? ` slots={{ ${slots.join(', ')} }}` : '';
            if (acceptsSlots && n.scopedSlots?.length) return `<${tag}${attrs}${key}${compSlots} />`;
            if (acceptsSlots && hasSingleDefaultSlot(comp) && inner.trim()) return `<${tag}${attrs}${key}>${inner}</${tag}>`;
            if (acceptsSlots && inner.trim() && !n.scopedSlots?.length) return `<${tag}${attrs}${key}>${inner}</${tag}>`;
            if (acceptsSlots && inner.trim()) return `<${tag}${attrs}${key}${compSlots} />`;
            return inner.trim() ? `<${tag}${attrs}${key}${compSlots}>${inner}</${tag}>` : `<${tag}${attrs}${key}${compSlots} />`;
        }
        case 'slot': {
            const fallback = n.fallback.length ? ` ?? (${wrapChildren(n.fallback, comp)})` : '';
            const bindings = n.bindings.map((binding) => `${binding.name}: ${expr(comp, binding.value)}`).join(', ');
            const bindingObject = bindings ? `{ ${bindings} }` : '';
            const slotCall =
                hasSingleDefaultSlot(comp) && n.name === 'default'
                    ? `renderSlot(props.slots${bindingObject ? `, ${bindingObject}` : ''})`
                    : `props.slots?.${n.name}?.(${bindingObject})`;
            return `{${slotCall}${fallback}}`;
        }
        case 'if': {
            let expr = '';
            for (let k = n.branches.length - 1; k >= 0; k--) {
                const b = n.branches[k];
                const branchNarrowed = new Set([...narrowed, ...narrowedFromCondition(b.cond)]);
                const rendered = genNode(b.node, comp, branchNarrowed);
                const el = rendered.startsWith('{') && rendered.endsWith('}') ? rendered.slice(1, -1) : rendered;
                if (b.cond) {
                    const condition = exprFor(comp, b.cond);
                    expr = expr ? `${condition} ? (${el}) : (${expr})` : `${condition} ? (${el}) : null`;
                } else {
                    expr = expr ? `${el}` : `${el}`;
                }
            }
            return `{${expr}}`;
        }
        case 'for': {
            const source = exprFor(comp, n.source, narrowed);
            // Only guard a *bare* prop access (`props.foo`, `props.foo.bar`). An
            // expression that already ends in a fallback (the template's
            // `v-for="x in foo ?? []"` -> `props.foo ?? []`) must not be re-guarded,
            // which produced `props.foo ?? [] ?? []`.
            const isBarePropsAccess = /^props(?:\.[A-Za-z_$][\w$]*)+$/.test(source);
            const iterable = isBarePropsAccess ? `${source} ?? []` : source;
            // `.map`/`objEntries` bind tighter than `??`, `||`, etc., so anything
            // that is not a plain identifier/member chain must be parenthesized or
            // it would attach the call to the right-hand operand only.
            const guarded = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(iterable) ? iterable : `(${iterable})`;
            const keyedNode = n.key ? addKeyToNode(n.node, n.key) : n.node;
            const keyedChild = genNode(keyedNode, comp, narrowed, true);
            const childExpression = keyedChild.startsWith('{') && keyedChild.endsWith('}') ? keyedChild.slice(1, -1) : keyedChild;
            if (n.isArray) {
                return `{${guarded}.map((${n.pattern}) => (${childExpression}))}`;
            }
            return `{objEntries(${guarded}).map((${n.pattern}) => (${childExpression}))}`;
        }
        case 'fragment': {
            const children = genChildren(n.children, comp, narrowed);
            return n.children.length === 1 && children.trimStart().startsWith('<') ? children : `<>${children}</>`;
        }
    }
}

function genChildren(nodes: TNode[], comp: ParsedComponent = currentComponent, narrowed: Set<string> = new Set(), applyNarrowing = false): string {
    return nodes.map((n) => genNode(n, comp, narrowed, applyNarrowing)).join('');
}

function addKeyToNode(node: TNode, key: ParsedExpression): TNode {
    if (node.kind === 'element') return { ...node, key };
    if (node.kind === 'fragment') return { ...node, children: node.children.map((child) => addKeyToNode(child, key)) };
    if (node.kind === 'if') return { ...node, branches: node.branches.map((branch) => ({ ...branch, node: addKeyToNode(branch.node, key) })) };
    return node;
}

function narrowedFromCondition(condition: ParsedExpression | null): Set<string> {
    const narrowed = new Set<string>();
    if (!condition) return narrowed;
    for (const part of condition.source.split('&&').map((value) => value.trim())) {
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(part)) narrowed.add(part);
    }
    return narrowed;
}

function hasSingleDefaultSlot(comp: ParsedComponent): boolean {
    return comp.slots.length === 1 && comp.slots[0].name === 'default' && comp.slots[0].args.length === 0;
}

function buildPropsType(p: ParsedComponent): string {
    const { propsBlocks, models, emits, slots, genericParams } = p;
    const propsName = generatedPropsTypeName(p);
    // The declaration keeps the real constraints and defaults. Reference sites
    // (`Props<TValue, T>`) take the bare names instead.
    const propsTypeParam = genericParams.length
        ? `<${genericParams.map((g) => `${g.name}${g.constraint ? ` extends ${g.constraint}` : ''}${g.default ? ` = ${g.default}` : ''}`).join(', ')}>`
        : '';
    const declared = new Set(propsBlocks.blocks.flatMap((block) => (block.kind === 'object' ? block.props.map((prop) => prop.name) : [])));
    const generatedNames = new Set<string>();
    const members: string[] = [];
    for (const model of models) {
        const propName = model.propName || 'modelValue';
        if (!declared.has(propName)) {
            members.push(`    ${propName}${model.required ? '' : '?'}: ${model.type};`);
            generatedNames.add(propName);
        }
        const callback = modelChangePropName(propName);
        if (!declared.has(callback)) {
            members.push(`    ${callback}?: (val: ${model.type}) => unknown;`);
            generatedNames.add(callback);
        }
    }
    for (const emit of emits) {
        const callback = eventPropName(emit.name);
        if (!declared.has(callback) && !generatedNames.has(callback))
            members.push(`    ${callback}?: (${emit.args.map((arg) => `${arg.name ?? 'value'}${arg.optional ? '?' : ''}: ${arg.type}`).join(', ')}) => void;`);
    }
    if (hasSingleDefaultSlot(p)) members.push('    slots?: SingleChildSlot;');
    else if (slots.length)
        members.push(
            `    slots?: { ${slots
                .map((slot) => `${slot.name}?: (scope: { ${slot.args.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${arg.type}`).join('; ')} }) => unknown`)
                .map((slot) => slot.replace(/\(scope: \{\s*\}\)/, '()'))
                .join('; ')} };`
        );
    for (const attr of p.attrs) {
        if (!declared.has(attr)) members.push(`    ${attr}?: ${attr === 'style' ? 'StyleValue' : 'unknown'};`);
    }
    const blocks = propsBlocks.blocks.map((block) => block.rawType);
    const base = blocks.length ? blocks.join(propsBlocks.combineWith === 'union' ? ' | ' : ' & ') : '{}';
    const generated = members.length ? ` & {\n${members.join('\n')}\n}` : '';
    return `type ${propsName}${propsTypeParam} = ${base}${generated};\n`;
}

function buildPropsLine(p: ParsedComponent): string {
    const { propsBlocks, models, emits, slots, genericParams } = p;
    const propsName = generatedPropsTypeName(p);
    const allProps = propsBlocks.blocks.flatMap((block) => (block.kind === 'object' ? block.props.map((prop) => prop.name) : []));
    allProps.push(...p.expressionContext.props);
    for (const model of models) allProps.push(model.propName || 'modelValue', modelChangePropName(model.propName));
    for (const emit of emits) allProps.push(eventPropName(emit.name));
    if (slots.length) allProps.push('slots');
    allProps.push(...p.attrs);
    const uniqueProps = [...new Set(allProps)];
    const propsArray = uniqueProps.length ? `['${uniqueProps.join("', '")}']` : '[]';
    const propsTypeArg = genericParams.length ? `<${genericParams.map(() => 'any').join(', ')}>` : '';
    return `props: ensureAllTsxProps<${propsName}${propsTypeArg}>()(${propsArray})`;
}

// ---- main entry ----

export function convertToTsx(p: ParsedComponent): string {
    currentComponent = p;
    const { name, tree, imports, scriptBody, genericParams, styleTag } = p;

    // Transform the script body (remove macros).
    const scriptBodySrc = applyScriptEdits(scriptBody, p);
    const modelDefaults = p.models.filter((model) => model.defaultValue !== undefined).map((model) => `${model.propName || 'modelValue'}: ${model.defaultValue}`);
    const explicitDefaults =
        p.withDefaults
            ?.replace(/^\s*\{/, '')
            .replace(/\}\s*$/, '')
            .replace(/,\s*$/, '')
            .trim() ?? '';
    const defaultsEntries = [explicitDefaults, ...modelDefaults].filter(Boolean);
    const withDefaultsObj = defaultsEntries.length ? `{ ${defaultsEntries.join(', ')} }` : null;
    const scriptBodyFinal = scriptBodySrc;
    const hasLayout = p.layoutName !== null;

    // The parser removes imports and custom type/interface declarations from
    // scriptBody, so no line-by-line extraction or brace-depth tracking is
    // needed here.
    const rootTypesBlock = p.typesInScriptTag.length ? '\n' + p.typesInScriptTag.join('\n\n') + '\n' : '';
    const typesBlock = rootTypesBlock;

    // Generate JSX.
    let jsx = genChildren(tree);
    const usesAttrsSpread = jsx.includes('{...attrs}');

    // A setup that never reads props needs no named parameter (and no default
    // proxy); `_` is exempt from `noUnusedParameters`.
    const propsUsed = usesIdentifier(scriptBodyFinal, 'props') || usesIdentifier(jsx, 'props');

    // Imports.
    const vueImport = imports.find((i) => i.source === 'vue');
    const otherImports = imports.filter((i) => i.source !== 'vue').map(importText);
    const generatedVueNames = ['ref', 'computed', 'reactive', 'watch'].filter((name) => usesIdentifier(scriptBodyFinal, name));
    if (usesAttrsSpread) generatedVueNames.push('useAttrs');
    let vueLine = generatedVueNames.length ? `import { ${generatedVueNames.join(', ')} } from 'vue';` : '';
    if (p.attrs.includes('style')) otherImports.push(`import type { StyleValue } from 'vue';`);
    if (vueImport) {
        const extra = vueImport.parts
            // `useTemplateRef` is rewritten to `ref(...)` by the parser; drop the import
            // once no call is left (a string template ref cannot resolve in a render fn).
            .filter((part) => part.isWrapped && !(part.local === 'useTemplateRef' && !usesIdentifier(scriptBodyFinal, 'useTemplateRef')))
            .map((part) => `${part.isType ? 'type ' : ''}${part.imported === part.local ? part.local : `${part.imported} as ${part.local}`}`);
        const all = [...new Set([...generatedVueNames, ...extra.filter((name) => name !== 'defineComponent')])];
        vueLine = all.length ? `import { ${all.join(', ')} } from 'vue';` : '';
    }
    const builtins = Object.values(nativeVueTags);
    const usedBuiltins = builtins.filter((b) => new RegExp(`<${b}[\\s/>]`).test(jsx));
    if (usedBuiltins.length) {
        const names = [...vueLine.matchAll(/\{([^}]*)\}/g)][0]?.[1] ?? '';
        const all = [
            ...new Set([
                ...names
                    .split(',')
                    .map((n) => n.trim())
                    .filter(Boolean),
                ...usedBuiltins,
            ]),
        ];
        vueLine = `import { ${all.join(', ')} } from 'vue';`;
    }

    const helperNames = new Set<string>();
    if (genericParams.length) helperNames.add('componentGeneric');
    else helperNames.add('component');
    if (buildPropsLine(p).startsWith('props: ensureAllTsxProps')) helperNames.add('ensureAllTsxProps');
    if (jsx.includes('vModel(')) helperNames.add('vModel');
    if (propsUsed && withDefaultsObj) helperNames.add('tsxWithDefaults');
    if (hasSingleDefaultSlot(p)) {
        helperNames.add('type SingleChildSlot');
        helperNames.add('renderSlot');
    }
    if (jsx.includes('<Component ')) helperNames.add('Component');
    if (jsx.includes('prevented(')) helperNames.add('prevented');
    if (jsx.includes('selfOnly(')) helperNames.add('selfOnly');
    if (jsx.includes('looseToNumber(')) helperNames.add('looseToNumber');

    if (helperNames.size) otherImports.push(`import { ${Array.from(helperNames).join(', ')} } from '${tsxHelpersImportSource}';`);
    if (jsx.includes('objEntries(')) otherImports.push(`import { objEntries } from '#shared/obj';`);

    // Event modifiers (withModifiers / withKeys) are emitted by the parser when
    // a template uses @click.stop.prevent, @keyup.enter, etc.
    const usesWithModifiers = jsx.includes('withModifiers(');
    const usesWithKeys = jsx.includes('withKeys(');
    if (usesWithModifiers || usesWithKeys) {
        const names = [...vueLine.matchAll(/\{([^}]*)\}/g)][0]?.[1] ?? '';
        const all = [
            ...new Set([
                ...names
                    .split(',')
                    .map((n) => n.trim())
                    .filter(Boolean),
                ...(usesWithModifiers ? ['withModifiers'] : []),
                ...(usesWithKeys ? ['withKeys'] : []),
            ]),
        ];
        vueLine = `import { ${all.join(', ')} } from 'vue';`;
    }
    let importsBlock = `${[vueLine, ...otherImports].filter(Boolean).join('\n')}\n`;

    // Types.
    const propsType = buildPropsType(p);
    const emitsTypeBlock = '';

    // Setup signature.
    const propsTypeParam = genericParams.length ? `<${genericParams.map((g) => g.name).join(', ')}>` : '';
    // The real constraints go inline: a later parameter may reference an earlier
    // one (`T extends SelectOption<TValue>`), which an alias would not preserve.
    const genericSig = genericParams.length
        ? `<${genericParams.map((g) => `${g.name}${g.constraint ? ` extends ${g.constraint}` : ''}${g.default ? ` = ${g.default}` : ''}`).join(', ')}>`
        : '';
    const setupParam = !propsUsed ? '_' : withDefaultsObj ? '_props' : p.propsVarName;
    const propsName = generatedPropsTypeName(p);
    const exposeMembers = p.exposes.map((expose) => `${expose.name}: ${(p.exposedTypes[expose.name] ?? 'unknown').replace(/void \| undefined/g, 'void')}`).join('; ');
    const exposeType = `{ ${exposeMembers} }`;
    const exposeTypeName = exposeType.length < 50 ? exposeType : 'Exposes';
    const setupContext = p.exposes.length ? `, { expose }: { expose: (exposed: ${exposeTypeName}) => void }` : '';
    const emitSig = `${genericSig}(${setupParam}: ${propsName}${propsTypeParam}${setupContext})`;

    // Options.
    const propsLine = buildPropsLine(p);
    // Setup prelude.
    let setupPrelude = '';
    if (propsUsed && withDefaultsObj) setupPrelude += `    const props = tsxWithDefaults(_props, ${withDefaultsObj});\n`;
    else if (propsUsed && setupParam !== 'props') setupPrelude += `    const props = ${setupParam};\n`;
    if (usesAttrsSpread) setupPrelude += '    const attrs = useAttrs();\n';

    const helper = genericParams.length ? 'componentGeneric' : 'component';
    const exposeTypeDeclaration = p.exposes.length && exposeTypeName === 'Exposes' ? `type Exposes = ${exposeType};\n` : '';
    const options = `{ name: '${name}', ${hasLayout ? `layout: ${p.layoutName}, ` : ''}${p.inheritAttrs ? '' : 'inheritAttrs: false, '}${propsLine} }`;
    const finalOutput = `
${importsBlock.trim()}

${typesBlock.trim()}

${propsType.trim()}

${emitsTypeBlock.trim()}

${exposeTypeDeclaration.trim()}

export const ${name} = ${helper}(${emitSig} => {
${setupPrelude}${scriptBodyFinal}
    return () => (
${wrapChildren(tree, p)}
    );
    }, ${options});`.trim();

    const root = wrapChildren(tree, p);
    const styleOutput = styleTag ? styleTag.replace(/^<style[^>]*>|<\/style>$/g, '') : '';
    return `${finalOutput.replace(`\n${wrapChildren(tree, p)}\n`, `\n${root}\n`)}\n\nexport default ${name};${styleOutput ? `\n\n/*\n${styleOutput}\n*/` : ''}`;
}
