<script setup lang="ts">
import { toast } from '@utils/useToast';
import Alert from '@ui/Alert.vue';
import IconButton from '@ui/IconButton.vue';
</script>

<template>
    <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-2 opacity-0"
    >
        <Alert v-if="toast.message" :severity="toast.severity" class="pointer-events-auto fixed right-4 top-4 z-50 max-w-sm w-auto">
            <div class="flex items-start gap-2">
                <span v-if="toast.severity === 'success'" class="icon icon-[mdi--check-circle] text-2xl text-green-500 shrink-0"></span>
                <span v-else-if="toast.severity === 'danger'" class="icon icon-[mdi--close-circle] text-2xl text-red-500 shrink-0"></span>
                <span v-else-if="toast.severity === 'warning'" class="icon icon-[mdi--alert-circle] text-2xl text-yellow-500 shrink-0"></span>
                <p class="flex-1">{{ toast.message }}</p>
                <IconButton severity="raised" v-tooltip.xs.nowrap="'Dismiss notification'" @click="toast.dismissToast()" icon="icon-[mdi--close] text-xl text-green-700" />
            </div>
        </Alert>
    </Transition>
</template>
