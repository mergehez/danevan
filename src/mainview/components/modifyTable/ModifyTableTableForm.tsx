import { vModel } from '#shared/utils/tsxHelpers.tsx';
import { IconButton } from '../../../shared/components/IconButton.tsx';
import { Input } from '../../../shared/components/Input.tsx';
import { ListBox } from '../../../shared/components/ListBox.tsx';
import { getDbCollationOptions } from '../../lib/collations';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';
import { useModifyTableForm } from './formHelpers';

type Props = {};

export const ModifyTableTableForm = component(
    (_: Props) => {
        const { modifyTable, selectedTable, getLabelClass, isTableFieldDirty, formGridClass } = useModifyTableForm();

        return () => {
            const selTable = selectedTable.value;

            if (!selTable) {
                return null;
            }

            return (
                <div class="space-y-3">
                    <div>
                        <div class={formGridClass}>
                            <div class={getLabelClass(isTableFieldDirty('name'))}>Name</div>
                            <Input {...vModel(selTable, 'name')} data-testid="modify-table-name" small={true} />
                            <div class={getLabelClass(isTableFieldDirty('comment'))}>Comment</div>
                            <Input {...vModel(selTable, 'comment')} small={true} />
                            <div class={getLabelClass(isTableFieldDirty('engine'))}>Engine</div>
                            <Input {...vModel(selTable, 'engine')} small={true} />
                            <div class={getLabelClass(isTableFieldDirty('collation'))}>Collation</div>
                            <ListBox
                                small={true}
                                freeEdit={true}
                                selection={selTable.collation}
                                onSelect={(value, query) => (selTable.collation = value?.value ?? query)}
                                items={getDbCollationOptions(modifyTable.collationOptionValues, selTable?.collation)}
                            />
                            <div class={getLabelClass(isTableFieldDirty('options'))}>Options</div>
                            <Input {...vModel(selTable, 'options')} small={true} />
                        </div>
                    </div>
                    <div class="border border-x4">
                        <div class={[formGridClass, 'border-b border-x4']}>
                            <div class="border-r border-x4 px-3 py-1.5 text-xs opacity-70">Grants</div>
                            <div class="flex items-center gap-px px-1.5 py-1">
                                <IconButton severity="raised" disabled={true} v-tooltip={{ value: 'Add grant', xs: true, nowrap: true }} icon="icon-[mdi--plus]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={{ value: 'Remove grant', xs: true, nowrap: true }} icon="icon-[mdi--minus]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={{ value: 'Move grant up', xs: true, nowrap: true }} icon="icon-[mdi--arrow-up]" />
                                <IconButton severity="raised" disabled={true} v-tooltip={{ value: 'Move grant down', xs: true, nowrap: true }} icon="icon-[mdi--arrow-down]" />
                            </div>
                        </div>
                        <div class="flex min-h-10 max-h-46 items-center justify-center bg-x2 text-sm opacity-60">Nothing to show</div>
                    </div>
                </div>
            );
        };
    },
    { name: 'ModifyTableTableForm', props: ensureAllTsxProps<Props>()([]) }
);

export default ModifyTableTableForm;
