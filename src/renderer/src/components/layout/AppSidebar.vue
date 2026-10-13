<script setup lang="ts">
import { RouterLink } from 'vue-router';

const navigation = [
  { label: 'Overview', to: '/', icon: '◫' },
  { label: 'Checkout', to: '/checkout', icon: '▣' },
  { label: 'Sales history', to: '/sales', icon: '▧' },
  { label: 'Inventory', to: '/inventory', icon: '▤' },
  { label: 'Purchasing', to: '/purchasing', icon: '⇄' },
  { label: 'Reports', to: '/reports', icon: '▥' },
  { label: 'Settings', to: '/settings', icon: '⚙' },
];
</script>

<template>
  <aside class="sidebar">
    <RouterLink class="brand-lockup" to="/" aria-label="NOUVO POS home">
      <span class="brand-mark">N</span>
      <span class="brand-copy"><strong>NOUVO</strong><small>POS · CASH &amp; CARRY</small></span>
    </RouterLink>
    <div class="sidebar-section-label">WORKSPACE</div>
    <nav class="sidebar-nav" aria-label="Main navigation">
      <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" class="nav-link">
        <span class="nav-link__icon" aria-hidden="true">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
        <span v-if="item.to === '/checkout'" class="nav-link__shortcut">F2</span>
      </RouterLink>
    </nav>
    <div class="sidebar-bottom">
      <div class="connection-card">
        <span class="connection-dot"></span>
        <div><strong>Offline-first mode</strong><small>Local setup foundation</small></div>
      </div>
      <p class="sidebar-footnote">Built for busy retail counters.</p>
    </div>
  </aside>
</template>
