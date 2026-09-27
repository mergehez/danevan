import type { ContextMenuEntry } from '../../directives/contextMenuTypes';
import type { ServerRecord } from '../../shared/types';
import type { FileTreeChild } from '../../shared/utils/useFileTree';
import { useServerTree } from '../composables/useServerTree';
import { FileTreeButton } from './FileTreeButton.tsx';
import { componentGeneric, ensureAllTsxProps } from '#shared/utils/tsxHelpers.tsx';

type Props<TCollection extends FileTreeChild = FileTreeChild, TChild extends { id: string | number } = any> = {
    server: ServerRecord;
    collection: TCollection;
    parentId: string;
    children: () => TChild[];
    skipTitle?: boolean;
    contextMenuItems?: (collection: TCollection) => ContextMenuEntry[];
} & {
    slots?: { rightPrefix?: (scope: { collection: any }) => unknown; default?: (scope: { item: any; parentId: any }) => unknown };
};

export const TreeCollection = componentGeneric(
    <TCollection extends FileTreeChild = FileTreeChild, TChild extends { id: string | number } = any>(props: Props<TCollection, TChild>) => {
        const state = useServerTree();

        return () => (
            <FileTreeButton
                item={props.collection}
                dataTestid="modify-collection"
                dataCollectionKind={(props.collection as { kind?: string }).kind}
                dataNodeId={state.getCollectionNodeId(props.server.id, props.collection.id)}
                dataParentId={props.parentId}
                dataSidebarSelfToggle="true"
                collapsed={state.isCollectionCollapsed(props.server.id, props.collection)}
                contextMenuItems={props.contextMenuItems}
                onClick={() => void state.toggleGroupCollapsed(props.server.id, props.collection.id, false)}
                children={props.children}
                skipTitle={props.skipTitle}
                slots={{
                    text: ({ text }) => <span class="opacity-50">{text}</span>,
                    rightPrefix: () => <>{props.slots?.rightPrefix?.({ collection: props.collection })}</>,
                    child: ({ item }) => <>{props.slots?.default?.({ item: item, parentId: props.parentId })}</>,
                }}
            />
        );
    },
    { name: 'TreeCollection', props: ensureAllTsxProps<Props<any, any>>()(['server', 'collection', 'parentId', 'children', 'skipTitle', 'contextMenuItems', 'slots']) }
);

export default TreeCollection;
