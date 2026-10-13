<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
  { number: '01', title: 'Checkout', detail: 'Barcode-first sales flow', tone: 'lavender' },
  { number: '02', title: 'Inventory', detail: 'Products, pricing and stock ledger', tone: 'mint' },
  {
    number: '03',
    title: 'Business branding',
    detail: 'Store identity and thermal receipts',
    tone: 'peach',
  },
  {
    number: '04',
    title: 'Sync & operations',
    detail: 'Offline queue, backup and recovery',
    tone: 'blue',
  },
];
</script>

<template>
  <div class="dashboard-view">
    <PageHeader
      eyebrow="STORE OVERVIEW"
      title="Good to see you."
      description="Your retail workspace is being prepared. Core modules will be added and verified in milestones."
    />
    <section class="welcome-panel">
      <div class="welcome-copy">
        <span class="welcome-kicker">NOUVO POS · CASH &amp; CARRY</span>
        <h2>A calmer, faster way to run your counter.</h2>
        <p>
          Built around dependable offline checkout, clear stock control and a consistent experience
          across your store.
        </p>
        <div class="welcome-tags">
          <span>Offline-first</span><span>Secure by design</span><span>Modular architecture</span>
        </div>
      </div>
      <div class="welcome-illustration" aria-hidden="true">
        <div class="orbit orbit--one"></div>
        <div class="orbit orbit--two"></div>
        <div class="illustration-card">
          <span class="illustration-card__top">TODAY'S WORKSPACE</span
          ><span class="illustration-card__line"></span
          ><span class="illustration-card__line illustration-card__line--short"></span
          ><span class="illustration-card__amount">Ready to build</span
          ><span class="illustration-card__pill">FOUNDATION</span>
        </div>
        <span class="floating-spark spark--one">✦</span
        ><span class="floating-spark spark--two">✧</span>
      </div>
    </section>
    <div class="section-heading">
      <div>
        <h2>Core modules</h2>
        <p>Independent modules, connected through typed services.</p>
      </div>
      <span class="section-count">04 AREAS</span>
    </div>
    <section class="module-grid">
      <BaseCard v-for="item in modules" :key="item.number" :interactive="true">
        <div class="module-card__top">
          <span class="module-number">{{ item.number }}</span
          ><span class="module-indicator" :class="`tone--${item.tone}`"></span>
        </div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.detail }}</p>
        <div class="module-card__footer">
          <span>Planned milestone</span><span aria-hidden="true">↗</span>
        </div>
      </BaseCard>
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
      <span class="foundation-pill">{{ infoError ? 'CHECK REQUIRED' : 'PHASE 1' }}</span>
    </div>
  </div>
</template>
