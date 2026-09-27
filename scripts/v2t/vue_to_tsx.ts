// Orchestrator: parse a .vue file (v2t_parser) then convert to TSX (t2t_converter).
//
// Usage:
//   bun run scripts/vue_to_tsx.ts <file.vue | folder>
import { parse as babelParse } from '@babel/parser';
import { cancel, isCancel, multiselect } from '@clack/prompts';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tsconfigFile, tsxHelpersImportSource, vueProjectRootFolder } from './v2t_const.ts';
import { convertToTsx } from './v2t_converter.ts';
import { initializeTypeScriptAnalyzer, parseVueFile } from './v2t_parser.ts';
import { pruneUnusedSource } from './v2t_prune.ts';

// Convert a single .vue file to a .tsx sibling.
const debugMode = process.argv.includes('--debug');
const safeMode = process.argv.includes('--safe');
const convertedFiles = new Set<string>();
const unsafeMarkers = ['<template #', '<template v-slot:', 'v-bind="'];
function convertFile(file: string): void {
    if (safeMode && unsafeMarkers.some((marker) => readFileSync(file, 'utf8').includes(marker))) {
        console.log(`⏭ Skipped ${file} (--safe)`);
        return;
    }
    const parsed = parseVueFile(file);
    if (debugMode) {
        const jsonPath = join(__dirname, 'parseRes.json');
        writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
        console.log(`✔ Wrote ${jsonPath}`);
    }
    const tsx = convertToTsx(parsed);
    // Derive the check from tsxHelpersImportSource so it can't drift out of sync
    // with the import the converter actually emits.
    const helperImportPattern = new RegExp(`^import\\s*\\{[^}]*\\}\\s*from\\s*['"]${tsxHelpersImportSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"];?\\s*$`, 'm');
    const normalized = helperImportPattern.test(tsx) ? tsx : `import { component } from '${tsxHelpersImportSource}';\n${tsx}`;
    const outFile = join(dirname(file), basename(file, '.vue') + '.tsx');
    writeFileSync(outFile, pruneUnusedSource(normalized));
    convertedFiles.add(resolve(file));
    console.log(`✔ Wrote ${outFile}`);
}

// Recursively collect .vue files inside a folder.
function collectVueFiles(dir: string, rootDir?: string): string[] {
    const out: string[] = [];
    const filter = process.argv.includes('--filter') ? process.argv[process.argv.indexOf('--filter') + 1] : null;
    for (const entry of readdirSync(dir)) {
        // console.log(entry);
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) out.push(...collectVueFiles(full, rootDir || dir));
        else {
            if (filter) {
                const filters = filter
                    .split(',')
                    .map((f) => f.trim())
                    .map((f) => new RegExp(f.startsWith('*') ? f.slice(1) : `^${f}`));
                const pathNoRoot = full.slice((rootDir || dir).length);
                if (!filters.some((f) => f.test(pathNoRoot))) continue;
            }
            if (extname(full) === '.vue' && !basename(full).startsWith('.')) out.push(full);
        }
    }
    return out;
}

// The generated components use named exports. Update all imports in the
// converted inertia tree after a complete `inertia` conversion.
// Kept for compatibility with older batch workflows.
function updateInertiaImports(): void {
    const vueProjectRoot = resolve(vueProjectRootFolder);
    const tsxFiles = collectFiles(vueProjectRoot, '.tsx');
    for (const file of tsxFiles) {
        const source = readFileSync(file, 'utf8');
        const updated = source.replace(/^(\s*)import\s+(.+?)\s+from\s+(['"])([^'"\n]+)\.vue\3;?$/gm, (_match, indent, importClause, quote, modulePath) => {
            const importedFile = modulePath.startsWith('@/') ? resolve(vueProjectRoot, modulePath.slice(2) + '.vue') : resolve(dirname(file), modulePath + '.vue');
            if (!convertedFiles.has(importedFile)) return _match;
            const componentName = basename(modulePath);
            const defaultMatch = importClause.match(/^([\w$]+)(?:\s*,\s*)?/);
            const namedMatch = importClause.match(/\{([^}]*)\}/);
            const defaultName = defaultMatch?.[1];
            const namedImports =
                namedMatch?.[1]
                    .split(',')
                    .map((name: string) => name.trim())
                    .filter(Boolean) ?? [];
            const componentImport = defaultName ? (defaultName === componentName ? componentName : `${componentName} as ${defaultName}`) : componentName;
            const imports = namedImports.some((name: string) => name === componentName || name.startsWith(`${componentName} as `))
                ? namedImports
                : [componentImport, ...namedImports];
            return `${indent}import { ${imports.join(', ')} } from ${quote}${modulePath}.tsx${quote};`;
        });

        const withoutVueExtension = updated.replace(/(from\s+['"])([^'"\n]+)\.vue(['"])/g, (_match, prefix: string, modulePath: string, quote: string) => {
            const importedFile = modulePath.startsWith('@/') ? resolve(vueProjectRoot, modulePath.slice(2) + '.vue') : resolve(dirname(file), modulePath + '.vue');
            return convertedFiles.has(importedFile) ? `${prefix}${modulePath}${quote}` : _match;
        });
        const withoutModelUpdateEvents = withoutVueExtension
            .replace(/onUpdate:modelValue/g, 'onChange')
            .replace(/onUpdate:([\w$]+)/g, (_match, alias: string) => `on${alias.charAt(0).toUpperCase()}${alias.slice(1)}Change`)
            .replace(/on([A-Z][\w$]*):([\w$-]+)/g, (_match, prefix: string, event: string) => `on${prefix}${event.charAt(0).toUpperCase()}${event.slice(1)}`);
        if (withoutModelUpdateEvents !== source) writeFileSync(file, withoutModelUpdateEvents);
    }
}

void updateInertiaImports;

// Replace .vue imports with extensionless paths when the corresponding Vue
// file no longer exists and the TSX replacement does exist.
export function fixImports(): void {
    const vueProjectRoot = resolve(vueProjectRootFolder);
    const files = [...collectFiles(vueProjectRoot, '.tsx'), ...collectFiles(vueProjectRoot, '.vue')];
    const aloneTsxFiles = collectFiles(vueProjectRoot, '.tsx').filter((file) => !statSync(file.replace(/\.tsx$/, '.vue'), { throwIfNoEntry: false }));
    for (const file of files) {
        const absoluteFile = resolve(file);
        const source = readFileSync(absoluteFile, 'utf8');
        let updated = source.replace(/(from\s+['"])([^'"\n]+)\.vue(['"])/g, (_match, prefix: string, modulePath: string, quote: string) => {
            const importedFile = modulePath.startsWith('@/') ? resolve(vueProjectRoot, modulePath.slice(2) + '.tsx') : resolve(dirname(absoluteFile), modulePath + '.tsx');
            const isAloneTsx = aloneTsxFiles.includes(importedFile);
            return isAloneTsx ? `${prefix}${modulePath}${quote}` : _match;
        });
        if (aloneTsxFiles.includes(absoluteFile)) {
            const componentName = basename(absoluteFile, '.tsx');
            const ast = babelParse(updated, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
            const declaration = ast.program.body.find((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration');
            const variable =
                declaration?.type === 'ExportNamedDeclaration' && declaration.declaration?.type === 'VariableDeclaration' ? declaration.declaration.declarations[0] : undefined;
            if (
                variable?.id.type === 'Identifier' &&
                variable.id.name === componentName &&
                variable.init?.type === 'CallExpression' &&
                variable.init.callee.type === 'Identifier' &&
                variable.init.callee.name === 'component'
            ) {
                const lastArgument = variable.init.arguments[variable.init.arguments.length - 1];
                if (!lastArgument || lastArgument.type !== 'ObjectExpression') return;
                if (!lastArgument.properties.some((property: any) => property.type === 'ObjectProperty' && property.key.type === 'Identifier' && property.key.name === 'name')) {
                    const position = lastArgument.start ?? 0;
                    const before = updated.slice(0, position);
                    const after = updated.slice(position);
                    updated = `${before}{ name: '${componentName}', ${after.slice(1)}`;
                }
            }
        }
        if (updated !== source) writeFileSync(absoluteFile, updated);
    }
}

function collectFiles(dir: string, extension: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...collectFiles(full, extension));
        else if (extname(full) === extension) files.push(full);
    }
    return files;
}

async function main() {
    if (process.argv.includes('--fix')) {
        fixImports();
        console.log('✔ Fixed imports');
        process.exit(0);
    }

    let arg = process.argv[2];
    if (!arg) {
        console.error('Usage: bun run scripts/vue_to_tsx.ts <file.vue | folder>');
        process.exit(1);
    }

    if (arg.endsWith('.tsx')) arg = `${arg.slice(0, -4)}.vue`;

    const argStat = statSync(arg);
    const isDir = argStat.isDirectory();
    if (isDir) {
        const files = collectVueFiles(arg).sort();
        if (files.length === 0) {
            console.error('No .vue files found in that folder.');
            process.exit(1);
        }
        const all = process.argv.includes('--all');

        const selection = all
            ? files
            : await multiselect({
                  message: `Select .vue files to convert (${files.length} found in ${arg})`,
                  options: files.map((f) => ({ value: f, label: f.slice(arg.length) })),
                  required: false,
              });
        if (isCancel(selection)) {
            cancel('Canceled.');
            process.exit(0);
        }
        if (all) {
            execSync(`bun clear_tsx.ts`, { stdio: 'inherit', cwd: __dirname });
        }
        initializeTypeScriptAnalyzer(files);
        for (const f of selection as string[]) convertFile(f);
        if (process.argv.includes('--all')) updateInertiaImports();
        console.log(`\nDone. Converted ${convertedFiles.size} file(s). Skipped ${(selection as string[]).length - convertedFiles.size}.`);
    } else {
        initializeTypeScriptAnalyzer([arg]);
        convertFile(arg);
        if (safeMode) console.log(`\nSkipped ${convertedFiles.size === 0 ? 1 : 0} file(s).`);
    }
    // Format the generated file with the project's formatter (oxfmt).
    try {
        if (isDir) execSync(`node_modules/.bin/oxfmt`, { stdio: 'inherit' });
        else execSync(`node_modules/.bin/oxfmt ${arg.replace(/\.vue$/, '.tsx')}`, { stdio: 'inherit' });
    } catch {
        // oxfmt may already be run / fail on edge cases; don't fail the conversion.
    }
    if (debugMode) {
        return;
    }
    fixImports();
    if (isDir) {
        try {
            execSync(`bun x vue-tsc --noEmit -p ${tsconfigFile}`, { stdio: 'inherit' });
        } catch {}
    }
}

main();
