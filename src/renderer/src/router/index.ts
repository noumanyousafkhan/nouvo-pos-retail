import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from '@/views/DashboardView.vue';
import FeaturePlaceholderView from '@/views/FeaturePlaceholderView.vue';
import InventoryView from '@/views/InventoryView.vue';
import CheckoutView from '@/views/CheckoutView.vue';
import SalesHistoryView from '@/views/SalesHistoryView.vue';
import SettingsView from '@/views/SettingsView.vue';
import LoginView from '@/views/LoginView.vue';
import SetupView from '@/views/SetupView.vue';
import ForbiddenView from '@/views/ForbiddenView.vue';
import ReportsView from '@/views/ReportsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/setup',
      name: 'setup',
      component: SetupView,
      meta: { authPage: true, title: 'Set up owner account' },
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { authPage: true, title: 'Sign in' },
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: ForbiddenView,
      meta: { authPage: true, title: 'Access denied' },
    },
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: {
        title: 'Overview',
        description: 'Your store at a glance.',
        permission: 'dashboard.view',
      },
    },
    {
      path: '/checkout',
      name: 'checkout',
      component: CheckoutView,
      meta: {
        title: 'Checkout',
        description:
          'Barcode-first checkout with stock validation, split payments and durable sale receipts.',
        module: 'Checkout',
        permission: 'checkout.use',
      },
    },
    {
      path: '/sales',
      name: 'sales',
      component: SalesHistoryView,
      meta: {
        title: 'Sales history',
        description: 'Completed sales, receipt lookup and reprint.',
        module: 'Sales',
        permission: 'sales.view',
      },
    },
    {
      path: '/inventory',
      name: 'inventory',
      component: InventoryView,
      meta: {
        title: 'Inventory',
        description: 'Product catalogue, pricing history and stock controls.',
        module: 'Inventory',
        permission: 'inventory.view',
      },
    },
    {
      path: '/purchasing',
      name: 'purchasing',
      component: FeaturePlaceholderView,
      meta: {
        title: 'Purchasing',
        description: 'Suppliers, purchase orders and goods receiving.',
        module: 'Purchasing',
        permission: 'purchasing.view',
      },
    },
    {
      path: '/reports',
      name: 'reports',
      component: ReportsView,
      meta: {
        title: 'Reports',
        description: 'Sales, stock and financial reporting.',
        module: 'Reports',
        permission: 'reports.view',
      },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: {
        title: 'Settings',
        description: 'Store setup, business branding, users and operations.',
        module: 'Settings',
        permission: 'settings.manage',
      },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (to.path === '/setup') {
    const state = await window.nouvo.getAuthState();
    return state.needsSetup ? true : state.authenticated ? '/' : '/login';
  }
  if (to.path === '/login') {
    const state = await window.nouvo.getAuthState();
    return state.needsSetup ? '/setup' : state.authenticated ? '/' : true;
  }
  const state = await window.nouvo.getAuthState();
  if (state.needsSetup) return '/setup';
  if (!state.authenticated) return '/login';
  const permission = to.meta.permission;
  if (typeof permission === 'string' && !state.permissions.includes(permission))
    return '/forbidden';
  return true;
});
