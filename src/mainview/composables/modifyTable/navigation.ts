import type { ModifyTableColumnDraft, ModifyTableForeignKeyDraft, ModifyTableIndexDraft, ModifyTableKeyDraft, ModifyTableNavigationSection } from './types';

type NavigationHost = {
    columns: ModifyTableColumnDraft[];
    keys: ModifyTableKeyDraft[];
    foreignKeys: ModifyTableForeignKeyDraft[];
    indexes: ModifyTableIndexDraft[];
};

/** The sidebar tree's sections: one item per column, key, foreign key and index in the draft. */
export function buildNavigationSections(state: NavigationHost) {
    return [
        {
            id: 'group:columns',
            title: 'columns',
            kind: 'columns',
            items: state.columns.map((column) => ({
                id: `column:${column.id}`,
                title: column.name,
                kind: 'column',
                rightText: column.status === 'new' ? 'new' : column.status === 'deleted' ? 'removed' : column.type || 'type',
                status: column.status,
            })),
        },
        {
            id: 'group:keys',
            title: 'keys',
            kind: 'keys',
            items: state.keys.map((key) => ({
                id: `key:${key.id}`,
                title: key.name,
                kind: 'key',
                rightText: `(${key.columns
                    .map((column) => column.columnName)
                    .filter(Boolean)
                    .join(', ')})`,
                status: key.status,
            })),
        },
        {
            id: 'group:foreign-keys',
            title: 'foreign keys',
            kind: 'foreign-keys',
            items: state.foreignKeys.map((foreignKey) => ({
                id: `foreign-key:${foreignKey.id}`,
                title: foreignKey.name,
                kind: 'foreign-key',
                rightText: `(${foreignKey.columns
                    .map((column) => column.columnName)
                    .filter(Boolean)
                    .join(', ')}) -> ${foreignKey.targetTable || 'target'}`,
                status: foreignKey.status,
            })),
        },
        {
            id: 'group:indexes',
            title: 'indexes',
            kind: 'indexes',
            items: state.indexes.map((index) => ({
                id: `index:${index.id}`,
                title: index.name,
                kind: 'index',
                rightText: `${index.columns
                    .map((column) => column.columnName)
                    .filter(Boolean)
                    .join(', ')}${index.isUnique ? '  UNIQUE' : index.type ? `  ${index.type}` : ''}`,
                status: index.status,
            })),
        },
    ] satisfies ModifyTableNavigationSection[];
}
