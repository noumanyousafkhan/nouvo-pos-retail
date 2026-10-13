<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { AuthState } from '@shared/contracts/auth';

const router = useRouter();
const authState = ref<AuthState | null>(null);
const navigation = [
  { label: 'Overview', to: '/', icon: '◫', permission: 'dashboard.view' },
  { label: 'Checkout', to: '/checkout', icon: '▣', permission: 'checkout.use' },
  { label: 'Sales history', to: '/sales', icon: '▧', permission: 'sales.view' },
  { label: 'Cashier shifts', to: '/cash-sessions', icon: '₨', permission: 'cash_session.view' },
  { label: 'Inventory', to: '/inventory', icon: '▤', permission: 'inventory.view' },
  { label: 'Purchasing', to: '/purchasing', icon: '⇄', permission: 'purchasing.view' },
  { label: 'Reports', to: '/reports', icon: '▥', permission: 'reports.view' },
  { label: 'Accounting', to: '/accounting', icon: '∑', permission: 'accounting.view' },
  { label: 'Synchronization', to: '/sync', icon: '↻', permission: 'sync.view' },
  { label: 'Settings', to: '/settings', icon: '⚙', permission: 'settings.manage' },
];
const visibleNavigation = computed(() =>
  navigation.filter((item) => authState.value?.permissions.includes(item.permission)),
);
async function signOut() {
  await window.nouvo.logout();
  await router.replace('/login');
}
onMounted(async () => {
  authState.value = await window.nouvo.getAuthState();
});
</script>

<template>
  <aside class="sidebar">
    <RouterLink class="brand-lockup" to="/" aria-label="NOUVO POS home">
      <span class="brand-mark">N</span>
      <span class="brand-copy"><strong>NOUVO</strong><small>POS · CASH &amp; CARRY</small></span>
    </RouterLink>
    <div class="sidebar-section-label">WORKSPACE</div>
    <nav class="sidebar-nav" aria-label="Main navigation">
      <RouterLink v-for="item in visibleNavigation" :key="item.to" :to="item.to" class="nav-link">
        <span class="nav-link__icon" aria-hidden="true">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
        <span v-if="item.to === '/checkout'" class="nav-link__shortcut">F2</span>
      </RouterLink>
    </nav>
    <div class="sidebar-bottom">
      <div v-if="authState?.user" class="sidebar-user-card">
        <span class="sidebar-user-avatar">{{
          authState.user.displayName.slice(0, 1).toUpperCase()
        }}</span>
        <div class="sidebar-user-copy">
          <strong>{{ authState.user.displayName }}</strong
          ><small>{{ authState.user.role.replace('_', ' ') }}</small>
        </div>
        <button type="button" aria-label="Sign out" title="Sign out" @click="signOut">↪</button>
      </div>
      <div class="connection-card">
        <span class="connection-dot"></span>
        <div><strong>Offline-first mode</strong><small>Local database active</small></div>
      </div>
      <p class="sidebar-footnote">Built for busy retail counters.</p>
    </div>
  </aside>
</template>
