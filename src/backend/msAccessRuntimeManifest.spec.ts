import { describe, expect, it } from 'vitest';
import {
    MS_ACCESS_RUNTIME_JRE_FOLDER_NAME,
    MS_ACCESS_RUNTIME_MAVEN_BASE_URL,
    getMsAccessRuntimeJarName,
    getMsAccessRuntimeJarUrl,
    getMsAccessRuntimePlatformJreFolderName,
    msAccessRuntimeArtifacts,
} from './msAccessRuntimeManifest';

describe('MS Access runtime manifest', () => {
    it('names every jar after its artifact and version', () => {
        expect(msAccessRuntimeArtifacts.map(getMsAccessRuntimeJarName)).toEqual([
            'ucanaccess-5.1.5.jar',
            'jackcess-5.1.3.jar',
            'hsqldb-2.7.4.jar',
            'poi-5.5.1.jar',
            'commons-codec-1.20.0.jar',
            'commons-collections4-4.5.0.jar',
            'commons-math3-3.6.1.jar',
            'commons-io-2.21.0.jar',
            'SparseBitSet-1.3.jar',
            'log4j-api-2.24.3.jar',
        ]);
    });

    it('builds the Maven URL from the dotted group id', () => {
        const ucanaccess = msAccessRuntimeArtifacts[0]!;
        const log4j = msAccessRuntimeArtifacts.at(-1)!;

        expect(getMsAccessRuntimeJarUrl(ucanaccess)).toBe(`${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/io/github/spannm/ucanaccess/5.1.5/ucanaccess-5.1.5.jar`);
        expect(getMsAccessRuntimeJarUrl(log4j)).toBe(`${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/org/apache/logging/log4j/log4j-api/2.24.3/log4j-api-2.24.3.jar`);
    });

    it('keeps a per-platform JRE folder beside the generic one', () => {
        expect(getMsAccessRuntimePlatformJreFolderName('darwin')).toBe(`${MS_ACCESS_RUNTIME_JRE_FOLDER_NAME}-darwin`);
        expect(getMsAccessRuntimePlatformJreFolderName('win32')).toBe('jre-win32');
    });
});
