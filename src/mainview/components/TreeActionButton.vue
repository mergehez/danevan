<script setup lang="ts" generic="TChild extends { id: string | number } = any">
import Button from '../../shared/components/Button.vue';
import Icon from '../../shared/components/Icon.vue';
import { FileTreeAction } from '../../shared/utils/useFileTree';

const props = defineProps<{
    action: FileTreeAction;
}>();
</script>

<template>
    <Button
        :severity="action.icon ? 'raised' : 'secondary'"
        :disabled="action.disabled"
        class="text-2xs"
        :class="action.icon ? 'p-0.5' : 'px-1 py-0.5'"
        smaller
        @click.stop="action.onClick"
        v-tooltip.xs.nowrap="action.icon ? action.title : undefined"
    >
        <Icon v-if="action.icon" :icon="action.icon" />
        <span v-else class="text-2xs">{{ action.title }}</span>
    </Button>
</template>
