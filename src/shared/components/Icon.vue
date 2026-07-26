<script setup lang="ts">
import { type ClassNameValue, twMerge } from 'tailwind-merge';

const props = defineProps<{
    icon: `icon-\[${string}` | undefined;
    loading?: boolean;
    as?: string;
    class?: ClassNameValue;
}>();
</script>

<template>
    <component :is="props.as || 'i'" :class="twMerge(icon || loading ? 'icon' : undefined, 'text-lg', loading ? 'icon-[mingcute--loading-fill] animate-spin' : icon, props.class)">
        <slot />
    </component>
</template>
