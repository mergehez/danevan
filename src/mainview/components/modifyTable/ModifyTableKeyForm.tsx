import { vModel } from '#shared/utils/tsxHelpers.tsx';
import { Checkbox } from '../../../shared/components/Checkbox.tsx';
import { IconButton } from '../../../shared/components/IconButton.tsx';
import { Input } from '../../../shared/components/Input.tsx';
import { Select } from '../../../shared/components/Select.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useModifyTableForm } from './formHelpers';

type Props = {};

export const ModifyTableKeyForm = component(
    (_: Props) => {
        const { modifyTable, selectedKey, selectedKeyColumn, getLabelClass, isKeyFieldDirty, isKeyColumnFieldDirty, listToolbarClass, listItemClass, formGridClass, subGridClass } =
            useModifyTableForm();

        return () => {
            const selKey = selectedKey.value;

            if (!selKey) {
                return null;
            }

            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isKeyFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selKey, 'name')} disabled={selKey.status === 'deleted'} small={true} />
                            <div class={getLabelClass(isKeyFieldDirty('isPrimary'))} />
                            <Checkbox {...vModel(selKey, 'isPrimary')} disabled={selKey.status === 'deleted'} label="Primary" small={true} />
                        </div>
                    </div>
                    <div>
                        <div class={listToolbarClass}>
                            <IconButton
                                severity="raised"
                                disabled={selKey.status === 'deleted'}
                                v-tooltip={{ value: 'Add key column', xs: true, nowrap: true }}
                                icon="icon-[mdi--plus]"
                                onClick={modifyTable.addSelectedKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={{ value: 'Remove key column', xs: true, nowrap: true }}
                                icon="icon-[mdi--minus]"
                                onClick={modifyTable.removeSelectedKeyColumn}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.columns.length < 2 || selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={{ value: 'Move key column up', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-up]"
                                onClick={modifyTable.moveSelectedKeyColumnUp}
                            />
                            <IconButton
                                severity="raised"
                                disabled={selKey.columns.length < 2 || selKey.status === 'deleted' || !selectedKeyColumn.value}
                                v-tooltip={{ value: 'Move key column down', xs: true, nowrap: true }}
                                icon="icon-[mdi--arrow-down]"
                                onClick={modifyTable.moveSelectedKeyColumnDown}
                            />
                        </div>
                        <div class={subGridClass}>
                            {selKey.columns.length ? (
                                <>
                                    <div class="border-r border-x4">
                                        <div class="max-h-56 overflow-y-auto">
                                            {selKey.columns.map((column) => (
                                                <button
                                                    type="button"
                                                    onClick={() => modifyTable.selectKeyColumn(column.id)}
                                                    class={[listItemClass, selectedKeyColumn.value?.id === column.id ? 'bg-x3' : 'hover:bg-x4']}
                                                    key={column.id}
                                                >
                                                    <span class="min-w-0 flex-1 truncate">{column.columnName || 'column'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {selectedKeyColumn.value ? (
                                        <div class={[formGridClass, 'px-1 py-2']}>
                                            <span class={getLabelClass(isKeyColumnFieldDirty(selectedKeyColumn.value))}>Column Name</span>
                                            <Select
                                                {...vModel(selectedKeyColumn.value, 'columnName')}
                                                data-testid="modify-key-column-name"
                                                options={modifyTable.activeColumnNames}
                                                disabled={selKey.status === 'deleted'}
                                                small={true}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div class="col-span-full text-xs opacity-60 p-3">No key column selected yet!</div>
                            )}
                        </div>
                    </div>
                </div>
            );
        };
    },
    { name: 'ModifyTableKeyForm', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableKeyForm;
