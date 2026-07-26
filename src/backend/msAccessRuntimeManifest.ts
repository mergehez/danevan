export type MsAccessRuntimeArtifact = {
    groupId: string;
    artifactId: string;
    version: string;
};

export const MS_ACCESS_RUNTIME_FOLDER_NAME = 'msaccess-runtime';
export const MS_ACCESS_RUNTIME_LIB_FOLDER_NAME = 'lib';
export const MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME = 'jre';
export const MS_ACCESS_RUNTIME_JRE_FOLDER_NAME = 'jre';
export const MS_ACCESS_RUNTIME_BRIDGE_FILE_NAME = 'MsAccessBridge.java';
export const MS_ACCESS_RUNTIME_MANIFEST_FILE_NAME = 'manifest.json';
export const MS_ACCESS_RUNTIME_MAVEN_BASE_URL = 'https://repo1.maven.org/maven2';
export const MS_ACCESS_RUNTIME_SUPPORTED_JRE_PLATFORMS = ['darwin', 'win32'] as const;

export const msAccessRuntimeArtifacts: MsAccessRuntimeArtifact[] = [
    { groupId: 'io.github.spannm', artifactId: 'ucanaccess', version: '5.1.5' },
    { groupId: 'io.github.spannm', artifactId: 'jackcess', version: '5.1.3' },
    { groupId: 'org.hsqldb', artifactId: 'hsqldb', version: '2.7.4' },
    { groupId: 'org.apache.poi', artifactId: 'poi', version: '5.5.1' },
    { groupId: 'commons-codec', artifactId: 'commons-codec', version: '1.20.0' },
    { groupId: 'org.apache.commons', artifactId: 'commons-collections4', version: '4.5.0' },
    { groupId: 'org.apache.commons', artifactId: 'commons-math3', version: '3.6.1' },
    { groupId: 'commons-io', artifactId: 'commons-io', version: '2.21.0' },
    { groupId: 'com.zaxxer', artifactId: 'SparseBitSet', version: '1.3' },
    { groupId: 'org.apache.logging.log4j', artifactId: 'log4j-api', version: '2.24.3' },
];

export function getMsAccessRuntimeJarName(artifact: MsAccessRuntimeArtifact) {
    return `${artifact.artifactId}-${artifact.version}.jar`;
}

export function getMsAccessRuntimeJarUrl(artifact: MsAccessRuntimeArtifact) {
    return `${MS_ACCESS_RUNTIME_MAVEN_BASE_URL}/${artifact.groupId.replaceAll('.', '/')}/${artifact.artifactId}/${artifact.version}/${getMsAccessRuntimeJarName(artifact)}`;
}

export function getMsAccessRuntimePlatformJreFolderName(platform: string) {
    return `${MS_ACCESS_RUNTIME_GENERIC_JRE_FOLDER_NAME}-${platform}`;
}
