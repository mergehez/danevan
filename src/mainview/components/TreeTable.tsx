import { computed } from 'vue';
import type { ServerRecord } from '../../shared/types';
import { useConnections } from '../composables/useConnections';
import { getTableTreeForCollection, type TableCollectionTreeItem, useServerTree } from '../composables/useServerTree';
import { TreeCollection } from './TreeCollection.tsx';
import { TreeTableRow } from './TreeTableRow.tsx';
import { component, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props = {
    server: ServerRecord;
    collection: TableCollectionTreeItem;
    parentId: string;
    skipTitle?: boolean;
};

export const TreeTable = component(
    (props: Props) => {
        const connections = useConnections();
        const state = useServerTree();

        const children = computed(() => getTableTreeForCollection(props.collection, connections, state).children);

        return () => (
            <TreeCollection
                server={props.server}
                parentId={props.parentId}
                collection={props.collection}
                children={() => children.value}
                skipTitle={props.skipTitle}
                slots={{ default: ({ item: table }) => <TreeTableRow server={props.server} table={table} parentId={props.parentId} /> }}
            />
        );
    },
    { name: 'TreeTable', props: ensureAllTsxProps<Props>()(['server', 'collection', 'parentId', 'skipTitle']) }
);

export default TreeTable;
