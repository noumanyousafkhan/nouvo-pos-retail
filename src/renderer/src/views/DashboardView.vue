<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { AppInfo } from '@shared/contracts/app';

const appInfo = ref<AppInfo | null>(null);
const infoError = ref('');

onMounted(async () => {
  try {
    appInfo.value = await window.nouvo.getAppInfo();
  } catch {
    infoError.value = 'Desktop bridge unavailable. Restart the app and check its logs.';
  }
});

const modules = [
  {
    number: '01',
    title: 'Checkout',
    detail: 'Scan items, take payment and print receipts',
    tone: 'lavender',
    to: '/checkout',
  },
  {
    number: '02',
    title: 'Inventory',
    detail: 'Manage products, prices, barcodes and stock',
    tone: 'mint',
    to: '/inventory',
  },
  {
    number: '03',
    title: 'Business branding',
    detail: 'Store identity, tax and receipt settings',
    tone: 'peach',
    to: '/settings',
  },
  {
    number: '04',
    title: 'Sync & operations',
    detail: 'Sales history, reports and counter operations',
    tone: 'blue',
    to: '/reports',
  },
];
</script>

<template>
  <div class="dashboard-view">
    <PageHeader
      eyebrow="STORE OVERVIEW"
      title="Good to see you."
      description="Your daily sales, product catalogue and stock controls in one offline-first workspace."
    />
    <section class="welcome-panel">
      <div class="welcome-copy">
        <span class="welcome-kicker">NOUVO POS · CASH &amp; CARRY</span>
        <h2>Everything your counter needs, in one place.</h2>
        <p>
          Run barcode-first checkout, manage inventory, review sales and protect your data with
          verified local backups.
        </p>
        <div class="welcome-tags">
          <span>Offline-first checkout</span><span>Stock-aware sales</span
          ><span>Verified backups</span>
        </div>
      </div>
      <div class="welcome-illustration" aria-hidden="true">
        <div class="orbit orbit--one"></div>
        <div class="orbit orbit--two"></div>
        <div class="illustration-card">
          <span class="illustration-card__top">TODAY'S WORKSPACE</span
          ><span class="illustration-card__line"></span
          ><span class="illustration-card__line illustration-card__line--short"></span
          ><span class="illustration-card__amount">Counter ready</span
          ><span class="illustration-card__pill">NOUVO POS</span>
        </div>
        <span class="floating-spark spark--one">✦</span
        ><span class="floating-spark spark--two">✧</span>
      </div>
    </section>
    <div class="section-heading">
      <div>
        <h2>Core modules</h2>
        <p>Open a workspace to complete everyday store operations.</p>
      </div>
      <span class="section-count">04 WORKSPACES</span>
    </div>
    <section class="module-grid">
      <RouterLink
        v-for="item in modules"
        :key="item.number"
        class="dashboard-module-link"
        :to="item.to"
      >
        <BaseCard :interactive="true">
          <div class="module-card__top">
            <span class="module-number">{{ item.number }}</span
            ><span class="module-indicator" :class="`tone--${item.tone}`"></span>
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.detail }}</p>
          <div class="module-card__footer">
            <span>Open workspace</span><span aria-hidden="true">↗</span>
          </div>
        </BaseCard>
      </RouterLink>
    </section>
    <div class="runtime-note" role="status">
      <span class="runtime-note__icon">i</span>
      <div>
        <strong>{{ appInfo ? appInfo.name : 'Desktop application status' }}</strong>
        <p v-if="appInfo">
          Version {{ appInfo.version }} · {{ appInfo.platform }} ·
          {{ appInfo.isPackaged ? 'Packaged build' : 'Development build' }}
        </p>
        <p v-else-if="infoError">{{ infoError }}</p>
        <p v-else>Checking the secure desktop bridge…</p>
      </div>
      <span class="foundation-pill">{{ infoError ? 'CHECK REQUIRED' : 'DESKTOP READY' }}</span>
    </div>
  </div>
</template>
