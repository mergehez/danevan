<script setup lang="ts">
import { getFinalInputClass, getInputSizedClasses } from '@ui/useFormComponents';
import { uniqueId } from '@utils/utils';
import { computed } from 'vue';

const modelValue = defineModel<string | number | undefined | null>('modelValue', { required: true });
const props = defineProps<{
    options: { label: string; value: string | number }[] | string[];
    disabled?: boolean;
    placeholder?: string;
    class?: string;
    small?: boolean;
    smaller?: boolean;
}>();

const finalOptions = computed(() => {
    if (typeof props.options[0] === 'string') {
        return (props.options as string[]).map((o) => ({ label: o, value: o }));
    }
    return props.options as { label: string; value: string | number }[];
});

const id = uniqueId();
</script>

<template>
    <label class="relative" :for="id" :class="[getFinalInputClass(props), 'has-focus-within:border-blue-400']">
        <span class="absolute inset-0 flex items-center" :class="getInputSizedClasses(props)">{{ modelValue }}</span>
        <select v-model="modelValue" :disabled="props.disabled" class="opacity-0 w-full h-full" :id="id">
            <option v-if="props.placeholder !== undefined" value="" disabled>{{ props.placeholder }}</option>
            <option v-for="option in finalOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
    </label>
</template>
