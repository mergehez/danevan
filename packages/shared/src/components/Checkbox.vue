<script setup lang="ts">
import { uniqueId } from '@utils/utils';
import { computed, ref } from 'vue';

const modelValue = defineModel<boolean>('modelValue', { required: true });
const focusTargetRef = ref<HTMLElement | null>(null);

const props = withDefaults(
    defineProps<{
        disabled?: boolean;
        small?: boolean;
        smaller?: boolean;
        class?: string;
        id?: string;
        label?: string;
    }>(),
    {
        id: uniqueId(),
    }
);

const sizeClass = computed(() => {
    if (props.smaller) {
        return 'h-3 w-3 rounded-xs';
    }
    if (props.small) {
        return 'h-4 w-4 rounded-sm';
    }
    return 'h-5 w-5 rounded';
});

const textSizeClass = computed(() => {
    if (props.smaller) {
        return 'text-[0.5rem]';
    }
    if (props.small) {
        return 'text-xs';
    }
    return 'text-sm';
});

const colorClasses = computed(() => {
    if (props.disabled) {
        return 'border-x4';
    }
    return modelValue.value ? 'bg-blue-500 border-blue-400' : 'border-x7';
});

function toggleValue() {
    if (props.disabled) {
        return;
    }

    modelValue.value = !modelValue.value;
}

function onContainerClick() {
    if (props.disabled) {
        return;
    }

    focusTargetRef.value?.focus();
    toggleValue();
}
</script>

<template>
    <label :class="['inline-flex items-center gap-1', props.disabled ? 'cursor-not-allowed' : 'cursor-pointer', props.class]" @click.prevent="onContainerClick">
        <span class="relative shrink-0" :class="sizeClass">
            <input
                :id="id"
                v-model="modelValue"
                type="checkbox"
                :disabled="props.disabled"
                tabindex="-1"
                :class="['pointer-events-none absolute inset-0 m-0 opacity-0', sizeClass]"
            />

            <span
                ref="focusTargetRef"
                role="checkbox"
                :aria-checked="modelValue"
                :aria-disabled="props.disabled || undefined"
                :tabindex="props.disabled ? -1 : 0"
                class="flex items-center justify-center overflow-hidden border text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-400/80 focus-visible:ring-offset-1 focus-visible:ring-offset-x1"
                :class="[sizeClass, colorClasses]"
                @keydown.space.prevent="toggleValue"
                @keydown.enter.prevent="toggleValue"
            >
                <i v-if="modelValue" class="icon icon-[mdi--check] aspect-square" :class="textSizeClass"></i>
            </span>
        </span>

        <span v-if="props.label" class="pointer-events-none" :class="textSizeClass">{{ props.label }}</span>
    </label>
</template>
