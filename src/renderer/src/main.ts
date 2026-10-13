import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';
import './styles/cash-sessions.css';
import './styles/accounting.css';

createApp(App).use(createPinia()).use(router).mount('#app');
