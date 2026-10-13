import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from '@/views/DashboardView.vue';
import FeaturePlaceholderView from '@/views/FeaturePlaceholderView.vue';
import InventoryView from '@/views/InventoryView.vue';
import CheckoutView from '@/views/CheckoutView.vue';
import SalesHistoryView from '@/views/SalesHistoryView.vue';
import SettingsView from '@/views/SettingsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: { title: 'Overview', description: 'Your store at a glance.' },
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
      },
    },
    {
      path: '/reports',
      name: 'reports',
      component: FeaturePlaceholderView,
      meta: {
        title: 'Reports',
        description: 'Sales, stock and financial reporting.',
        module: 'Reports',
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
      },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
