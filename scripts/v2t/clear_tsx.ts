// we find unused translation keys
import { globSync, rmSync } from 'node:fs';
import { vueProjectRootFolder } from './v2t_const';

const toDelete = new Set<string>();
// const allTsxFiles = globSync(`${vueProjectRootFolder}/**/*.tsx`);
function searchInAllFilesInDir(dir: string) {
    const files = globSync(`${dir}/**/*.{vue,tsx}`);
    const vueFiles = files.filter((f) => f.endsWith('.vue'));
    const tsxFiles = files.filter((f) => f.endsWith('.tsx'));
    for (const file of tsxFiles) {
        if (vueFiles.includes(file.replace(/\.tsx$/, '.vue'))) {
            toDelete.add(file);
        }
    }
}

console.log('scanning app directory...');
searchInAllFilesInDir(vueProjectRootFolder);
// searchInAllFilesInDir('shared');

// console.log('files to delete:', Array.from(toDelete).sort());
// const ignoredTsxFiles = allTsxFiles.filter((f) => !toDelete.has(f));
// console.log('ignored tsx files:', ignoredTsxFiles.sort());

for (const file of toDelete) {
    console.log('deleting file:', file);
    try {
        rmSync(file);
    } catch (err) {
        console.error(`Error deleting file ${file}:`, err);
        throw err;
    }
}
