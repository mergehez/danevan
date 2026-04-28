import { tasks } from '@composables/useTasks';
import type { DbType } from '@utils/appClient';
import { writeClipboardText } from '@utils/nativePaths';

function normalizeMySqlDdl(ddl: string) {
    return ddl
        .replace(/\b(enum|set)\s+COLLATE\s+"([^"]+)"\s*\(([^)]*)\)/giu, (_match, type, collation, values) => `${type}(${values}) COLLATE ${collation}`)
        .replace(/\bCOLLATE\s+"([^"]+)"/giu, 'COLLATE $1')
        .replace(/\b(DEFAULT|ON UPDATE)\s+'((?:current_timestamp|curdate|curtime|localtimestamp|localtime|now|unix_timestamp)\s*\([^']*\))'/giu, '$1 ($2)');
}

function normalizeCopiedDdl(ddl: string, dialect?: DbType) {
    if (dialect === 'mysql') {
        return normalizeMySqlDdl(ddl);
    }

    return ddl;
}

export async function copyTableAsDdl(connectionId: number, tableName: string, dialect?: DbType) {
    const ddlPromise = tasks.getTableDdl
        .run({
            connectionId,
            tableName,
        })
        .then((ddl) => normalizeCopiedDdl(ddl, dialect));
    const formattedDdlPromise = ddlPromise.then(async (ddl) => {
        try {
            return await tasks.formatSql.run({
                sql: ddl,
                dialect,
            });
        } catch {
            tasks.formatSql.clearError();
            return ddl;
        }
    });

    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/plain': formattedDdlPromise.then((ddl) => new Blob([ddl], { type: 'text/plain' })),
            }),
        ]);
        return;
    }

    const ddl = await formattedDdlPromise;
    await writeClipboardText(ddl);
}
