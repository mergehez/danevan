import { reactive, ref } from 'vue';
import type { AppRequestApi } from '../../electron/bridge.ts';
import { apiMethods } from '../../shared/utils/apiMethods';
import { appClientRpc } from '../appClient.ts';

const runningOperations = reactive({} as Record<string, number | undefined>); // key => timestamp
const errors = reactive({} as Record<string, string | undefined>);

const longRunningOperations = ref<string[]>([]);
function updateLongRunningOperations() {
    longRunningOperations.value = Object.entries(runningOperations)
        .filter(([_, timestamp]) => {
            return timestamp !== undefined;
        })
        .map(([key]) => key);
}

export function useAsyncTask2<TMethod extends AppRequestApi[keyof AppRequestApi], TParams = Parameters<TMethod>[0], TResult = Awaited<ReturnType<TMethod>>>(
    methodName: string,
    getMethod: (api: typeof appClientRpc.request) => TMethod
) {
    const method = getMethod(appClientRpc.request);

    async function run(ps: TParams, identifier?: string): Promise<TResult> {
        const finalKey = identifier ? `${methodName}:${identifier}` : (methodName as string);
        try {
            runningOperations[finalKey] = Date.now();
            errors[methodName] = undefined;

            setTimeout(updateLongRunningOperations, 500);

            return await (method as any)(ps);
        } catch (error) {
            errors[methodName] = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            runningOperations[finalKey] = undefined;
            updateLongRunningOperations();
        }
    }

    return {
        run: run,
        isRunning: (identifier?: string) => {
            const finalKey = identifier ? `${methodName}:${identifier}` : methodName;
            return runningOperations[finalKey] !== undefined;
        },
        errorMessage: errors[methodName],
        clearError: () => (errors[methodName] = undefined),
    };
}

function getTasks() {
    return apiMethods.reduce((acc, methodName) => {
        acc[methodName as keyof AppRequestApi] = useAsyncTask2(methodName, (api) => api[methodName as keyof AppRequestApi]);
        return acc;
    }, {} as any) as {
        [K in keyof AppRequestApi]: ReturnType<typeof useAsyncTask2<AppRequestApi[K]>>;
    };
}
// function getTasks(): Record<string, ReturnType<typeof useAsyncTask2>> {
//     return apiMethods.reduce(
//         (acc, methodName) => {
//             acc[methodName] = useAsyncTask2(methodName, (api) => api[methodName as keyof Api]);
//             return acc;
//         },
//         {} as Record<string, ReturnType<typeof useAsyncTask2>>
//     );
// }

let _tasks = getTasks();

export function initTasks() {
    //   _tasks = getTasks();
    //   console.warn("initTasks called", Object.keys(_tasks).join(", "));
    //   Object.assign(tasks, _tasks);
}

export const tasks = reactive({
    ..._tasks,

    reportError(message: string, key = 'ui') {
        errors[key] = message;
    },
    clearReportedError(key = 'ui') {
        errors[key] = undefined;
    },

    get errorMessage(): string | undefined {
        return Object.values(errors).find((t) => !!t);
    },
    dismissError() {
        Object.values(_tasks).forEach((v) => v.clearError());
    },
    get isBusy() {
        return Object.values(runningOperations).some((t) => t !== undefined);
    },
    isOperationRunning(key: keyof AppRequestApi | `${keyof AppRequestApi}:${string}`) {
        return runningOperations[key] !== undefined;
    },
    isAnyOperationRunning() {
        return Object.values(runningOperations).some((t) => t !== undefined);
    },
    getRunningOperation() {
        return Object.keys(runningOperations).find((key) => runningOperations[key] !== undefined) || null;
    },
    isAnyLongRunningOperation() {
        return longRunningOperations.value.length > 0;
    },
    get getLongRunningOperation() {
        return longRunningOperations.value[0] || null;
    },
});
