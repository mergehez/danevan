import { computed, reactive } from 'vue';
import type { GridCustomFormatter, GridFormatterState } from '../../shared/types';
import FormatterWorker from '../lib/gridFormatter.worker.ts?worker';
import { confirmAction } from '../lib/utils';
import { appClientRpc } from '../appClient';

type FormatterContext = {
    connectionId: number;
    tableName: string;
};

function normalizeTableName(tableName: string | undefined) {
    return tableName?.trim() || undefined;
}

function sameContext(left: FormatterContext | undefined, right: FormatterContext | undefined) {
    return left?.connectionId === right?.connectionId && left?.tableName === right?.tableName;
}

type FormatterRequestRecord = {
    cacheKey: string;
    fallbackValue: string;
    timeoutId: ReturnType<typeof setTimeout>;
};

/** A request that waits for the worker to announce that its script has run. */
type QueuedFormatterRequest = {
    requestId: number;
    cacheKey: string;
    fallbackValue: string;
    template: string;
};

type FormatterWorkerMessage = {
    ready?: boolean;
    requestId?: number;
    ok?: boolean;
    text?: string;
};

export function _useGridFormatters() {
    const defaultTemplate = 'function format(value) {\n    return value;\n}';
    const formatterResultCache = new Map<string, string>();
    const pendingFormatterKeys = new Set<string>();
    const pendingFormatterRequests = new Map<number, FormatterRequestRecord>();
    const formatterErrorKeys = new Set<string>();
    const formatterRequestTimeoutMs = 50;
    const formatterResultMaxLength = 8_192;
    let formatterWorker: Worker | undefined;
    let formatterWorkerReady = false;
    let queuedFormatterRequests: QueuedFormatterRequest[] = [];
    let nextRequestId = 0;
    /** Incremented per context load; a slow response must not describe another table. */
    let contextLoadSequence = 0;

    function clearFormatterCaches() {
        formatterResultCache.clear();
        pendingFormatterKeys.clear();
        queuedFormatterRequests = [];
        pendingFormatterRequests.forEach((request) => clearTimeout(request.timeoutId));
        pendingFormatterRequests.clear();
        formatterErrorKeys.clear();
    }

    function buildFormatterCacheKey(formatter: GridCustomFormatter, value: string) {
        return `${formatter.id}:${formatter.updatedAt}:${value}`;
    }

    function clampFormatterOutput(value: string, fallbackValue: string) {
        const nextValue = value.slice(0, formatterResultMaxLength);
        return nextValue.length ? nextValue : fallbackValue;
    }

    function bumpRenderVersion(state: { renderVersion: number }) {
        state.renderVersion += 1;
    }

    function disposeFormatterWorker(state: { renderVersion: number }) {
        formatterWorker?.terminate();
        formatterWorker = undefined;
        formatterWorkerReady = false;
        queuedFormatterRequests = [];
        pendingFormatterRequests.forEach((request) => {
            clearTimeout(request.timeoutId);
            formatterResultCache.set(request.cacheKey, request.fallbackValue);
        });
        pendingFormatterRequests.clear();
        pendingFormatterKeys.clear();
        bumpRenderVersion(state);
    }

    /** Starts the safety clock and sends one request to the worker that is listening. */
    function sendFormatterRequest(state: { renderVersion: number }, request: QueuedFormatterRequest) {
        const worker = formatterWorker;

        if (!worker) {
            return;
        }

        const timeoutId = setTimeout(() => {
            const pending = pendingFormatterRequests.get(request.requestId);

            if (!pending) {
                return;
            }

            formatterErrorKeys.add(pending.cacheKey);
            formatterResultCache.set(pending.cacheKey, pending.fallbackValue);
            disposeFormatterWorker(state);
        }, formatterRequestTimeoutMs);

        pendingFormatterRequests.set(request.requestId, {
            cacheKey: request.cacheKey,
            fallbackValue: request.fallbackValue,
            timeoutId,
        });
        worker.postMessage({ requestId: request.requestId, template: request.template, value: request.fallbackValue });
    }

    function flushQueuedFormatterRequests(state: { renderVersion: number }) {
        const queued = queuedFormatterRequests;
        queuedFormatterRequests = [];

        for (const request of queued) {
            sendFormatterRequest(state, request);
        }
    }

    function ensureFormatterWorker(state: { renderVersion: number }) {
        if (formatterWorker) {
            return formatterWorker;
        }

        formatterWorkerReady = false;
        formatterWorker = new FormatterWorker();
        formatterWorker.addEventListener('message', (event: MessageEvent<FormatterWorkerMessage>) => {
            // The worker announces itself once its script has run; a request sent before that is
            // dropped by the browser instead of queued, so the held requests are sent here.
            if (event.data?.ready) {
                formatterWorkerReady = true;
                flushQueuedFormatterRequests(state);
                return;
            }

            const request = pendingFormatterRequests.get(event.data.requestId ?? -1);

            if (!request) {
                return;
            }

            clearTimeout(request.timeoutId);
            pendingFormatterRequests.delete(event.data.requestId ?? -1);
            pendingFormatterKeys.delete(request.cacheKey);

            if (event.data.ok && typeof event.data.text === 'string') {
                formatterResultCache.set(request.cacheKey, clampFormatterOutput(event.data.text, request.fallbackValue));
            } else {
                formatterErrorKeys.add(request.cacheKey);
                formatterResultCache.set(request.cacheKey, request.fallbackValue);
            }

            bumpRenderVersion(state);
        });

        return formatterWorker;
    }

    return reactive({
        customFormatters: [] as GridCustomFormatter[],
        columnFormatterIds: {} as Record<string, string | undefined>,
        defaultTemplate: computed(() => defaultTemplate),
        isModalOpen: false,
        renderVersion: 0,
        formatterDraft: {
            id: '',
            name: '',
            template: defaultTemplate,
            // templateType: 'javascript' as 'handlebars' | 'javascript',
        } satisfies Omit<GridCustomFormatter, 'createdAt' | 'updatedAt'>,
        currentContext: undefined as FormatterContext | undefined,
        get modalTitle() {
            return 'Custom Formatters';
        },
        resetDraft() {
            this.formatterDraft.id = '';
            this.formatterDraft.name = '';
            this.formatterDraft.template = defaultTemplate;
            // this.formatterDraft.templateType = 'javascript';
        },
        async loadFormatters() {
            this.customFormatters = await appClientRpc.request.getGridCustomFormatters();
            clearFormatterCaches();
            bumpRenderVersion(this);
        },
        async loadContext(connectionId: number | undefined, tableName: string | undefined) {
            const loadId = ++contextLoadSequence;
            const normalizedTableName = normalizeTableName(tableName);

            if (!connectionId || !normalizedTableName) {
                this.currentContext = undefined;
                this.columnFormatterIds = {};
                await this.loadFormatters();
                return;
            }

            const state = await appClientRpc.request.getGridFormatterState({
                connectionId,
                tableName: normalizedTableName,
            });

            // Another table was activated while this answered: its load owns the context.
            if (loadId !== contextLoadSequence) {
                return;
            }

            this.currentContext = {
                connectionId,
                tableName: normalizedTableName,
            } satisfies FormatterContext;
            this.customFormatters = state.formatters;
            this.columnFormatterIds = state.columnFormatterIds;
            clearFormatterCaches();
            bumpRenderVersion(this);
        },
        getColumnFormatter(columnName: string) {
            const formatterId = this.columnFormatterIds[columnName];
            return formatterId ? this.customFormatters.find((formatter) => formatter.id === formatterId) : undefined;
        },
        async reloadContextState(nextState?: GridFormatterState, context?: FormatterContext) {
            if (nextState) {
                this.customFormatters = nextState.formatters;
                this.columnFormatterIds = nextState.columnFormatterIds;

                if (context) {
                    this.currentContext = context;
                }

                clearFormatterCaches();
                bumpRenderVersion(this);
                return;
            }

            if (!this.currentContext) {
                this.columnFormatterIds = {};
                await this.loadFormatters();
                return;
            }

            const state = await appClientRpc.request.getGridFormatterState(this.currentContext);
            this.customFormatters = state.formatters;
            this.columnFormatterIds = state.columnFormatterIds;
            clearFormatterCaches();
            bumpRenderVersion(this);
        },
        async assignFormatter(params: { connectionId: number; tableName: string; columnName?: string; formatterId?: string }) {
            const tableName = normalizeTableName(params.tableName);
            const columnName = params.columnName?.trim();

            if (!tableName || !columnName) {
                return;
            }

            const context = {
                connectionId: params.connectionId,
                tableName,
            } satisfies FormatterContext;
            const state = await appClientRpc.request.setGridColumnFormatter({
                connectionId: params.connectionId,
                tableName,
                columnName,
                formatterId: params.formatterId,
            });

            this.columnFormatterIds = {
                ...this.columnFormatterIds,
                [columnName]: params.formatterId,
            };

            if (!params.formatterId) {
                delete this.columnFormatterIds[columnName];
            }

            clearFormatterCaches();
            bumpRenderVersion(this);

            if (sameContext(this.currentContext, context)) {
                await this.reloadContextState(state, context);
                return;
            }

            this.customFormatters = state.formatters;

            if (!sameContext(this.currentContext, context)) {
                this.currentContext = context;
                this.columnFormatterIds = state.columnFormatterIds;
                clearFormatterCaches();
                bumpRenderVersion(this);
            }
        },
        openManager() {
            this.resetDraft();
            this.isModalOpen = true;
            if (!this.customFormatters.length) {
                void this.loadFormatters();
            }
        },
        closeModal() {
            this.isModalOpen = false;
            this.resetDraft();
        },
        createNewDraft() {
            this.resetDraft();
        },
        startEditingFormatter(formatterId: string) {
            const formatter = this.customFormatters.find((entry) => entry.id === formatterId);

            if (!formatter) {
                return;
            }

            this.formatterDraft.id = formatter.id;
            this.formatterDraft.name = formatter.name;
            this.formatterDraft.template = formatter.template;
            // this.formatterDraft.templateType = formatter.templateType;
        },
        async saveFormatter() {
            this.customFormatters = await appClientRpc.request.saveGridCustomFormatter({
                formatter: {
                    id: this.formatterDraft.id || undefined,
                    name: this.formatterDraft.name,
                    template: this.formatterDraft.template,
                    // templateType: this.formatterDraft.templateType,
                },
            });
            this.resetDraft();
            clearFormatterCaches();
            bumpRenderVersion(this);
        },
        async deleteFormatter(formatterId: string) {
            const formatter = this.customFormatters.find((entry) => entry.id === formatterId);

            if (
                !(await confirmAction({
                    title: 'Delete formatter?',
                    message: formatter?.name ? `This will permanently delete ${formatter.name}.` : 'This will permanently delete the selected formatter.',
                    detail: 'Any assigned columns will fall back to their default display formatting.',
                    confirmLabel: 'Delete',
                }))
            ) {
                return;
            }

            this.customFormatters = await appClientRpc.request.deleteGridCustomFormatter({
                formatterId,
            });

            if (this.formatterDraft.id === formatterId) {
                this.resetDraft();
            }

            if (this.currentContext) {
                await this.reloadContextState();
                return;
            }

            clearFormatterCaches();
            bumpRenderVersion(this);
        },
        runTemplate(formatter: GridCustomFormatter, value: unknown) {
            const fallbackValue =
                typeof value === 'string'
                    ? value
                    : value == null
                      ? ''
                      : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
                        ? String(value)
                        : typeof value === 'object'
                          ? JSON.stringify(value)
                          : '';
            const cacheKey = buildFormatterCacheKey(formatter, fallbackValue);

            if (formatterResultCache.has(cacheKey)) {
                return formatterResultCache.get(cacheKey) ?? fallbackValue;
            }

            if (pendingFormatterKeys.has(cacheKey) || formatterErrorKeys.has(cacheKey)) {
                return fallbackValue;
            }

            const request: QueuedFormatterRequest = {
                requestId: ++nextRequestId,
                cacheKey,
                fallbackValue,
                template: formatter.template,
            };

            pendingFormatterKeys.add(cacheKey);

            if (formatterWorkerReady) {
                sendFormatterRequest(this, request);
            } else {
                // The worker cannot answer before its script ran, and a request sent into that window
                // is lost; it is sent (and timed) once the worker announces that it is listening.
                ensureFormatterWorker(this);
                queuedFormatterRequests.push(request);
            }

            return fallbackValue;
        },
    });
}

let gridFormattersSingleton: ReturnType<typeof _useGridFormatters> | undefined;

export type TGridFormatterState = ReturnType<typeof _useGridFormatters>;

export function useGridFormatters() {
    gridFormattersSingleton ??= _useGridFormatters();
    return gridFormattersSingleton;
}
