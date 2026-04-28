<script setup lang="ts">
import TreeCollection from '@components/TreeCollection.vue';
import TreeTableRow from '@components/TreeTableRow.vue';
import { useConnections } from '@composables/useConnections';
import { getTableTreeForCollection, TableCollectionTreeItem, useServerTree } from '@composables/useServerTree';
import { ServerRecord } from '@utils/appClient';
import { computed } from 'vue';

const props = defineProps<{
    server: ServerRecord;
    collection: TableCollectionTreeItem;
    parentId: string;
    skipTitle?: boolean;
}>();

const connections = useConnections();
const state = useServerTree();

const children = computed(() => getTableTreeForCollection(props.collection, connections, state).children);
</script>

<template>
    <TreeCollection :server="server" :parent-id="parentId" :collection="collection" :children="() => children" :skipTitle="skipTitle" #default="{ item: table, parentId }">
        <TreeTableRow :server="server" :table="table" :parent-id="parentId" />
    </TreeCollection>
</template>
