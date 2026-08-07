import type { AppClientRequestApi } from '../electron/main.ts';
import { createAppClientPpc } from '../electronUtils/mainviewHelpers.ts';

export const appClientRpc = createAppClientPpc<AppClientRequestApi>(window.electronAPI);
