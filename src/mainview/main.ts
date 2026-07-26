import '@directives/directive-styles.css';
import { vContextMenu } from '@directives/VContextMenu';
import { vError } from '@directives/VError';
import { vLoading } from '@directives/VLoading';
import { vTooltip } from '@directives/VTooltip';
import { installRendererDiagnostics } from '@lib/installRendererDiagnostics';
import { createApp } from 'vue';
import './css/app.css';
import './css/scrollbar.css';
import App from './App.vue';
import { initTasks } from './composables/useTasks.ts';

installRendererDiagnostics();

const isDev2 = import.meta.env.VITE_DEV2 === 'true';

if (isDev2) {
    const { installDev2AppClientBridge } = await import('@lib/appClientDev2');
    installDev2AppClientBridge();
}

const app = createApp(App);

app.directive('loading', vLoading);
app.directive('tooltip', vTooltip);
app.directive('context-menu', vContextMenu);
app.directive('menu', vContextMenu);
app.directive('error', vError);

initTasks();

app.mount('#app');
