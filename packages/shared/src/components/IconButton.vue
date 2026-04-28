<script setup lang="ts">
import { computed } from 'vue';
import Button, { type TButtonSeverity } from '@ui/Button.vue';
import Icon from '@ui/Icon.vue';

const props = withDefaults(
    defineProps<{
        severity?: TButtonSeverity;
        icon: `icon-\[${string}`;
        smaller?: boolean;
        disabled?: boolean;
    }>(),
    {
        severity: 'light',
    }
);
const finalClass = computed(() => (props.smaller ? 'p-0.5 text-2xs' : 'p-1 text-sm'));
</script>

<template>
    <Button :severity="props.severity" :disabled="props.disabled" :class="finalClass">
        <Icon :icon="props.icon" />
    </Button>
</template>
