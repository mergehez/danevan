// Prune declarations the conversion leaves behind: imports nothing uses (a
// `watch` import kept alive only by a commented-out call) and destructured
// parameters the body ignores (`#child="{ item, parentId }"` carries every
// scope property into the generated callback).
//
// A binding is dropped only when its name is referenced nowhere else in the
// file, so shadowed names are never touched. Unused declarations are left
// alone on purpose — dropping `const x = f()` could drop a side effect.
//
// Usage: pruneUnusedSource(tsx)
import { parse } from '@babel/parser';

type Node = { type: string; start: number; end: number; name?: string; [key: string]: unknown };
type Span = [number, number];

// Containers whose `key` holds a name rather than a reference to a binding.
const nameKeys: Record<string, string[]> = {
    ImportSpecifier: ['imported', 'local'],
    ImportDefaultSpecifier: ['local'],
    ImportNamespaceSpecifier: ['local'],
    ExportSpecifier: ['exported'],
    VariableDeclarator: ['id'],
    FunctionDeclaration: ['id', 'params'],
    FunctionExpression: ['id', 'params'],
    ArrowFunctionExpression: ['params'],
    ClassDeclaration: ['id'],
    ClassExpression: ['id'],
    TSInterfaceDeclaration: ['id'],
    TSTypeAliasDeclaration: ['id'],
    TSEnumDeclaration: ['id'],
    TSModuleDeclaration: ['id'],
    TSEnumMember: ['id'],
    TSTypeParameter: ['name'],
    LabeledStatement: ['label'],
    BreakStatement: ['label'],
    ContinueStatement: ['label'],
    JSXAttribute: ['name'],
    JSXNamespacedName: ['namespace', 'name'],
    TSQualifiedName: ['right'],
};

const patternNodes = new Set(['ObjectPattern', 'ArrayPattern', 'RestElement', 'TSParameterProperty']);

function isName(node: Node, parent: Node | undefined, grandparent: Node | undefined, key: string): boolean {
    if (!parent) return false;
    if (parent.computed === true) return false;
    if (patternNodes.has(parent.type)) return true;
    if (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression' || parent.type === 'JSXMemberExpression') return key === 'property';
    // `{ a }` is a reference in an object literal but a binding in a pattern,
    // and `{ a: b }` binds `b` in a pattern too.
    if (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') return (key === 'key' && parent.value !== node) || grandparent?.type === 'ObjectPattern';
    if (parent.type === 'TSPropertySignature' || parent.type === 'TSMethodSignature') return key === 'key';
    if (parent.type === 'ClassMethod' || parent.type === 'ClassProperty' || parent.type === 'PropertyDefinition') return key === 'key';
    return (nameKeys[parent.type] ?? []).includes(key);
}

function forEachNode(root: Node, visit: (node: Node, ancestors: Node[], key: string) => void): void {
    const walk = (value: unknown, ancestors: Node[], key: string): void => {
        if (Array.isArray(value)) {
            for (const item of value) walk(item, ancestors, key);
            return;
        }
        if (!value || typeof value !== 'object' || typeof (value as Node).type !== 'string') return;
        const node = value as Node;
        visit(node, ancestors, key);
        ancestors.push(node);
        for (const [childKey, child] of Object.entries(node)) {
            if (childKey === 'loc' || childKey === 'start' || childKey === 'end' || childKey.endsWith('Comments')) continue;
            walk(child, ancestors, childKey);
        }
        ancestors.pop();
    };
    walk(root, [], '');
}

function referencedNames(ast: Node): Set<string> {
    const names = new Set<string>();
    forEachNode(ast, (node, ancestors, key) => {
        if ((node.type === 'Identifier' || node.type === 'JSXIdentifier') && !isName(node, ancestors.at(-1), ancestors.at(-2), key)) names.add(node.name as string);
    });
    return names;
}

// Widen a span to swallow one adjacent comma so comma-separated lists stay valid.
function withComma(source: string, node: Node): Span {
    let index = node.end;
    while (/[ \t]/.test(source[index])) index++;
    if (source[index] === ',') return [node.start, index + 1];
    index = node.start;
    while (/[ \t]/.test(source[index - 1])) index--;
    return source[index - 1] === ',' ? [index - 1, node.end] : [node.start, node.end];
}

function wholeLine(source: string, node: Node): Span {
    let start = node.start;
    while (/[ \t]/.test(source[start - 1])) start--;
    let end = node.end;
    if (source[end] === ';') end++;
    while (/[ \t]/.test(source[end])) end++;
    if (source[end] === '\n') end++;
    return [start, end];
}

function isUnusedProperty(property: Node, used: Set<string>): boolean {
    if (property.type !== 'ObjectProperty' || property.computed === true) return false;
    const key = property.key as Node;
    const value = property.value as Node;
    return (key.type === 'Identifier' || key.type === 'StringLiteral') && value.type === 'Identifier' && !used.has(value.name as string);
}

export function pruneUnusedSource(source: string): string {
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as Node;
    const used = referencedNames(ast);
    const spans: Span[] = [];
    forEachNode(ast, (node) => {
        if (node.type === 'ImportDeclaration') {
            const specifiers = node.specifiers as Node[];
            const unused = specifiers.filter((specifier) => !used.has(((specifier.local as Node).name as string) ?? ''));
            // No specifiers means a side-effect import, which always stays.
            if (!unused.length) return;
            if (unused.length === specifiers.length) spans.push(wholeLine(source, node));
            else spans.push(...unused.map((specifier) => withComma(source, specifier)));
            return;
        }
        if (!Array.isArray(node.params)) return;
        for (const param of node.params as Node[]) {
            if (param.type !== 'ObjectPattern') continue;
            const properties = param.properties as Node[];
            const unused = properties.filter((property) => isUnusedProperty(property, used));
            if (!unused.length) continue;
            // An empty pattern would trip no-empty-pattern, so an all-unused
            // pattern loses the whole parameter instead.
            spans.push(...(unused.length === properties.length ? [withComma(source, param)] : unused.map((property) => withComma(source, property))));
        }
    });
    if (!spans.length) return source;
    let output = source;
    for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) output = output.slice(0, start) + output.slice(end);
    return output;
}
