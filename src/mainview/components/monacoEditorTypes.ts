export type MonacoEditorActionTone = 'default' | 'danger';

export type MonacoEditorActionButton = {
    id: string;
    label: string;
    title?: string;
    busy?: boolean;
    disabled?: boolean;
    tone?: MonacoEditorActionTone;
    onClick: () => void;
};

export type MonacoEditorActionZone = {
    id: string;
    afterLineNumber: number;
    startLineNumber?: number;
    endLineNumber?: number;
    originalStartLineNumber?: number;
    originalEndLineNumber?: number;
    label?: string;
    meta?: string;
    actions: MonacoEditorActionButton[];
};
