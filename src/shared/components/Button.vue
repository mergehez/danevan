<script setup lang="ts">
import { twMerge } from 'tailwind-merge';
import { computed } from 'vue';

export type TButtonSeverity = 'primary' | 'raised' | 'secondary' | 'light' | 'success' | 'info' | 'warning' | 'danger';

const props = defineProps<{
    severity?: TButtonSeverity;
    as?: any;
    small?: boolean;
    smaller?: boolean;
    disabled?: boolean;
    class?: string;
}>();

const severityClass = computed(() => {
    if (!props.severity) return '';
    return {
        primary: 'btn-primary',
        raised: 'btn-raised',
        secondary: 'btn-secondary',
        light: 'btn-light',
        success: 'btn-success',
        info: 'btn-info',
        warning: 'btn-warning',
        danger: 'btn-danger',
    }[props.severity];
});

const sizeClass = computed(() => {
    if (props.smaller) return 'btn-xs rounded-sm';
    if (props.small) return 'btn-sm rounded-sm';
    return '';
});

const disabledClass = computed(() => (props.disabled ? 'opacity-80 cursor-not-allowed' : ''));
</script>

<template>
    <component :is="props.as || 'button'" class="btn" :class="twMerge(severityClass, sizeClass, disabledClass, props.class)" :disabled="props.disabled">
        <slot></slot>
    </component>
</template>
