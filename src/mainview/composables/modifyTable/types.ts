import type { DbType, ModifyTableColumnParams, TableInfo } from '../../../shared/types';
import type { MonacoDiagnosticMarker } from '../../lib/monaco';

export type ModifyTableColumnStatus = 'existing' | 'new' | 'deleted';

export type ModifyTableGroupKind = 'columns' | 'keys' | 'foreign-keys' | 'indexes';

export type ModifyTableSelectionKind = 'table' | 'group' | 'column' | 'key' | 'foreign-key' | 'index';

export type ModifyTableEntityStatus = ModifyTableColumnStatus;

export type ModifyTableMode = 'edit' | 'create';

export type ModifyTableColumnDraft = ModifyTableColumnParams & {
    id: string;
    status: ModifyTableColumnStatus;
    hidden: boolean;
    columnKind: string;
};

export type ModifyTableTableDraft = {
    name: string;
    comment: string;
    engine: string;
    collation: string;
    options: string;
};

export type ModifyTableKeyColumnDraft = {
    id: string;
    columnName: string;
};

export type ModifyTableKeyDraft = {
    id: string;
    originalName?: string;
    name: string;
    isPrimary: boolean;
    columns: ModifyTableKeyColumnDraft[];
    status: ModifyTableEntityStatus;
};

export type ModifyTableForeignKeyColumnDraft = {
    id: string;
    columnName: string;
    targetName: string;
};

export type ModifyTableForeignKeyDraft = {
    id: string;
    originalName?: string;
    name: string;
    /** The last name generated from the columns: cleared once the user types a name of their own. */
    autoName?: string;
    targetTable: string;
    columns: ModifyTableForeignKeyColumnDraft[];
    onDelete: string;
    onUpdate: string;
    match: string;
    status: ModifyTableEntityStatus;
};

export type ModifyTableIndexColumnDraft = {
    id: string;
    columnName: string;
    order: string;
};

export type ModifyTableIndexDraft = {
    id: string;
    originalName?: string;
    name: string;
    /** The last name generated from the columns: cleared once the user types a name of their own. */
    autoName?: string;
    comment: string;
    isUnique: boolean;
    type: string;
    columns: ModifyTableIndexColumnDraft[];
    status: ModifyTableEntityStatus;
};

export type ModifyTableNavigationItem = {
    id: string;
    title: string;
    kind: ModifyTableSelectionKind;
    rightText?: string;
    status?: ModifyTableEntityStatus;
};

export type ModifyTableNavigationSection = {
    id: string;
    title: string;
    kind: ModifyTableGroupKind;
    items: ModifyTableNavigationItem[];
};

export type ModifyTableOpenParams =
    | {
          connectionId: number;
          tableName: string;
          mode?: 'edit';
      }
    | {
          connectionId: number;
          tableName?: string;
          mode: 'create';
      };

export type ModifyTablePreviewState = {
    mode: ModifyTableMode;
    tableName: string | undefined;
    driver: DbType | undefined;
    currentTableInfo: TableInfo | undefined;
    existingTableNames: string[];
    allowTableRebuild: boolean;
    table: ModifyTableTableDraft;
    columns: ModifyTableColumnDraft[];
    originalColumns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
};

export type ModifyTableHistorySnapshot = {
    allowTableRebuild: boolean;
    table: ModifyTableTableDraft;
    columns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
    selectedNodeId: string | null;
    selectedKeyColumnId: string | null;
    selectedForeignKeyColumnId: string | null;
    selectedIndexColumnId: string | null;
};

export function createPreviewDiagnostic(message: string, severity: MonacoDiagnosticMarker['severity']): MonacoDiagnosticMarker {
    return {
        message,
        severity,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
        source: 'modify-table',
    };
}
