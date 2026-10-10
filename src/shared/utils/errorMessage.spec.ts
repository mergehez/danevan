import { describe, expect, it } from 'vitest';
import { readApiErrorMessage, toDisplayErrorMessage } from './errorMessage';

describe('readApiErrorMessage', () => {
    it('reports the message of the API envelope, not the JSON around it', () => {
        expect(readApiErrorMessage(500, '{"error":"The connection \\"main\\" is read-only, so the write was refused."}')).toBe(
            'The connection "main" is read-only, so the write was refused.'
        );
    });

    it('keeps a body that is not the envelope, with the status that carried it', () => {
        expect(readApiErrorMessage(502, '<html>Bad gateway</html>')).toBe('Backend error (502): <html>Bad gateway</html>');
    });

    it('falls back to the status when the envelope has no message', () => {
        expect(readApiErrorMessage(500, '{"error": "  "}')).toBe('Backend error (500): {"error": "  "}');
    });
});

describe('toDisplayErrorMessage', () => {
    it('peels the ipcRenderer wrapper off a rejected handler', () => {
        expect(toDisplayErrorMessage(new Error("Error invoking remote method 'applyTableChanges': Error: The table has no primary key."))).toBe('The table has no primary key.');
    });

    it('peels a wrapper that another wrapped handler left inside', () => {
        expect(toDisplayErrorMessage(new Error("Error invoking remote method 'runQuery': Error: Error invoking remote method 'formatSql': Error: Formatting is disabled."))).toBe(
            'Formatting is disabled.'
        );
    });

    it('leaves a driver failure alone', () => {
        expect(toDisplayErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:1'))).toBe('connect ECONNREFUSED 127.0.0.1:1');
    });

    it('reads a thrown value that is not an Error', () => {
        expect(toDisplayErrorMessage('the backend never answered')).toBe('the backend never answered');
    });
});
