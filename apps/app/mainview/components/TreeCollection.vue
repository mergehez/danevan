<script setup lang="ts" generic="TCollection extends FileTreeChild = FileTreeChild, TChild extends { id: string | number } = any">
import FileTreeButton from '@components/FileTreeButton.vue';
import { useServerTree } from '@composables/useServerTree';
import type { ContextMenuEntry } from '@directives/contextMenuTypes';
import { FileTreeChild } from '@shared/utils/useFileTree';
import type { ServerRecord } from '@utils/appClient';

const state = useServerTree();

const props = defineProps<{
    server: ServerRecord;
    collection: TCollection;
    parentId: string;
    children: () => TChild[];
    skipTitle?: boolean;
    contextMenuItems?: (collection: TCollection) => ContextMenuEntry[];
}>();
</script>

<template>
    <FileTreeButton
        :item="collection"
        :data-node-id="state.getCollectionNodeId(server.id, collection.id)"
        :data-parent-id="parentId"
        data-sidebar-self-toggle="true"
        :collapsed="state.isCollectionCollapsed(server.id, collection)"
        :context-menu-items="props.contextMenuItems"
        :onClick="() => void state.toggleGroupCollapsed(server.id, collection.id, false)"
        :children="children"
        :skipTitle="skipTitle"
    >
        <template #text="{ text }">
            <span class="opacity-50">{{ text }}</span>
        </template>
        <template #right-prefix>
            <slot name="right-prefix" :collection="collection"></slot>
        </template>

        <template #child="{ item, parentId }">
            <slot name="default" :item="item" :parentId="parentId"> </slot>
        </template>
    </FileTreeButton>
</template>
