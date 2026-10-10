// electron-builder loads `electron.config.js` through Node's ESM loader, and that loader resolves
// the relative imports in the chain itself (`electronConfig.ts` -> `helpers.ts` -> …). A
// bundler-style extensionless import there (`../shared/utils/errorMessage`) passes every test and
// every `vite build`, then makes `bun do mac` fail before it packages anything — which is what this
// spec loads, in a real Node process, the way the release does.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the electron-builder config', () => {
    it('loads in Node, so the release can read the app id it packages', () => {
        const configPath = join(process.cwd(), 'electron.config.js');
        const script = [
            `const config = (await import(${JSON.stringify(configPath)})).default;`,
            `if (typeof config?.appId !== 'string' || !config.appId) throw new Error('the config has no appId');`,
            `console.log(config.appId);`,
        ].join('\n');

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });

        expect(output.trim()).toBe('com.mergesoft.danevan');
    });
});
