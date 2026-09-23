<script setup lang="ts" generic="T extends string | number">
import { getFinalInputClass } from './useFormComponents';

const modelValue = defineModel<T | undefined | null>('modelValue', { required: true });

const props = defineProps<{
    disabled?: boolean;
    placeholder?: string;
    class?: string;
    small?: boolean;
    smaller?: boolean;
    invalid?: boolean;
}>();
</script>

<template>
    <input v-model="modelValue" v-bind="$attrs" :class="getFinalInputClass(props)" :disabled="props.disabled" :placeholder="props.placeholder" />
</template>
