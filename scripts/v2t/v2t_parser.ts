import _generate from '@babel/generator';
import { parse as babelParse, parseExpression } from '@babel/parser';
import type { CallExpression } from '@babel/types';
import { compileScript, parse } from '@vue/compiler-sfc';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';
import { tsconfigFile } from './v2t_const.ts';
import { buildSlotScope, collectSlots, recordSlotAlias, recordSlotOutlet, resetSlotState, slotArgTypeFor, type SlotTypeScriptContext } from './v2t_parser_slots.ts';
import type {
    Emit,
    EmitCall,
    EventHandler,
    Expose,
    ExpressionContext,
    GenericParam,
    Import,
    ImportedPart,
    Model,
    ParsedComponent,
    ParsedExpression,
    Prop,
    PropsBlock,
    PropsReference,
    ScriptEdit,
    SlotArg,
    TAttr,
    TNode,
    TScopedSlot,
} from './v2t_types.ts';

function expression(expr: string): ParsedExpression {
    return { source: expr };
}

function extractAttrs(ast: any): Set<string> {
    const attrs = new Set<string>();
    const seen = new Set<object>();
    const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const expressionSource = node.type === 5 ? node.content?.content : node.type === 7 ? node.exp?.content : undefined;
        if (expressionSource) {
            const source = expressionSource as string;
            for (const member of source.matchAll(/\$attrs\.([A-Za-z_$][\w$]*)/g)) attrs.add(member[1]);
            for (const member of source.matchAll(/\$attrs\[['"]([^'"]+)['"]\]/g)) attrs.add(member[1]);
        }
        for (const key in node) walk(node[key]);
    };
    walk(ast);
    return attrs;
}

function extractDefineOptions(ast: any): { layoutName: string | null; inheritAttrs: boolean } {
    let layoutName: string | null = null;
    let inheritAttrs = true;
    const seen = new Set<object>();
    const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'defineOptions') {
            const options = node.arguments?.[0];
            if (options?.type === 'ObjectExpression') {
                for (const property of options.properties ?? []) {
                    if (property?.type !== 'ObjectProperty') continue;
                    if (property.key?.name === 'layout' && property.value?.type === 'Identifier') layoutName = property.value.name;
                    if (property.key?.name === 'inheritAttrs' && property.value?.type === 'BooleanLiteral') inheritAttrs = property.value.value !== false;
                }
            }
            return;
        }
        for (const key in node) walk(node[key]);
    };
    walk(ast.program);
    return { layoutName, inheritAttrs };
}

const allBindings = new Set<string>();

// ---- component metadata (vue-component-meta) ----

function extractImportParts(ast: ReturnType<typeof babelParse>): Import[] {
    return ast.program.body
        .filter((node): node is any => node.type === 'ImportDeclaration')
        .map((node) => {
            const parts: ImportedPart[] = [];
            for (const specifier of node.specifiers) {
                const isWrapped = specifier.type === 'ImportSpecifier';
                const isType = node.importKind === 'type' || specifier.importKind === 'type';
                const imported = specifier.type === 'ImportSpecifier' ? generate(specifier.imported, { comments: true }).code : '*';
                parts.push({
                    imported,
                    local: specifier.local.name,
                    isType,
                    isWrapped,
                    isNamespace: specifier.type === 'ImportNamespaceSpecifier',
                });
            }
            return { parts, source: node.source.value };
        });
}

function extractTypesInScriptTag(ast: ReturnType<typeof babelParse>): string[] {
    return ast.program.body.flatMap((node) => {
        const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
        if (declaration?.type !== 'TSTypeAliasDeclaration' && declaration?.type !== 'TSInterfaceDeclaration') return [];
        // Generate the whole `ExportNamedDeclaration` so a `export type X` stays
        // exported - other modules import these types.
        return [generate(node.type === 'ExportNamedDeclaration' ? node : declaration, { comments: true }).code];
    });
}

function extractScript(
    src: string,
    ast: ReturnType<typeof babelParse>,
    templateAst: any
): { body: string; generic: string[]; withDefaults: string | null; scriptEdits: ScriptEdit[] } {
    const { descriptor } = parse(src, { filename: 'component.vue' });
    const ss = descriptor.scriptSetup;
    if (!ss) return { body: '', generic: [], withDefaults: null, scriptEdits: [] };
    const generic: string[] = [];
    const genericAttr = ss.attrs?.generic as string | undefined;
    if (genericAttr) {
        let depth = 0;
        let cur = '';
        for (const ch of genericAttr) {
            if (ch === '<' || ch === '{' || ch === '(') depth++;
            else if (ch === '>' || ch === '}' || ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                const trimmed = cur.trim();
                if (trimmed) generic.push(trimmed);
                cur = '';
            } else {
                cur += ch;
            }
        }
        const trimmed = cur.trim();
        if (trimmed) generic.push(trimmed);
    }
    const content = ss.content ?? '';
    const withDefaultsCall = findCalls(ast, 'withDefaults').find((call) => call.arguments?.[0]?.type === 'CallExpression' && call.arguments[0].callee?.name === 'defineProps');
    const withDefaults = withDefaultsCall ? sourceText(content, withDefaultsCall.arguments[1]) : null;
    const scriptEdits: ScriptEdit[] = [];
    for (const node of ast.program.body) {
        if (
            node.type === 'ImportDeclaration' ||
            node.type === 'TSTypeAliasDeclaration' ||
            node.type === 'TSInterfaceDeclaration' ||
            (node.type === 'ExportNamedDeclaration' && (node.declaration?.type === 'TSTypeAliasDeclaration' || node.declaration?.type === 'TSInterfaceDeclaration'))
        ) {
            scriptEdits.push({ start: node.start ?? 0, end: node.end ?? 0, kind: 'remove' });
        }
    }
    const statements = ast.program.body;
    const addMacroStatements = (name: ScriptEdit['kind']): void => {
        for (const call of findCalls(ast, name)) {
            const statement = statements.find((candidate: any) => (candidate.start ?? 0) <= (call.start ?? 0) && (candidate.end ?? 0) >= (call.end ?? 0));
            if (statement) scriptEdits.push({ start: statement.start ?? 0, end: statement.end ?? 0, kind: name });
        }
    };
    addMacroStatements('defineProps');
    addMacroStatements('defineEmits');
    addMacroStatements('defineModel');
    addMacroStatements('defineExpose');
    addMacroStatements('defineOptions');
    scriptEdits.push(...templateRefEdits(src, ast, templateAst));
    return { body: content, generic, withDefaults, scriptEdits };
}

// `useTemplateRef('x')` only resolves in an SFC template (the string key is matched by the
// compiler) and returns a readonly ref, so it cannot be used in a render function. Rewrite
// it to a plain ref typed from the element that carries `ref="x"`.
const DOM_REF_TYPES: Record<string, string> = {
    a: 'HTMLAnchorElement',
    audio: 'HTMLAudioElement',
    button: 'HTMLButtonElement',
    canvas: 'HTMLCanvasElement',
    form: 'HTMLFormElement',
    img: 'HTMLImageElement',
    input: 'HTMLInputElement',
    select: 'HTMLSelectElement',
    textarea: 'HTMLTextAreaElement',
    video: 'HTMLVideoElement',
};

function templateRefEdits(src: string, ast: ReturnType<typeof babelParse>, templateAst: any): ScriptEdit[] {
    const refTargets = new Map<string, string>();
    const seen = new Set<object>();
    const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const ref = (node.props ?? []).find((property: any) => property.type === 6 && property.name === 'ref' && property.value?.content);
        // Only native elements: a component ref needs its exposed instance type, which the
        // template alone cannot provide.
        if (ref && /^[a-z]/.test(node.tag)) refTargets.set(ref.value.content, node.tag);
        for (const key in node) walk(node[key]);
    };
    walk(templateAst);

    return findCalls(ast, 'useTemplateRef').flatMap((call) => {
        const key = call.arguments?.[0]?.type === 'StringLiteral' ? call.arguments[0].value : undefined;
        const declared = sourceText(src, callTypeArguments(call)[0]);
        const tag = key ? refTargets.get(key) : undefined;
        const type = declared || (tag ? (DOM_REF_TYPES[tag] ?? 'HTMLElement') : '');
        if (!type) return [];
        return [{ start: call.start ?? 0, end: call.end ?? 0, kind: 'remove' as const, replacement: `ref<${type} | null>(null)` }];
    });
}

// Split one `<script setup generic="...">` entry into name / constraint / default.
// The default (= X) must be cut off before the `extends` match, otherwise it is
// swallowed into the constraint and emitted as invalid `type _T = X = Y`.
function parseGenericParam(param: string): GenericParam {
    let depth = 0;
    let defaultAt = -1;
    for (let i = 0; i < param.length; i++) {
        const ch = param[i];
        if (ch === '<' || ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '>' || ch === '}' || ch === ')' || ch === ']') depth--;
        else if (ch === '=' && depth === 0) {
            const prev = param[i - 1] ?? '';
            const next = param[i + 1] ?? '';
            // skip `=>`, `==`, `>=`, `<=`, `!=`
            if (prev !== '<' && prev !== '>' && prev !== '=' && prev !== '!' && next !== '=' && next !== '>') {
                defaultAt = i;
                break;
            }
        }
    }
    const head = (defaultAt === -1 ? param : param.slice(0, defaultAt)).trim();
    const defaultValue = defaultAt === -1 ? null : param.slice(defaultAt + 1).trim() || null;
    const m = head.match(/^([A-Z][\w$]*)(?:\s+extends\s+([\s\S]+))?$/);
    return { name: m?.[1] ?? head, constraint: m?.[2]?.trim() ?? null, default: defaultValue };
}

// ---- template -> TNode tree ----

let typeScriptContext: SlotTypeScriptContext | null = null;
let currentFile = '';
let analyzedFiles: string[] = [];

export function initializeTypeScriptAnalyzer(files: string[]): void {
    analyzedFiles = files;
    const sources = new Map(
        files.map((file) => {
            const absoluteFile = resolve(file);
            return [
                `${absoluteFile}.ts`,
                ts.createSourceFile(
                    `${absoluteFile}.ts`,
                    readFileSync(file, 'utf-8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '',
                    ts.ScriptTarget.Latest,
                    true,
                    ts.ScriptKind.TS
                ),
            ];
        })
    );
    const firstFile = resolve(files[0] ?? tsconfigFile);
    const fileExists = (name: string): boolean => ts.sys.fileExists(name) || sources.has(name);
    const configPath = ts.findConfigFile(firstFile, fileExists, tsconfigFile) ?? ts.findConfigFile(firstFile, fileExists, 'tsconfig.json');
    const config = configPath ? ts.readConfigFile(configPath, (name) => ts.sys.readFile(name)) : undefined;
    const options =
        config?.config && configPath
            ? ts.parseJsonConfigFileContent(config.config, ts.sys, join(configPath, '..')).options
            : { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ESNext };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
        sources.get(name) ?? originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([...sources.keys()], options, host);
    typeScriptContext = { checker: program.getTypeChecker(), sources };
}
// v-for aliases and slot-scope params collected from the template AST. These
// are local to the template and must not be prefixed with _ctx / props.
const forAliases = new Set<string>();

function toCamel(s: string): string {
    return s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// Vue camelizes attribute names for props a component declares (`:data-node-id`
// binds `dataNodeId`), but keeps other `data-*` / `aria-*` hyphenated so they stay
// DOM attributes. JSX matches attribute names verbatim, and a hyphenated attribute
// makes TS drop a generic component's type parameters to their constraints.
const componentPropsCache = new Map<string, Set<string>>();

function componentPropNames(tag: string): Set<string> {
    const cached = componentPropsCache.get(tag);
    if (cached) return cached;

    const names = new Set<string>();
    componentPropsCache.set(tag, names);

    const file = analyzedFiles.find((candidate) => basename(candidate, '.vue') === tag);
    const source = file && typeScriptContext ? typeScriptContext.sources.get(`${resolve(file)}.ts`) : undefined;
    const propsType = source ? findDefinePropsType(source) : undefined;
    if (!propsType || !typeScriptContext) return names;

    for (const property of typeScriptContext.checker.getTypeFromTypeNode(propsType).getProperties()) names.add(property.getName());
    return names;
}

function findDefinePropsType(source: ts.SourceFile): ts.TypeNode | undefined {
    let found: ts.TypeNode | undefined;
    const visit = (node: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineProps' && node.typeArguments?.length) {
            found = node.typeArguments[0];
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

function toPropName(s: string, tag: string): string {
    const camel = toCamel(s);
    if (camel === s || !/^(aria|data)-/.test(s)) return camel;
    return componentPropNames(tag).has(camel) ? camel : s;
}

function findDir(node: any, name: string): any {
    return (node?.props ?? []).find((p: any) => p.type === 7 && p.name === name);
}

// Collect v-for aliases and slot-scope params from the template AST so they can
// be treated as local identifiers (not prefixed with _ctx / props).
function collectBindingNames(pattern: string): Set<string> {
    const names = new Set<string>();
    try {
        const parsed = babelParse(`const ${pattern} = undefined`, { sourceType: 'module', plugins: ['typescript'] });
        const declaration = parsed.program.body[0];
        if (declaration.type !== 'VariableDeclaration') return names;
        const seen = new Set<object>();
        const walk = (node: any): void => {
            if (!node || typeof node !== 'object' || seen.has(node)) return;
            seen.add(node);
            if (node.type === 'Identifier') names.add(node.name);
            for (const key in node) walk(node[key]);
        };
        walk(declaration.declarations[0]?.id);
    } catch {
        // Unsupported Vue binding patterns are left untouched.
    }
    return names;
}

function collectForAliases(ast: any): void {
    forAliases.clear();
    const seen = new Set<object>();
    const walk = (n: any) => {
        if (!n || typeof n !== 'object' || seen.has(n)) return;
        seen.add(n);
        if (n.type === 7 && n.name === 'for' && n.forParseResult) {
            const source = (n.forParseResult.source?.content ?? '').trim();
            for (const expression of [n.forParseResult.value, n.forParseResult.key, n.forParseResult.index]) {
                for (const name of collectBindingNames(expression?.content ?? '')) forAliases.add(name);
            }
            if (source) {
                const indexNames = [n.forParseResult.key, n.forParseResult.index].flatMap((expression) => [...collectBindingNames(expression?.content ?? '')]);
                recordSlotAlias([...collectBindingNames(n.forParseResult.value?.content ?? '')], indexNames, source);
            }
        }
        if (n.type === 7 && n.name === 'slot' && n.exp?.content) {
            for (const name of collectBindingNames(n.exp.content)) forAliases.add(name);
        }
        for (const k in n) walk(n[k]);
    };
    walk(ast);
}

function staticStyleEntries(staticStyle: string): string {
    const entries: string[] = [];
    for (const part of staticStyle.split(';')) {
        const p = part.trim();
        if (!p) continue;
        const idx = p.indexOf(':');
        const key = p
            .slice(0, idx)
            .trim()
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const val = p.slice(idx + 1).trim();
        const keyStr = /^[A-Za-z_$][\w$]*$/.test(key) ? key.replace(/^-/, '') : `'${key.replace(/^-/, '')}'`;
        entries.push(`${keyStr}: '${val.replace(/'/g, "\\'")}'`);
    }
    return entries.join(', ');
}

// Vue merges a static `style`, a `:style` binding and `v-show` onto the same
// element; emitting them separately gives the element two `style` attributes,
// which JSX rejects (TS17001). Object literals merge into one object (later
// parts win, like Vue); anything else - a binding may be a plain string - keeps
// Vue's own array form, the only shape that accepts every StyleValue.
function buildStyle(staticStyle: string | null, boundStyle: string | null, showCond: string | null): string {
    const parts: string[] = [];
    if (staticStyle) {
        const entries = staticStyleEntries(staticStyle);
        if (entries) parts.push(`{ ${entries} }`);
    }
    if (boundStyle) parts.push(boundStyle);
    if (showCond) parts.push(`{ display: ${showCond} ? undefined : 'none' }`);

    const objects = parts.map((part) => /^\{([\s\S]*)\}$/.exec(part));
    const merged = objects.filter((match): match is RegExpExecArray => match !== null);
    if (parts.length > 1 && merged.length === parts.length) {
        return `{ ${merged
            .map((match) => match[1].trim().replace(/,\s*$/, ''))
            .filter(Boolean)
            .join(', ')} }`;
    }
    return parts.length > 1 ? `[${parts.join(', ')}]` : (parts[0] ?? '{}');
}

function handlerBody(exp: string | undefined, mods: any[]): EventHandler {
    const t = (exp ?? '').trim();
    let isReference = false;
    try {
        const expressionType = parseExpression(t, { plugins: ['typescript'] }).type;
        isReference =
            expressionType === 'Identifier' || expressionType === 'MemberExpression' || expressionType === 'ArrowFunctionExpression' || expressionType === 'FunctionExpression';
    } catch {
        // Inline statements and malformed expressions are emitted as callbacks.
    }
    return { body: t, modifiers: mods.map((m) => m.content), isReference };
}

function genForSource(forDir: any): { source: string; pattern: string; key: string; isArray: boolean } {
    const parsed = forDir.forParseResult;
    if (!parsed?.source?.content) return { source: '', pattern: '', key: '', isArray: true };
    const source = parsed.source.content;
    const value = parsed.value?.content ?? '';
    const key = parsed.key?.content ?? '';
    const index = parsed.index?.content ?? '';
    if (!key && !index) return { source, pattern: value, key: '', isArray: true };
    const checkedIsArray = typeCheckerKnowsArray(source);
    const isArray = Boolean(index) || checkedIsArray === true;
    return { source, pattern: isArray ? [value, key || index].filter(Boolean).join(', ') : `[${key}, ${value}]`, key, isArray };
}

function typeCheckerKnowsArray(source: string): boolean | null {
    const sourceFile = typeScriptContext?.sources.get(`${resolve(currentFile)}.ts`);
    const checker = typeScriptContext?.checker;
    if (!sourceFile || !checker) return null;

    const sourceParts = source.split('.');
    const root = sourceParts.shift();
    if (!root) return null;

    const rootNodes: ts.Identifier[] = [];
    const collectRoots = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === root) rootNodes.push(node);
        node.forEachChild(collectRoots);
    };
    collectRoots(sourceFile);

    const candidateTypes = rootNodes.map((node) => {
        let type = checker.getTypeAtLocation(node);
        const refName = type.aliasSymbol?.getName() ?? type.symbol?.getName();
        if (refName === 'Ref' || refName === 'ComputedRef' || refName === 'WritableComputedRef' || refName === 'ShallowRef') {
            const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
            if (typeArguments[0]) type = typeArguments[0];
            if (sourceParts[0] === 'value') sourceParts.shift();
        }
        for (const part of sourceParts) {
            const property = checker.getPropertyOfType(type, part);
            if (!property) return type;
            type = checker.getTypeOfSymbolAtLocation(property, node);
        }
        return type;
    });
    if (candidateTypes.length === 0) return null;

    const isArrayLike = (type: ts.Type): boolean => {
        type = checker.getApparentType(type);
        if (checker.isArrayType(type) || checker.isTupleType(type)) return true;
        if (type.isUnion()) return type.types.length > 0 && type.types.every(isArrayLike);
        if (checker.getIndexTypeOfType(type, ts.IndexKind.Number)) return true;
        const target = 'target' in type ? type.target : undefined;
        const symbol = target && typeof target === 'object' && 'symbol' in target ? target.symbol : undefined;
        const name = symbol && typeof symbol === 'object' && 'getName' in symbol && typeof symbol.getName === 'function' ? symbol.getName() : undefined;
        return name === 'Array' || name === 'ReadonlyArray';
    };

    let foundKnownType = false;
    for (const type of candidateTypes) {
        if (isArrayLike(type)) return true;
        if (!(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))) foundKnownType = true;
    }

    return foundKnownType ? false : null;
}

function genNode(node: any, props: Set<string>, refs: Set<string>, bindings: Set<string>): TNode {
    switch (node.type) {
        case 1:
            return genElement(node, props, refs, bindings);
        case 2:
            return {
                kind: 'text',
                content: /[\r\n]/.test(node.loc?.source ?? '') ? node.content.trim() : node.content,
            };
        case 3:
            return { kind: 'comment', content: node.content };
        case 5:
            return { kind: 'expr', content: expression(node.content.content) };
        default:
            return { kind: 'text', content: '' };
    }
}

function genChildren(node: any, props: Set<string>, refs: Set<string>, bindings: Set<string>): TNode[] {
    const sourceChildren = node.children ?? [];
    const children = sourceChildren.filter((c: any, index: number) => {
        if (c.type !== 2 || c.content.trim()) return true;
        const previous = sourceChildren[index - 1];
        const next = sourceChildren[index + 1];
        const source = c.loc?.source ?? c.content;
        return previous?.type === 5 && next?.type === 5 && !/[\r\n]/.test(source) && /\s/.test(source);
    });
    const out: TNode[] = [];
    let i = 0;
    while (i < children.length) {
        const c = children[i];
        const ifDir = findDir(c, 'if');
        if (ifDir) {
            const branches: { cond: string | null; node: TNode }[] = [
                { cond: ifDir.exp?.content ? ifDir.exp.content : null, node: genNode(stripIfDirs(c), props, refs, bindings) },
            ];
            let j = i + 1;
            while (j < children.length) {
                // Vue permits comments between the elements in an
                // `v-if`/`v-else-if`/`v-else` chain. They are regular AST
                // children, so ignore them while looking for the next branch
                // or the chain would be split into independent nodes.
                let branchIndex = j;
                while (branchIndex < children.length && children[branchIndex].type === 3) branchIndex++;
                const next = children[branchIndex];
                const elseIfDir = findDir(next, 'else-if');
                const elseDir = findDir(next, 'else');
                if (elseIfDir) {
                    branches.push({
                        cond: elseIfDir.exp?.content ? elseIfDir.exp.content : null,
                        node: genNode(stripIfDirs(next), props, refs, bindings),
                    });
                    j = branchIndex + 1;
                } else if (elseDir) {
                    branches.push({ cond: null, node: genNode(stripIfDirs(next), props, refs, bindings) });
                    j = branchIndex + 1;
                    break;
                } else {
                    break;
                }
            }
            out.push({ kind: 'if', branches: branches.map((branch) => ({ ...branch, cond: branch.cond ? expression(branch.cond) : null })) });
            i = j;
        } else {
            out.push(genNode(c, props, refs, bindings));
            i++;
        }
    }
    return out;
}

function stripIfDirs(node: any): any {
    return { ...node, props: (node.props ?? []).filter((p: any) => !(p.type === 7 && ['if', 'else', 'else-if'].includes(p.name))) };
}

function genElement(node: any, props: Set<string>, refs: Set<string>, bindings: Set<string>): TNode {
    const isNative = /^[a-z]/.test(node.tag);
    const attrs: TAttr[] = [];
    const onHandlers = new Map<string, EventHandler[]>();
    let staticClass: string | null = null;
    let boundClass: string | null = null;
    let staticStyle: string | null = null;
    let boundStyle: string | null = null;
    let showCond: string | null = null;
    let forDir: any = null;
    let key: ParsedExpression | undefined;

    for (const p of node.props ?? []) {
        if (p.type === 6) {
            const attrName = isNative ? p.name : toPropName(p.name, node.tag);
            if (p.name === 'class') staticClass = p.value?.content ?? '';
            else if (p.name === 'style') staticStyle = p.value?.content ?? '';
            else if (p.name === 'ref' && p.value?.content && bindings.has(p.value.content)) attrs.push({ kind: 'ref', name: p.value.content });
            else if (p.value) attrs.push({ kind: 'static', name: attrName, value: p.value.content });
            else attrs.push({ kind: 'bool', name: attrName });
        } else if (p.type === 7) {
            switch (p.name) {
                case 'if':
                case 'else':
                case 'else-if':
                    break;
                case 'show':
                    showCond = p.exp?.content ?? null;
                    break;
                case 'for':
                    forDir = p;
                    break;
                case 'model': {
                    const target = p.exp?.content ?? '';
                    const arg = p.arg?.content ?? 'modelValue';
                    const val = target;
                    // Detect radio inputs: v-model binds `checked` (not `value`),
                    // and the static `value` attr is the radio's value.
                    const typeAttr = (node.props ?? []).find((pp: any) => pp.type === 6 && pp.name === 'type')?.value?.content;
                    const isRadio = isNative && typeAttr === 'radio';
                    const radioValue = isRadio ? ((node.props ?? []).find((pp: any) => pp.type === 6 && pp.name === 'value')?.value?.content ?? '') : '';
                    // If the element already has a user @input/@change handler,
                    // it updates the model itself — skip emitting the model's own
                    // update handler to avoid duplicate onInput/onChange attrs.
                    const hasInputHandler = (node.props ?? []).some(
                        (pp: any) => pp.type === 7 && pp.name === 'on' && (pp.arg?.content === 'input' || pp.arg?.content === 'change')
                    );
                    attrs.push({ kind: 'model', name: arg, target: expression(val), arg: p.arg?.content, isNative, isRadio, radioValue, skipUpdateHandler: hasInputHandler });
                    break;
                }
                case 'on': {
                    const ev = p.arg?.content ?? '';
                    const list = onHandlers.get(ev) ?? [];
                    list.push(handlerBody(p.exp?.content, p.modifiers ?? []));
                    onHandlers.set(toCamel(ev), list);
                    break;
                }
                case 'bind':
                    if (!p.arg?.content) {
                        const val = p.exp?.content ?? '';
                        attrs.push({ kind: 'spread', value: expression(val) });
                    } else if (p.arg?.content === 'class') boundClass = p.exp?.content ?? null;
                    else if (p.arg?.content === 'style') boundStyle = p.exp?.content?.trim() || null;
                    else if (p.arg?.content === 'key') {
                        if (node.tag !== 'template') key = expression(p.exp?.content ?? '');
                    } else {
                        const attrName = isNative ? (p.arg?.content ?? '') : toPropName(p.arg?.content ?? '', node.tag);
                        const expr = p.exp?.content?.trim() ? p.exp.content : (p.arg?.content ?? '');
                        attrs.push({ kind: 'bind', name: attrName, value: expression(expr) });
                    }
                    break;
                case 'html':
                    attrs.push({ kind: 'html', value: expression(p.exp?.content ?? '') });
                    break;
                case 'slot':
                    if (node.tag === 'template') attrs.push({ kind: 'slotAttr', name: p.arg?.content ?? '' });
                    break;
                default:
                    attrs.push({ kind: 'directive', name: p.name, value: p.exp?.content ? expression(p.exp.content) : undefined });
                    break;
            }
        }
    }

    for (const [ev, handlers] of onHandlers) attrs.push({ kind: 'event', name: ev, handlers });

    if (staticClass && boundClass) attrs.push({ kind: 'class', value: expression(`['${staticClass}', ${boundClass}]`) });
    else if (staticClass) attrs.push({ kind: 'static', name: 'class', value: staticClass });
    else if (boundClass) attrs.push({ kind: 'class', value: expression(boundClass) });

    if (staticStyle || boundStyle || showCond) attrs.push({ kind: 'style', value: expression(buildStyle(staticStyle, boundStyle, showCond)) });

    // Scoped slots passed to this component. Each `<template #name="scope">`
    // becomes an entry in the element's scopedSlots.
    const elementScopedSlots: TScopedSlot[] = [];
    const plainChildren: any[] = [];
    const ownSlot = (node.props ?? []).find((property: any) => property.type === 7 && property.name === 'slot');
    if (ownSlot) {
        elementScopedSlots.push({
            name: toCamel(ownSlot.arg?.content ?? 'default'),
            scope: ownSlot.exp?.content ?? '',
            inner: genChildren({ children: node.children ?? [] }, props, refs, bindings),
        });
    }
    for (const c of node.children ?? []) {
        if (c.type === 1 && c.tag === 'template') {
            const slotDir = (c.props ?? []).find((p: any) => p.type === 7 && p.name === 'slot');
            if (slotDir) {
                const slotName = slotDir.arg?.content ?? 'default';
                const scope = slotDir.exp?.content ?? '';
                const ifDir = findDir(c, 'if');
                elementScopedSlots.push({
                    name: toCamel(slotName),
                    scope,
                    inner: genChildren(c, props, refs, bindings),
                    condition: ifDir?.exp?.content ? expression(ifDir.exp.content) : undefined,
                });
                continue;
            }
        }
        if (!ownSlot) plainChildren.push(c);
    }
    const children = genChildren({ ...node, children: plainChildren }, props, refs, bindings);

    // <slot> outlet
    if (node.tag === 'slot') {
        const slotName = (node.props ?? []).find((p: any) => p.type === 6 && p.name === 'name')?.value?.content;
        const slotKey = slotName ? toCamel(slotName) : 'default';
        const bindings = (node.props ?? [])
            .filter((property: any) => property.type === 7 && property.name === 'bind' && property.arg?.content)
            .map((property: any) => ({ name: toCamel(property.arg.content), value: expression(property.exp?.content || property.arg.content) }));
        const args = bindings.map(
            (binding: { name: string; value: ParsedExpression }): SlotArg => ({
                name: binding.name,
                type: slotArgTypeFor(binding.value.source),
                optional: false,
            })
        );
        recordSlotOutlet(slotKey, args);
        return { kind: 'slot', name: slotKey, fallback: children, bindings };
    }

    const canBeTransparentTemplate =
        node.tag === 'template' &&
        (node.props ?? []).every(
            (property: any) => property.type === 7 && (['if', 'else', 'else-if', 'for'].includes(property.name) || (property.name === 'bind' && property.arg?.content === 'key'))
        );
    let result: TNode = canBeTransparentTemplate
        ? children.length === 1
            ? children[0]
            : { kind: 'fragment', children }
        : {
              kind: 'element',
              tag: node.tag,
              isNative,
              attrs,
              children,
              key,
              showCond: showCond ?? undefined,
              scopedSlots: elementScopedSlots.length ? elementScopedSlots : undefined,
          };

    if (forDir) {
        const { source, pattern, isArray } = genForSource(forDir);
        const keyDir = (node.props ?? []).find((property: any) => property.type === 7 && property.name === 'bind' && property.arg?.content === 'key');
        result = { kind: 'for', source: expression(source), pattern, key: keyDir?.exp?.content ? expression(keyDir.exp.content) : undefined, isArray, node: result };
    }
    return result;
}

const generate = ('default' in _generate ? _generate.default : _generate) as typeof _generate;
function walkUntil<R = any>(n: any, check: (c: any) => boolean): R | null {
    if (check(n)) {
        return n;
    }
    for (const k in n) {
        const v = n[k];
        if (v && typeof v === 'object') {
            const found = walkUntil<R>(v, check);
            if (found) return found;
        }
    }
    return null;
}
export function extractEmitOrPropsTypes(ast: ReturnType<typeof babelParse>, methodName: string): null | string | [string, string][] {
    try {
        const node = walkUntil<CallExpression>(ast.program, (c: any) => c?.type === 'CallExpression' && c.callee.type === 'Identifier' && c.callee.name === methodName);
        if (!node) {
            // console.warn(`${methodName}() not found in script setup. Using any.`);
            return null;
        }
        const typeParam = callTypeArguments(node)[0] as any;
        if (typeParam?.type === 'TSTypeLiteral' && typeParam.members.some((m: any) => m?.key?.name)) {
            return typeParam.members.map((m: any) => [m.key.name, generate(m.typeAnnotation?.typeAnnotation, { comments: true }).code]);
        }
        if (typeParam?.type === 'TSTypeReference') {
            return typeParam.typeName?.name;
        }
        if (node.arguments[0]?.type === 'ArrayExpression') {
            return node.arguments[0].elements.map((e) => (e?.type === 'StringLiteral' ? [e.value, '[]'] : null)).filter((e) => e !== null) as [string, string][];
        }
        console.warn(`${methodName}() is not typed with a type parameter or array of strings. Using any.`);
        return [];
        // return generate(node, { comments: false }).code;
    } catch (e) {
        console.error(`Error extracting ${methodName} types:`, e);
        return [];
    }
}
function extractRefNames(ast: ReturnType<typeof babelParse>): Set<string> {
    const refs = new Set<string>();
    const refTypes = new Set(['ref', 'shallowRef', 'computed']);
    while (true) {
        const node = walkUntil(ast.program, (c: any) => {
            if (c.init?.type === 'ConditionalExpression') {
                if (refTypes.has(c.init?.consequent?.callee?.name) && !refs.has(c.id.name)) return true;
                if (refTypes.has(c.init?.alternate?.callee?.name) && !refs.has(c.id.name)) return true;
            }
            return refTypes.has(c.init?.callee?.name) && !refs.has(c.id.name);
        });
        if (!node) break;
        refs.add(node.id.name);
    }

    return refs;
}

function extractTypedRefNames(file: string): Set<string> {
    const refs = new Set<string>();
    const refNames = new Set(['Ref', 'ComputedRef', 'WritableComputedRef', 'ShallowRef']);
    const absoluteFile = resolve(file);
    const virtualFile = `${absoluteFile}.ts`;
    const sourceFile = typeScriptContext?.sources.get(virtualFile);
    const checker = typeScriptContext?.checker;
    if (!sourceFile || !checker) return refs;
    const isRef = (node: ts.Node): boolean => {
        const type = checker.getTypeAtLocation(node);
        const symbols = [type.aliasSymbol, type.symbol].filter(Boolean).map((symbol) => symbol!.getName());
        return symbols.some((name) => refNames.has(name));
    };
    const walk = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
                if (ts.isBindingElement(element) && ts.isIdentifier(element.name) && isRef(element.name)) refs.add(element.name.text);
            }
        }
        node.forEachChild(walk);
    };
    walk(sourceFile);
    return refs;
}

// ---- slot scope arg types ----

export function extractImports(ast: ReturnType<typeof babelParse>): Set<string> {
    const imports = new Set<string>();
    const found = new Set<object>();
    while (true) {
        const node = walkUntil(ast.program, (c: any) => c.type === 'ImportDeclaration' && !found.has(c));
        if (!node) break;
        imports.add(generate(node, { comments: true }).code);
        found.add(node);
    }
    return imports;
}

function findCalls(ast: ReturnType<typeof babelParse>, name: string): any[] {
    const calls: any[] = [];
    const seen = new Set<object>();
    const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === name) calls.push(node);
        for (const key in node) walk(node[key]);
    };
    walk(ast.program);
    return calls;
}

// Babel 7 stores call type arguments on `typeParameters`; Babel 8 renamed the
// property to `typeArguments`. Read both so macros such as defineProps<T>(),
// defineEmits<T>() and defineModel<T>() keep their generic type arguments.
function callTypeArguments(call: any): any[] {
    return call?.typeArguments?.params ?? call?.typeParameters?.params ?? [];
}

function sourceText(src: string, node: any): string {
    return typeof node?.start === 'number' && typeof node?.end === 'number' ? src.slice(node.start, node.end).trim() : '';
}

function extractPropsBlocks(src: string, ast: ReturnType<typeof babelParse>): { blocks: (PropsBlock | PropsReference)[]; combineWith: 'intersection' | 'union' } {
    const blocks: (PropsBlock | PropsReference)[] = [];
    for (const call of findCalls(ast, 'defineProps')) {
        const typeParam = callTypeArguments(call)[0];
        const rawType = sourceText(src, typeParam);
        const props: Prop[] = [];
        if (typeParam?.type === 'TSTypeLiteral') {
            for (const member of typeParam.members ?? []) {
                const name = sourceText(src, member.key).replace(/^['"]|['"]$/g, '');
                const type = sourceText(src, member.typeAnnotation?.typeAnnotation) || 'any';
                const comment = member.trailingComments?.find((item: any) => item.type === 'CommentLine')?.value?.trim();
                if (name) props.push({ name, type, required: !member.optional, comment: comment ? `// ${comment}` : undefined });
            }
        } else if (typeParam?.type === 'TSTypeReference') {
            blocks.push({ kind: 'reference', name: rawType, rawType });
            continue;
        } else if (call.arguments?.[0]?.type === 'ObjectExpression') {
            for (const property of call.arguments[0].properties ?? []) {
                if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') continue;
                const name = sourceText(src, property.key).replace(/^['"]|['"]$/g, '');
                const typeNode = property.value?.properties?.find((item: any) => sourceText(src, item.key) === 'type')?.value;
                const defaultNode = property.value?.properties?.find((item: any) => sourceText(src, item.key) === 'default')?.value;
                if (name)
                    props.push({
                        name,
                        type: sourceText(src, typeNode) || 'any',
                        required: !defaultNode && !property.value?.properties?.some((item: any) => sourceText(src, item.key) === 'required' && item.value?.value === false),
                        defaultValue: sourceText(src, defaultNode) || undefined,
                    });
            }
        }
        blocks.push({ kind: 'object', props, rawType });
    }
    return { blocks, combineWith: 'intersection' };
}

function extractPropsFromChecker(file: string): Set<string> {
    const props = new Set<string>();
    const sourceFile = typeScriptContext?.sources.get(`${resolve(file)}.ts`);
    const checker = typeScriptContext?.checker;
    if (!sourceFile || !checker) return props;

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineProps') {
            const typeNode = node.typeArguments?.[0];
            if (typeNode) {
                for (const property of checker.getPropertiesOfType(checker.getTypeAtLocation(typeNode))) props.add(property.getName());
            }
        }
        node.forEachChild(visit);
    };
    visit(sourceFile);
    return props;
}

function extractBindingName(node: any): string | null {
    return node?.type === 'VariableDeclarator' && node.id?.type === 'Identifier' ? node.id.name : null;
}

function extractModels(src: string, ast: ReturnType<typeof babelParse>): Model[] {
    return findCalls(ast, 'defineModel').flatMap((call) => {
        const variable = walkUntil<any>(ast.program, (node) => node.type === 'VariableDeclarator' && node.init === call);
        const varName = variable?.id?.name ?? 'modelValue';
        const type = sourceText(src, callTypeArguments(call)[0]) || 'any';
        const first = call.arguments?.[0];
        const propName = first?.type === 'StringLiteral' ? first.value : 'modelValue';
        const options = first?.type === 'ObjectExpression' ? first : call.arguments?.[1];
        const required = options?.properties?.some((p: any) => sourceText(src, p.key) === 'required' && p.value?.value === true) ?? false;
        const defaultNode = options?.properties?.find((p: any) => sourceText(src, p.key) === 'default')?.value;
        return [{ propName, varName, type, required, defaultValue: sourceText(src, defaultNode) || undefined }];
    });
}

function extractEmitsDirect(src: string, ast: ReturnType<typeof babelParse>): Emit[] {
    const used = new Set<string>();
    for (const match of src.matchAll(/\bemit\(\s*['"]([^'"]+)['"]/g)) used.add(match[1]);
    return findCalls(ast, 'defineEmits').flatMap((call) => {
        const typeParam = callTypeArguments(call)[0];
        const entries: Emit[] = [];
        if (typeParam?.type === 'TSTypeLiteral') {
            for (const member of typeParam.members ?? []) {
                const name = sourceText(src, member.key).replace(/^['"]|['"]$/g, '');
                const annotation = member.typeAnnotation?.typeAnnotation ?? member.typeAnnotation;
                const tuple = annotation?.type === 'TSTupleType' ? annotation.elementTypes : [];
                const params = annotation?.type === 'TSFunctionType' ? annotation.parameters : member.parameters;
                if (name)
                    entries.push({
                        name,
                        args: [
                            ...(params ?? []).map((param: any) => ({
                                name: param.name?.name ?? param.label?.name,
                                type: sourceText(src, param.typeAnnotation?.typeAnnotation ?? param.elementType ?? param) || 'any',
                                optional: Boolean(param.optional || param.type === 'TSOptionalType'),
                            })),
                            ...tuple.map((param: any) => ({
                                name: param.label?.name,
                                type: sourceText(src, param.elementType ?? param) || 'any',
                                optional: Boolean(param.optional),
                            })),
                        ],
                        usedInScript: used.has(name),
                    });
            }
        } else if (call.arguments?.[0]?.type === 'ArrayExpression') {
            for (const item of call.arguments[0].elements ?? [])
                if (item?.type === 'StringLiteral') entries.push({ name: item.value, args: [], usedInScript: used.has(item.value) });
        }
        return entries;
    });
}

function extractEmitCalls(ast: ReturnType<typeof babelParse>): EmitCall[] {
    const calls: EmitCall[] = [];
    for (const call of findCalls(ast, 'emit')) {
        const event = call.arguments?.[0];
        if (event?.type === 'StringLiteral')
            calls.push({
                start: call.start ?? 0,
                end: call.end ?? 0,
                eventName: event.value,
                firstArgumentEnd: event.end ?? call.end ?? 0,
                secondArgumentStart: call.arguments?.[1]?.start,
            });
    }
    return calls;
}

function extractExposes(src: string, ast: ReturnType<typeof babelParse>): Expose[] {
    const call = findCalls(ast, 'defineExpose')[0];
    return (call?.arguments?.[0]?.properties ?? []).flatMap((property: any) => {
        if (property.type !== 'ObjectProperty') return [];
        const name = sourceText(src, property.key).replace(/^['"]|['"]$/g, '');
        return name ? [{ name, type: sourceText(src, property.value) || 'any', expression: sourceText(src, property.value) || undefined }] : [];
    });
}

function extractExposedTypes(file: string, scriptSrc: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (typeScriptContext) {
        const sourceFile = typeScriptContext.sources.get(`${resolve(file)}.ts`);
        if (sourceFile) {
            const checker = typeScriptContext.checker;
            const visit = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineExpose') {
                    const argument = node.arguments[0];
                    if (argument && ts.isObjectLiteralExpression(argument)) {
                        for (const property of argument.properties) {
                            if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
                                const type = checker.typeToString(checker.getTypeAtLocation(property.initializer), undefined, ts.TypeFormatFlags.NoTruncation);
                                result[property.name.text] = type.length <= 50 ? type : 'unknown';
                            }
                        }
                    }
                }
                node.forEachChild(visit);
            };
            visit(sourceFile);
            return result;
        }
    }
    const absoluteFile = resolve(file);
    const virtualFile = `${absoluteFile}.ts`;
    const sourceFile = ts.createSourceFile(virtualFile, scriptSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const fileExists = (name: string): boolean => ts.sys.fileExists(name);
    const readFile = (name: string): string | undefined => ts.sys.readFile(name);
    const configPath = ts.findConfigFile(absoluteFile, fileExists, tsconfigFile) ?? ts.findConfigFile(absoluteFile, fileExists, 'tsconfig.json');
    const config = configPath ? ts.readConfigFile(configPath, readFile) : undefined;
    const options =
        config?.config && configPath
            ? ts.parseJsonConfigFileContent(config.config, ts.sys, join(configPath, '..')).options
            : { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ESNext };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
        name === virtualFile ? sourceFile : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([virtualFile], options, host);
    const checker = program.getTypeChecker();
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineExpose') {
            const argument = node.arguments[0];
            if (argument && ts.isObjectLiteralExpression(argument)) {
                for (const property of argument.properties) {
                    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
                    const type = checker.typeToString(checker.getTypeAtLocation(property.initializer), undefined, ts.TypeFormatFlags.NoTruncation);
                    result[property.name.text] = type.length <= 50 ? type : 'unknown';
                }
            }
        }
        node.forEachChild(visit);
    };
    visit(sourceFile);
    return result;
}

// ---- main parse entry ----
function removeAllPosObjects(obj: any): void {
    if (!obj || (typeof obj !== 'object' && !Array.isArray(obj))) return;
    if (Array.isArray(obj)) {
        for (const item of obj) removeAllPosObjects(item);
        return;
    }
    if (typeof obj.start === 'number') delete obj.start;
    if (typeof obj.end === 'number') delete obj.end;
    if (typeof obj.loc === 'object') delete obj.loc;
    for (const k in obj) removeAllPosObjects(obj[k]);
}
export function parseVueFile(file: string): ParsedComponent {
    currentFile = file;
    const src = readFileSync(file, 'utf-8');
    const { descriptor } = parse(src, { filename: 'component.vue' });
    const scriptSrc = descriptor.scriptSetup?.content ?? '';
    const ast = babelParse(descriptor.scriptSetup?.content ?? '', {
        sourceType: 'module',
        plugins: ['typescript'],
    });

    if (!descriptor.template) throw new Error('No <template> block found');
    const debugMode = process.argv.includes('--debug');
    if (debugMode) {
        const jsonPath = join(__dirname, 'parseAst.json');
        const copy = JSON.parse(JSON.stringify(ast.program.body));
        removeAllPosObjects(copy);
        writeFileSync(jsonPath, JSON.stringify(copy, null, 2));
        console.log(`✔ Wrote ${jsonPath}`);
    }

    const manualRefs = extractRefNames(ast);
    for (const name of extractTypedRefNames(file)) manualRefs.add(name);

    const props = new Set<string>();
    const attrs = extractAttrs(descriptor.template.ast);
    const refs = manualRefs;
    const bindings = new Set<string>();
    for (const name of extractPropsFromChecker(file)) props.add(name);
    resetSlotState();
    collectForAliases(descriptor.template.ast);

    if (descriptor.scriptSetup) {
        try {
            const s = compileScript(descriptor, {
                id: 'x',
                fs: {
                    fileExists: (f) => {
                        try {
                            statSync(f);
                            return true;
                        } catch {
                            return false;
                        }
                    },
                    readFile: (f) => readFileSync(f, 'utf-8'),
                },
            });
            allBindings.clear();
            for (const [name, kind] of s.bindings ? Object.entries(s.bindings) : []) {
                allBindings.add(name);
                bindings.add(name);
                if (kind === 'props') props.add(name);
                else if (kind === 'setup-ref') {
                    refs.add(name);
                }
            }
        } catch {
            for (const block of extractPropsBlocks(src, ast).blocks) {
                if (block.kind === 'object') for (const prop of block.props) props.add(prop.name);
            }
            // Populate allBindings from imports so imported functions/objects
            // (e.g. twMerge, __) are treated as locals (not prefixed with _ctx).
            allBindings.clear();
            for (const imported of extractImportParts(ast)) {
                for (const part of imported.parts) {
                    allBindings.add(part.local);
                    bindings.add(part.local);
                }
            }
            // Local const/function/let declarations in <script setup> are setup
            // scope and must not be _ctx-prefixed.
            for (const statement of ast.program.body) {
                const declaration = statement.type === 'VariableDeclaration' ? statement : null;
                for (const item of declaration?.declarations ?? []) {
                    const name = extractBindingName(item);
                    if (name) {
                        allBindings.add(name);
                        bindings.add(name);
                        if (item.init?.type === 'CallExpression' && item.init.callee?.type === 'Identifier' && ['ref', 'computed', 'shallowRef'].includes(item.init.callee.name))
                            refs.add(name);
                    }
                }
                if (statement.type === 'FunctionDeclaration' && statement.id) {
                    allBindings.add(statement.id.name);
                    bindings.add(statement.id.name);
                }
            }
            // for (const m of src.matchAll(/const\s+(\w+)\s*=\s*inject</g)) {
            //     if (m[1]) refs.add(m[1]);
            // }
        }
    }

    // const walk = (n: any) => {
    //     for (const p of n.props ?? []) {
    //         if (p.name === 'model' && p.exp?.content && maybeRefs.has(p.exp.content)) refs.add(p.exp.content);
    //         if (p.name === 'ref' && p.value?.content && maybeRefs.has(p.value.content)) refs.delete(p.value.content);
    //     }
    //     for (const c of n.children ?? []) walk(c);
    // };
    // walk(descriptor.template.ast);

    const models = extractModels(scriptSrc, ast);
    for (const model of models) refs.add(model.varName);

    // Props and the slot-scope type context are needed while the template is
    // converted: slot outlet args are typed from their binding expressions.
    const propsBlocks = extractPropsBlocks(scriptSrc, ast);
    const propsVarName = (() => {
        const m = src.match(/const\s+([\w$]+)\s*=\s*(?:withDefaults\s*\(\s*)?defineProps/);
        return m ? m[1] : 'props';
    })();
    buildSlotScope({ file, ast, scriptSrc, propsBlocks, propsVarName, typeScript: typeScriptContext });

    const tree = genChildren(descriptor.template.ast, props, refs, bindings);

    // ---- build the ParsedComponent (raw data only, no output) ----
    const { body, generic, withDefaults, scriptEdits } = extractScript(src, ast, descriptor.template.ast);
    const genericParams = generic.map(parseGenericParam);

    const emits = extractEmitsDirect(scriptSrc, ast);
    const emitCalls = extractEmitCalls(ast);

    const imports = extractImportParts(ast);
    const typesInScriptTag = extractTypesInScriptTag(ast);
    const declaredTypeNames = ast.program.body.flatMap((node) => {
        const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
        return declaration?.type === 'TSTypeAliasDeclaration' || declaration?.type === 'TSInterfaceDeclaration' ? [declaration.id.name] : [];
    });
    const exposes = extractExposes(scriptSrc, ast);

    const styleBlock = (() => {
        const m = src.match(/<style[\s\S]*?<\/style>/);
        return m ? m[0] : null;
    })();
    const styleTag = styleBlock ?? '';
    const defineOptions = extractDefineOptions(ast);

    return {
        name: basename(file, '.vue'),
        tree,
        imports,
        typesInScriptTag,
        declaredTypeNames,
        scriptBody: body,
        scriptEdits,
        emitCalls,
        withDefaults,
        propsVarName,
        attrs: [...attrs],
        propsBlocks,
        emits,
        slots: collectSlots(),
        exposes,
        exposedTypes: extractExposedTypes(file, scriptSrc),
        models,
        genericParams,
        scriptLang: descriptor.scriptSetup?.lang === 'ts' ? 'ts' : 'js',
        styleTag,
        expressionContext: {
            props: [...props],
            refs: [...refs],
            bindings: [...allBindings],
            locals: [...forAliases],
        } satisfies ExpressionContext,
        layoutName: defineOptions.layoutName,
        inheritAttrs: defineOptions.inheritAttrs,
    };
}
