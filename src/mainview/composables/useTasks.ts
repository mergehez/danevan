import { reactive, ref } from 'vue';
import type { AppRequestApi } from '../../electron/bridge.ts';
import { apiMethods } from '../../shared/utils/apiMethods';
import { quoteSqlIdentifier } from '../../shared/utils/sqlIdentifiers';
import { appClientRpc } from '../appClient.ts';
import { useSqlHistory } from './useSqlHistory';

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
    const history = useSqlHistory();

    function wrapRunQuery(task: ReturnType<typeof useAsyncTask2<AppRequestApi['runQuery']>>) {
        const originalRun = task.run;
        task.run = async (ps: Parameters<AppRequestApi['runQuery']>[0], identifier?: string) => {
            const startedAt = performance.now();
            try {
                const result = await originalRun(ps, identifier);
                history.record({
                    source: 'query',
                    sql: ps.sql,
                    connectionId: ps.connectionId,
                    status: 'success',
                    durationMs: Math.round(performance.now() - startedAt),
                });
                return result;
            } catch (error) {
                history.record({
                    source: 'query',
                    sql: ps.sql,
                    connectionId: ps.connectionId,
                    status: 'error',
                    errorMessage: error instanceof Error ? error.message : String(error),
                    durationMs: Math.round(performance.now() - startedAt),
                });
                throw error;
            }
        };
    }

    function wrapDropTable(task: ReturnType<typeof useAsyncTask2<AppRequestApi['dropTable']>>) {
        const originalRun = task.run;
        task.run = async (ps: Parameters<AppRequestApi['dropTable']>[0], identifier?: string) => {
            const startedAt = performance.now();
            const sql = `DROP TABLE ${quoteSqlIdentifier(ps.tableName, 'mysql')}`;
            try {
                const result = await originalRun(ps, identifier);
                history.record({
                    source: 'drop-table',
                    sql,
                    connectionId: ps.connectionId,
                    status: 'success',
                    durationMs: Math.round(performance.now() - startedAt),
                });
                return result;
            } catch (error) {
                history.record({
                    source: 'drop-table',
                    sql,
                    connectionId: ps.connectionId,
                    status: 'error',
                    errorMessage: error instanceof Error ? error.message : String(error),
                    durationMs: Math.round(performance.now() - startedAt),
                });
                throw error;
            }
        };
    }

    return apiMethods.reduce((acc, methodName) => {
        const task = useAsyncTask2(methodName, (api) => api[methodName as keyof AppRequestApi]);

        if (methodName === 'runQuery') {
            wrapRunQuery(task as unknown as ReturnType<typeof useAsyncTask2<AppRequestApi['runQuery']>>);
        } else if (methodName === 'dropTable') {
            wrapDropTable(task as unknown as ReturnType<typeof useAsyncTask2<AppRequestApi['dropTable']>>);
        }

        acc[methodName as keyof AppRequestApi] = task;
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
