import { vModel } from '#shared/utils/tsxHelpers.tsx';
import { Checkbox } from '../../../shared/components/Checkbox.tsx';
import { Input } from '../../../shared/components/Input.tsx';
import { ListBox } from '../../../shared/components/ListBox.tsx';
import { Select } from '../../../shared/components/Select.tsx';
import { getDbCollationOptions } from '../../lib/collations';
import { getDbColumnDataTypeOptions } from '../../lib/dbColumnDataType';
import { getDbDefaultExpressionOptions } from '../../lib/dbDefaultExpression';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useModifyTableForm } from './formHelpers';

type Props = {};

export const ModifyTableColumnForm = component(
    (_: Props) => {
        const { modifyTable, selectedColumn, getLabelClass, isColumnFieldDirty, formGridClass } = useModifyTableForm();

        return () => {
            const selCol = selectedColumn.value;

            if (!selCol) {
                return null;
            }

            return (
                <div>
                    <div class={formGridClass}>
                        <div class={getLabelClass(isColumnFieldDirty('name'))}>Name</div>
                        <Input {...vModel(selCol, 'name')} data-testid="modify-column-name" small={true} disabled={selCol.status === 'deleted'} />
                        <div class={getLabelClass(isColumnFieldDirty('comment'))}>Comment</div>
                        <Input {...vModel(selCol, 'comment')} small={true} disabled={selCol.status === 'deleted' || !modifyTable.canEditComment} />
                        <div class={getLabelClass(isColumnFieldDirty('type'))}>Data Type</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            data-testid="modify-column-type"
                            selection={selCol.type}
                            onSelect={(value, query) => (selCol.type = value?.value ?? query)}
                            items={getDbColumnDataTypeOptions(modifyTable.driver, selCol?.type)}
                            disabled={selCol.status === 'deleted'}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('notNull') || isColumnFieldDirty('isAutoIncrement'))} />
                        <div class="flex flex-wrap items-center gap-4">
                            <Checkbox label="Not Null" {...vModel(selCol, 'notNull')} disabled={selCol.status === 'deleted'} small={true} />
                            <Checkbox
                                label="Auto Increment"
                                {...vModel(selCol, 'isAutoIncrement')}
                                disabled={selCol.status === 'deleted' || !modifyTable.canEditAutoIncrement}
                                small={true}
                            />
                            <Input {...vModel(selCol, 'primaryKeyOrdinal')} disabled={true} smaller={true} class="w-12" />
                        </div>
                        <div class={getLabelClass(isColumnFieldDirty('columnKind'))}>Column Kind</div>
                        <Select
                            {...vModel(selCol, 'columnKind')}
                            options={[
                                { label: 'NORMAL', value: 'NORMAL' },
                                { label: 'GENERATED_VIRTUAL', value: 'GENERATED_VIRTUAL' },
                                { label: 'GENERATED_STORED', value: 'GENERATED_STORED' },
                            ]}
                            disabled={selCol.status === 'deleted'}
                            small={true}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('defaultValue'))}>Default Expression</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            selection={selCol.defaultValue}
                            onSelect={(value, query) => (selCol!.defaultValue = value?.value ?? query)}
                            items={getDbDefaultExpressionOptions(modifyTable.driver, selCol?.defaultValue)}
                            disabled={selCol.status === 'deleted'}
                        />
                        <div class={getLabelClass(isColumnFieldDirty('hidden'))} />
                        <Checkbox label="Hidden" {...vModel(selCol, 'hidden')} disabled={selCol.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isColumnFieldDirty('onUpdate'))}>On Update</div>
                        <Input {...vModel(selCol, 'onUpdate')} disabled={selCol.status === 'deleted' || !modifyTable.canEditOnUpdate} small={true} />
                        <div class={getLabelClass(isColumnFieldDirty('collation'))}>Collation</div>
                        <ListBox
                            small={true}
                            freeEdit={true}
                            selection={selCol.collation}
                            onSelect={(value, query) => (selCol!.collation = value?.value ?? query)}
                            items={getDbCollationOptions(modifyTable.collationOptionValues, selCol?.collation)}
                            disabled={selCol.status === 'deleted'}
                        />
                    </div>
                </div>
            );
        };
    },
    { name: 'ModifyTableColumnForm', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableColumnForm;
