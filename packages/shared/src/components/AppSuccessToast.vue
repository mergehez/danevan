<script setup lang="ts">
import { useOverlaysState } from '@directives/useOverlaysState';
import Alert from '@ui/Alert.vue';
import IconButton from '@ui/IconButton.vue';
import { toast } from '@utils/useToast';
import { ref, watch } from 'vue';

const overlayState = useOverlaysState();
const toastZIndex = ref(90);

watch(
    () => toast.message,
    (message) => {
        toastZIndex.value = message ? overlayState.claimZIndex() : overlayState.releaseZIndex(toastZIndex.value);
    }
);
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
        <Alert v-if="toast.message" :severity="toast.severity" class="pointer-events-auto fixed right-4 top-4 max-w-sm w-auto" :style="{ zIndex: toastZIndex }">
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
