// A skipped spec means a precondition was downgraded instead of satisfied (`E2E_SKIP_MISSING_DB=1`
// turns a missing database into `test.skip`), so a green run would claim coverage it does not
// have. Fail the run and name the specs that did not execute.
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

class FailOnSkipReporter implements Reporter {
    private readonly skipped: string[] = [];

    onTestEnd(test: TestCase, result: TestResult) {
        if (result.status === 'skipped') {
            this.skipped.push(test.titlePath().join(' › '));
        }
    }

    onEnd(result: FullResult) {
        if (!this.skipped.length) {
            return;
        }

        console.error(
            [
                '',
                `${this.skipped.length} spec(s) were skipped, so this run does not prove the app works:`,
                ...this.skipped.map((title) => `  - ${title}`),
                '',
                'Give the run what the precondition asks for (src/mainview/tests/e2e/helpers.ts).',
                'E2E_SKIP_MISSING_DB=1 exists to debug a subset, it must not produce a green run.',
                '',
            ].join('\n')
        );

        result.status = 'failed';
        process.exitCode = 1;
    }
}

export default FailOnSkipReporter;
