import { createApp } from 'vue';
import '../directives/directive-styles.css';
import { vContextMenu } from '../directives/VContextMenu';
import { vError } from '../directives/VError';
import { vLoading } from '../directives/VLoading';
import { vTooltip } from '../directives/VTooltip';
import App from './App.vue';
import { initTasks } from './composables/useTasks';
import './css/app.css';
import './css/scrollbar.css';

const isDev2 = import.meta.env.VITE_DEV2 === 'true';
let mountedApp: ReturnType<typeof createApp> | undefined;

if (isDev2) {
    const { installDev2AppClientBridge: installDev2GitClientBridge } = await import('./appClientBrowser.ts');
    installDev2GitClientBridge();
}

void Promise.resolve().then(() => {
    mountedApp?.unmount();

    const app = createApp(App);

    app.directive('loading', vLoading);
    app.directive('tooltip', vTooltip);
    app.directive('menu', vContextMenu);
    app.directive('error', vError);

    initTasks();

    app.mount('#app');
    mountedApp = app;
});

if (import.meta.hot) {
    import.meta.hot.accept();
    import.meta.hot.dispose(() => {
        mountedApp?.unmount();
        mountedApp = undefined;
    });
}
