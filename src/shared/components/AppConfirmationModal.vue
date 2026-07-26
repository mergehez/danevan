<script setup lang="ts">
import Button from '@ui/Button.vue';
import CenteredModal from '@ui/CenteredModal.vue';
import { confirmation } from '@utils/useConfirmation';

function onOpenChange(isOpen: boolean) {
    if (!isOpen && confirmation.state.isOpen) {
        confirmation.cancel();
    }
}
</script>

<template>
    <CenteredModal :open="confirmation.state.isOpen" title="Confirmation required" content-class="max-w-xl" @update:open="onOpenChange">
        <div class="space-y-5 px-6 py-5">
            <div class="space-y-3">
                <div>
                    <p class="text-base font-semibold text-white">{{ confirmation.state.title }}</p>
                    <p class="mt-2 text-sm leading-6 text-white/75">
                        {{ confirmation.state.message }}
                    </p>
                </div>

                <p v-if="confirmation.state.detail" class="rounded-xl border border-white/10 bg-x0/60 px-4 py-3 text-sm leading-6 text-white/65">
                    {{ confirmation.state.detail }}
                </p>
            </div>

            <div class="flex items-center justify-end gap-3 border-t border-x3 pt-4">
                <Button severity="light" @click="confirmation.cancel()">{{ confirmation.state.cancelLabel }}</Button>
                <Button severity="warning" @click="confirmation.confirm()">{{ confirmation.state.confirmLabel }}</Button>
            </div>
        </div>
    </CenteredModal>
</template>
