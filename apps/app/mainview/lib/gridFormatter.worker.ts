type FormatRequest = {
    requestId: number;
    template: string;
    value: string;
};

type FormatResponse =
    | {
          requestId: number;
          ok: true;
          text: string;
      }
    | {
          requestId: number;
          ok: false;
          error: string;
      };

const formatterCache = new Map<string, (value: string) => unknown>();

function compileFormatter(template: string) {
    const cached = formatterCache.get(template);

    if (cached) {
        return cached;
    }

    // oxlint-disable-next-line
    const loadFormatter = new Function(
        `"use strict";
        ${template}
        if (typeof format !== 'function') {
            throw new Error('Formatter template must define function format(value).');
        }
        return format;`
    ) as () => (value: string) => unknown;
    const formatter = loadFormatter();
    formatterCache.set(template, formatter);
    return formatter;
}

function normalizeResult(value: unknown) {
    if (value == null) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            // oxlint-disable-next-line
            return String(value);
        }
    }

    // oxlint-disable-next-line
    return String(value);
}

self.onmessage = (event: MessageEvent<FormatRequest>) => {
    const request = event.data;

    try {
        const formatter = compileFormatter(request.template);
        const nextValue = formatter(request.value);
        const response: FormatResponse = {
            requestId: request.requestId,
            ok: true,
            text: normalizeResult(nextValue),
        };
        self.postMessage(response);
    } catch (error) {
        const response: FormatResponse = {
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
