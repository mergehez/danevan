import { initTasks } from '@composables/useTasks';
import '@directives/directive-styles.css';
import { vContextMenu } from '@directives/VContextMenu';
import { vError } from '@directives/VError';
import { vLoading } from '@directives/VLoading';
import { vTooltip } from '@directives/VTooltip';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/roboto-condensed/400.css';
import '@fontsource/roboto-condensed/500.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import { ensureAppClientBridge } from '@lib/installAppClientBridge';
import { createApp } from 'vue';
import App from './App.vue';
import './css/app.css';
import './css/scrollbar.css';

void ensureAppClientBridge().then(() => {
    const app = createApp(App);

    app.directive('loading', vLoading);
    app.directive('tooltip', vTooltip);
    app.directive('context-menu', vContextMenu);
    app.directive('menu', vContextMenu);
    app.directive('error', vError);

    initTasks();

    app.mount('#app');
});
