import { vModel } from '#shared/utils/tsxHelpers.tsx';
import { Checkbox } from '../../../shared/components/Checkbox.tsx';
import { IconButton } from '../../../shared/components/IconButton.tsx';
import { Input } from '../../../shared/components/Input.tsx';
import { Select } from '../../../shared/components/Select.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useModifyTableForm } from './formHelpers';

type Props = {};

export const ModifyTableIndexForm = component(
    (_: Props) => {
        const {
            modifyTable,
            selectedIndex,
            selectedIndexColumn,
            getLabelClass,
            isIndexFieldDirty,
            isIndexColumnFieldDirty,
            indexOrderOptions,
            listToolbarClass,
            listItemClass,
            formGridClass,
            subGridClass,
        } = useModifyTableForm();

        return () => {
            const selIndex = selectedIndex.value;

            if (!selIndex) {
                return null;
            }

            return (
                <div class="space-y-3">
                    <div class={formGridClass}>
                        <div class={getLabelClass(isIndexFieldDirty('name'))}>Name</div>
                        <Input {...vModel(selIndex, 'name')} data-testid="modify-index-name" disabled={selIndex.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('comment'))}>Comment</div>
                        <Input {...vModel(selIndex, 'comment')} data-testid="modify-index-comment" disabled={selIndex.status === 'deleted'} small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('isUnique'))} />
                        <Checkbox {...vModel(selIndex, 'isUnique')} disabled={selIndex.status === 'deleted'} label="Unique" small={true} />
                        <div class={getLabelClass(isIndexFieldDirty('type'))}>Type</div>
                        <Input {...vModel(selIndex, 'type')} disabled={selIndex.status === 'deleted'} small={true} />
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selIndex.status === 'deleted'}
                                v-tooltip={{ value: 'Add index column', xs: true, nowrap: true }}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedIndexColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={{ value: 'Remove index column', xs: true, nowrap: true }}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedIndexColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.columns.length < 2 || selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={{ value: 'Move index column up', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedIndexColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selIndex.columns.length < 2 || selIndex.status === 'deleted' || !selectedIndexColumn.value}
                                v-tooltip={{ value: 'Move index column down', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedIndexColumnDown}
                            />
                        </div>
                        <div class={subGridClass}>
                            <div class="border-r border-x4">
                                <div class="max-h-56 overflow-y-auto">
                                    {selIndex.columns.map((column) => (
                                        <button
                                            type="button"
                                            onClick={() => modifyTable.selectIndexColumn(column.id)}
                                            class={[listItemClass, selectedIndexColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                            key={column.id}
                                        >
                                            <span class="min-w-0 flex-1 truncate">{column.columnName || 'column'}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div class={[formGridClass, 'px-1 py-2']}>
                                <span class={getLabelClass(!!selectedIndexColumn.value && isIndexColumnFieldDirty(selectedIndexColumn.value, 'columnName'))}>Column Name</span>
                                {selectedIndexColumn.value ? (
                                    <Select
                                        {...vModel(selectedIndexColumn.value, 'columnName')}
                                        data-testid="modify-index-column-name"
                                        options={modifyTable.activeColumnNames}
                                        disabled={selIndex.status === 'deleted'}
                                        small={true}
                                    />
                                ) : null}
                                <span class={getLabelClass(!!selectedIndexColumn.value && isIndexColumnFieldDirty(selectedIndexColumn.value, 'order'))}>Order</span>
                                {selectedIndexColumn.value ? (
                                    <Select
                                        {...vModel(selectedIndexColumn.value, 'order')}
                                        data-testid="modify-index-column-order"
                                        options={indexOrderOptions}
                                        disabled={selIndex.status === 'deleted'}
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
    { name: 'ModifyTableIndexForm', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableIndexForm;
