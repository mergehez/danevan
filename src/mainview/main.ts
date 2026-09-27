import { createApp } from 'vue';
import { installAppDirectives } from '../directives/appDirectives';
import '../directives/directive-styles.css';
import App from './App.tsx';
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

    installAppDirectives(app);

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
