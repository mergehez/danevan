import { confirmation } from '@utils/useConfirmation';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp']);

export function isImagePath(path: string) {
    const normalized = path.toLowerCase().split('/').pop() ?? path.toLowerCase();
    const extension = normalized.split('.').pop();
    return extension ? imageExtensions.has(extension) : false;
}

export function fileIconAndLanguageByPath(path: string): { lang: string; icon: string } {
    const lowerPath = path.toLowerCase();
    const file = lowerPath.split('/').pop() ?? lowerPath;

    const map = [
        ['json', ['angular.json'], 'icon-[mdi--angular] text-red-500'],
        ['yaml', ['pubspec.yaml', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'], 'icon-[mdi--docker] text-blue-400'],
        ['toml', ['cargo.toml'], 'icon-[mdi--language-rust] text-orange-400'],
        ['toml', ['cargo.lock'], 'icon-[mdi--language-rust] text-orange-400'],
        ['go', ['go.mod', 'go.sum'], 'icon-[mdi--language-go] text-sky-300'],
        ['python', ['requirements.txt', 'ipynb'], 'icon-[mdi--language-python] text-yellow-300'],
        ['typescript', ['tailwind.config.ts'], 'icon-[mdi--tailwind] text-cyan-300'],
        ['javascript', ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'], 'icon-[mdi--tailwind] text-cyan-300'],
        ['dockerfile', ['dockerfile', 'containerfile'], 'icon-[mdi--docker] text-blue-400'],
        ['makefile', ['makefile'], 'icon-[mdi--hammer-wrench] text-stone-300'],
        ['html', ['vue'], 'icon-[mdi--vuejs] text-emerald-400'],
        ['html', ['svelte'], 'icon-[bxl--svelte] text-orange-400'],
        ['typescript', ['ts'], 'icon-[fluent--code-ts-16-filled] text-sky-400'],
        ['javascript', ['js', 'cjs', 'mjs'], 'icon-[fluent--code-js-16-filled] text-yellow-400'],
        ['javascript', ['jsx', 'tsx'], 'icon-[mdi--react] text-blue-400'],
        ['dart', ['dart'], 'icon-[bxl--flutter] text-sky-300'],
        ['php', ['php', 'phtml', 'php3', 'php4', 'php5', 'phar', 'phpt', 'blade.php'], 'icon-[mdi--language-php] text-indigo-300'],
        ['rust', ['rs'], 'icon-[mdi--language-rust] text-orange-400'],
        ['go', ['go'], 'icon-[mdi--language-go] text-sky-300'],
        ['python', ['py', 'pyi', 'pyw'], 'icon-[mdi--language-python] text-yellow-300'],
        ['java', ['java', 'gradle'], 'icon-[mdi--language-java] text-red-300'],
        ['kotlin', ['kt', 'kts'], 'icon-[mdi--language-kotlin] text-violet-300'],
        ['swift', ['swift'], 'icon-[mdi--language-swift] text-orange-300'],
        ['ruby', ['rb', 'gemspec'], 'icon-[mdi--language-ruby] text-red-400'],
        ['elixir', ['ex', 'exs', 'heex'], 'icon-[vscode-icons--file-type-elixir] text-violet-400'],
        ['lua', ['lua'], 'icon-[mdi--language-lua] text-blue-300'],
        ['perl', ['pl', 'pm'], 'icon-[vscode-icons--file-type-perl] text-cyan-300'],
        ['powershell', ['ps1', 'psm1', 'psd1'], 'icon-[mdi--powershell] text-blue-400'],
        ['json', ['json', 'lock'], 'icon-[picon--json] text-amber-300'],
        ['yaml', ['yml', 'yaml'], 'icon-[mdi--file-document-outline] text-amber-200'],
        ['xml', ['xml', 'xsd', 'xsl', 'csproj'], 'icon-[carbon--xml] text-orange-300'],
        ['css', ['css'], 'icon-[bxl--css3] text-sky-400'],
        ['markdown', ['md'], 'icon-[fluent--markdown-20-filled] text-blue-300'],
        ['html', ['html', 'htm'], 'icon-[mdi--language-html5] text-orange-400'],
        ['csharp', ['cs', 'sln', 'props', 'targets'], 'icon-[fluent--code-cs-16-filled] text-green-400'],
        ['scss', ['scss', 'sass'], 'icon-[bxl--sass] text-pink-400'],
        ['less', ['less'], 'icon-[bxl--less] text-blue-400'],
        ['sql', ['sql'], 'icon-[mdi--database] text-cyan-300'],
        ['graphql', ['graphql', 'gql'], 'icon-[mdi--graphql] text-pink-400'],
        ['proto', ['proto'], 'icon-[mdi--google-circles-communities] text-sky-300'],
        ['toml', ['toml'], 'icon-[mdi--file-cog-outline] text-amber-300'],
        ['ini', ['ini', 'cfg', 'conf'], 'icon-[mdi--tune-variant] text-slate-300'],
        ['terraform', ['tf', 'tfvars', '.terraform.lock.hcl'], 'icon-[mdi--terraform] text-violet-400'],
        ['prisma', ['prisma'], 'icon-[mdi--database-cog-outline] text-cyan-200'],
        ['shell', ['sh', 'bash', 'zsh', 'fish'], 'icon-[mdi--console] text-lime-300'],
        ['git', ['gitignore', 'gitattributes', 'gitmodules', 'gitkeep'], 'icon-[mdi--git] text-orange-400'],
        ['no_code', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'], 'icon-[mdi--file-image] text-pink-400'],
    ] as const;

    const found = map.find(([_, extensions]) => extensions.some((ext) => file === ext || lowerPath.endsWith(`.${ext}`)));
    if (found) {
        return {
            lang: found[0],
            icon: found[2],
        };
    }

    return {
        lang: 'plaintext',
        icon: 'icon-[mdi--file-outline] opacity-50',
    };
}

export function uniqueId(len = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

export async function confirmAction(params: { title: string; message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) {
    return await confirmation.request(params);
}

export function formatNumber(value: number) {
    if (value >= 1_000_000) {
        return `${Math.round(value / 1_000_000)}M`;
    }

    if (value >= 1_000) {
        return `${Math.round(value / 1_000)}K`;
    }

    return String(value);
}

export function strToNumber(str: string) {
    // convert any string to a number that is consistent across runs. strToNumber('aa') === strToNumber('aa') but strToNumber('aa') !== strToNumber('ab')
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) % 1_000_000_000;
    }
    return hash;
}

export function tryCatch<T>(tryFn: () => T, catchFn: (error: unknown) => T): T {
    try {
        return tryFn();
    } catch (error) {
        return catchFn(error);
    }
}
