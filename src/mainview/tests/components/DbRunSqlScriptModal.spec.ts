// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import type { RunSqlScriptDefaults, RunSqlScriptStatus } from '../../../shared/types';

const holders = vi.hoisted(() => ({
    defaults: undefined as RunSqlScriptDefaults | undefined,
    defaultsError: undefined as Error | undefined,
    statuses: [] as RunSqlScriptStatus[],
    started: [] as Array<Record<string, unknown>>,
    stopped: [] as Array<Record<string, unknown>>,
    polls: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../composables/useConnections', () => ({
    useConnections: () => ({ connections: [] }),
}));

vi.mock('../../composables/useTasks', () => ({
    tasks: {
        getRunSqlScriptDefaults: {
            run: vi.fn(async () => {
                if (holders.defaultsError) {
                    throw holders.defaultsError;
                }

                return holders.defaults;
            }),
        },
        startRunSqlScript: {
            run: vi.fn(async (ps: Record<string, unknown>) => {
                holders.started.push(ps);
                return { runId: 'run-1' };
            }),
        },
        getRunSqlScriptStatus: {
            // Exhausted statuses keep the run "running", so cancellation can be tested.
            run: vi.fn(async (ps: Record<string, unknown>) => {
                holders.polls.push(ps);
                return holders.statuses.shift() ?? scriptStatus();
            }),
        },
        stopRunSqlScript: {
            run: vi.fn(async (ps: Record<string, unknown>) => {
                holders.stopped.push(ps);
            }),
        },
    },
}));

import DbRunSqlScriptModal from '../../components/DbRunSqlScriptModal.tsx';

const iconButtonStub = defineComponent({
    name: 'IconButton',
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

function scriptStatus(overrides: Partial<RunSqlScriptStatus> = {}): RunSqlScriptStatus {
    return {
        runId: 'run-1',
        status: 'running',
        runnerKind: 'client',
        runnerLabel: 'mysql client (/usr/local/mysql/bin/mysql)',
        outputChunk: '',
        nextOffset: 0,
        durationMs: 5,
        ...overrides,
    };
}

function scriptDefaults(overrides: Partial<RunSqlScriptDefaults> = {}): RunSqlScriptDefaults {
    return {
        connectionId: 7,
        driver: 'mysql',
        database: 'tirsik3_test',
        dataSource: 'local-mysql',
        runner: 'client',
        executable: '/usr/local/mysql/bin/mysql',
        scriptName: 'seed.sql',
        scriptPath: '/tmp/seed.sql',
        scriptSize: 2048,
        ...overrides,
    };
}

function mountModal() {
    const onClose = vi.fn();
    const wrapper = mount(DbRunSqlScriptModal, {
        props: { open: true, connectionId: 7, scriptPath: '/tmp/seed.sql', onClose },
        attachTo: document.body,
        global: {
            stubs: { IconButton: iconButtonStub },
            directives: { tooltip: {} },
        },
    });

    return { wrapper, onClose };
}

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
    const button = wrapper.findAll('button').find((entry) => entry.text().trim() === label);

    if (!button) {
        throw new Error(`Expected a "${label}" button.`);
    }

    return button;
}

describe('DbRunSqlScriptModal', () => {
    beforeEach(() => {
        holders.defaults = scriptDefaults();
        holders.defaultsError = undefined;
        holders.statuses = [];
        holders.started = [];
        holders.stopped = [];
        holders.polls = [];
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('asks for confirmation with the script name, size and target database', async () => {
        const { wrapper } = mountModal();
        await flushPromises();

        expect(wrapper.text()).toContain('seed.sql');
        expect(wrapper.text()).toContain('2.0 KB');
        expect(wrapper.text()).toContain('tirsik3_test');
        expect(wrapper.text()).toContain('/usr/local/mysql/bin/mysql');

        // Nothing runs before the user confirms.
        expect(holders.started).toHaveLength(0);
        expect(findButton(wrapper, 'Run script')).toBeTruthy();

        wrapper.unmount();
    });

    it('streams the runner output and reports the finished run with a close button', async () => {
        holders.statuses = [
            scriptStatus({ outputChunk: '-- hello\n', nextOffset: 9 }),
            scriptStatus({
                status: 'succeeded',
                outputChunk: '1 row in set\n',
                nextOffset: 22,
                durationMs: 42,
                exitCode: 0,
                statementCount: 3,
                completedStatements: 3,
            }),
        ];

        const { wrapper, onClose } = mountModal();
        await flushPromises();

        await findButton(wrapper, 'Run script').trigger('click');
        await vi.waitFor(() => expect(wrapper.text()).toContain('Script finished successfully in 42 ms.'));

        expect(holders.started).toEqual([{ connectionId: 7, filePath: '/tmp/seed.sql', executable: '/usr/local/mysql/bin/mysql' }]);
        expect(wrapper.text()).toContain('-- hello');
        expect(wrapper.text()).toContain('1 row in set');

        await findButton(wrapper, 'Close').trigger('click');

        expect(onClose).toHaveBeenCalledTimes(1);
        // A finished run is not stopped again.
        expect(holders.stopped).toHaveLength(0);

        wrapper.unmount();
    });

    it('cancels a running script and forgets the run', async () => {
        const { wrapper, onClose } = mountModal();
        await flushPromises();

        await findButton(wrapper, 'Run script').trigger('click');
        await vi.waitFor(() => expect(wrapper.text()).toContain('Cancel run'));

        await findButton(wrapper, 'Cancel run').trigger('click');
        await flushPromises();

        expect(holders.stopped).toEqual([{ runId: 'run-1' }]);
        expect(wrapper.text()).toContain('The script run was cancelled.');
        expect(findButton(wrapper, 'Close')).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();

        wrapper.unmount();
    });

    it('shows a failure when the run cannot be prepared', async () => {
        holders.defaultsError = new Error('The SQL script file was not found at: /tmp/seed.sql');

        const { wrapper } = mountModal();
        await flushPromises();

        expect(wrapper.text()).toContain('The SQL script file was not found at: /tmp/seed.sql');
        expect(findButton(wrapper, 'Close')).toBeTruthy();

        wrapper.unmount();
    });
});
