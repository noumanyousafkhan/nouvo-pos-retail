import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';
import './styles/cash-sessions.css';
import './styles/accounting.css';
import './styles/sync.css';

// Apply persisted branding before Vue mounts so every page uses the saved colors immediately.
const DEFAULT_BRAND_COLORS = { primary: '#635bda', secondary: '#16a085' };
try {
  const saved = JSON.parse(localStorage.getItem('nouvo-brand-colors') || '{}') as {
    primary?: string;
    secondary?: string;
  };
  const primary = /^#[0-9a-f]{6}$/i.test(saved.primary ?? '')
    ? saved.primary!
    : DEFAULT_BRAND_COLORS.primary;
  const secondary = /^#[0-9a-f]{6}$/i.test(saved.secondary ?? '')
    ? saved.secondary!
    : DEFAULT_BRAND_COLORS.secondary;
  document.documentElement.style.setProperty('--primary', primary);
  document.documentElement.style.setProperty('--primary-dark', primary);
  document.documentElement.style.setProperty('--secondary', secondary);
  document.documentElement.style.setProperty('--nav-active-bg', `${primary}18`);
} catch {
  document.documentElement.style.setProperty('--primary', DEFAULT_BRAND_COLORS.primary);
  document.documentElement.style.setProperty('--primary-dark', DEFAULT_BRAND_COLORS.primary);
  document.documentElement.style.setProperty('--secondary', DEFAULT_BRAND_COLORS.secondary);
  document.documentElement.style.setProperty(
    '--nav-active-bg',
    `${DEFAULT_BRAND_COLORS.primary}18`,
  );
}

createApp(App).use(createPinia()).use(router).mount('#app');
