import { computed, ref } from 'vue';

const suppressedButtonLoadingCount = ref(0);

export const isButtonLoadingIndicatorSilenced = computed(() => suppressedButtonLoadingCount.value > 0);
export const isButtonBusyStateSilenced = computed(() => suppressedButtonLoadingCount.value > 0);

export async function runWithButtonLoadingIndicatorSilenced<TResult>(task: () => Promise<TResult>) {
    suppressedButtonLoadingCount.value += 1;

    try {
        return await task();
    } finally {
        suppressedButtonLoadingCount.value = Math.max(0, suppressedButtonLoadingCount.value - 1);
    }
}

export const runWithButtonBusyStateSilenced = runWithButtonLoadingIndicatorSilenced;
