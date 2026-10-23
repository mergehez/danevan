import { vModel } from '#shared/utils/tsxHelpers.tsx';
import { IconButton } from '../../../shared/components/IconButton.tsx';
import { Input } from '../../../shared/components/Input.tsx';
import { Select } from '../../../shared/components/Select.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useModifyTableForm } from './formHelpers';

type Props = {};

export const ModifyTableForeignKeyForm = component(
    (_: Props) => {
        const {
            modifyTable,
            selectedForeignKey,
            selectedForeignKeyColumn,
            getLabelClass,
            isForeignKeyFieldDirty,
            referentialActionOptions,
            listToolbarClass,
            listItemClass,
            formGridClass,
            subGridClass,
            rowLabelClass,
        } = useModifyTableForm();

        return () => {
            const selFk = selectedForeignKey.value;

            if (!selFk) {
                return null;
            }

            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isForeignKeyFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selFk, 'name')} data-testid="modify-foreign-key-name" disabled={selFk.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isForeignKeyFieldDirty('targetTable'))}>Target Table</div>
                            <Select
                                {...vModel(selFk, 'targetTable')}
                                data-testid="modify-foreign-key-target"
                                options={modifyTable.targetTableNames}
                                disabled={selFk.status === 'deleted'}
                                small={true}
                            />
                            <div class={getLabelClass(isForeignKeyFieldDirty('onDelete'))}>On Delete</div>
                            <Select {...vModel(selFk, 'onDelete')} options={referentialActionOptions} disabled={selFk.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isForeignKeyFieldDirty('onUpdate'))}>On Update</div>
                            <Select {...vModel(selFk, 'onUpdate')} options={referentialActionOptions} disabled={selFk.status === 'deleted'} small={true} />
                        </div>
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selFk.status === 'deleted'}
                                v-tooltip={{ value: 'Add foreign key column', xs: true, nowrap: true }}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedForeignKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={{ value: 'Remove foreign key column', xs: true, nowrap: true }}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedForeignKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.columns.length < 2 || selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={{ value: 'Move foreign key column up', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedForeignKeyColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selFk.columns.length < 2 || selFk.status === 'deleted' || !selectedForeignKeyColumn.value}
                                v-tooltip={{ value: 'Move foreign key column down', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedForeignKeyColumnDown}
                            />
                        </div>
                        <div class={[subGridClass, 'grid-cols-[150px_1fr]']}>
                            <div class="border-r border-x4">
                                <div class="max-h-56 overflow-y-auto">
                                    {selFk.columns.map((column) => (
                                        <button
                                            type="button"
                                            onClick={() => modifyTable.selectForeignKeyColumn(column.id)}
                                            class={[listItemClass, selectedForeignKeyColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                            key={column.id}
                                        >
                                            <span class="min-w-0 flex-1 truncate">
                                                {column.columnName || 'column'}
                                                {' -> '}
                                                {column.targetName || 'target'}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div class={[formGridClass, 'px-1 py-2']}>
                                <span class={rowLabelClass}>Column Name</span>
                                {selectedForeignKeyColumn.value ? (
                                    <Select
                                        {...vModel(selectedForeignKeyColumn.value, 'columnName')}
                                        data-testid="modify-foreign-key-column"
                                        options={modifyTable.activeColumnNames}
                                        disabled={selFk.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                                <span class={rowLabelClass}>Target Name</span>
                                {selectedForeignKeyColumn.value ? (
                                    <Select
                                        {...vModel(selectedForeignKeyColumn.value, 'targetName')}
                                        options={modifyTable.getTargetTableColumnNames(selFk?.targetTable)}
                                        disabled={selFk.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            );
        };
    },
    { name: 'ModifyTableForeignKeyForm', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableForeignKeyForm;
