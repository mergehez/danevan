export const SQL_EDITOR_TABLE_DRAG_MIME = 'application/x-danevan-sql-table';

export type SqlEditorTableDropPayload = {
    connectionId: number;
    tableName: string;
};

export function serializeSqlEditorTableDropPayload(payload: SqlEditorTableDropPayload) {
    return JSON.stringify(payload);
}

export function parseSqlEditorTableDropPayload(rawValue: string | undefined) {
    if (!rawValue) {
        return undefined;
    }

    try {
        const parsedValue = JSON.parse(rawValue) as Partial<SqlEditorTableDropPayload>;

        if (typeof parsedValue.connectionId !== 'number' || !Number.isFinite(parsedValue.connectionId) || parsedValue.connectionId <= 0) {
            return undefined;
        }

        if (typeof parsedValue.tableName !== 'string' || !parsedValue.tableName.trim()) {
            return undefined;
        }

        return {
            connectionId: parsedValue.connectionId,
            tableName: parsedValue.tableName,
        } satisfies SqlEditorTableDropPayload;
    } catch {
        return undefined;
    }
}
