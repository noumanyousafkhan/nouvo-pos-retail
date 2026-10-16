<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { AppInfo } from '@shared/contracts/app';
import type { SalesReport } from '@shared/contracts/reports';
import type { BusinessSettings } from '@shared/contracts/settings';

const appInfo = ref<AppInfo | null>(null);
const infoError = ref('');
const reportError = ref('');
const todayReport = ref<SalesReport | null>(null);
const currencyCode = ref('PKR');
const salesLoading = ref(true);
const todayGrossProfitMinor = computed(
  () =>
    todayReport.value?.byCategory.reduce(
      (total, category) => total + category.grossMarginMinor,
      0,
    ) ?? 0,
);
const profitCostCoverageComplete = computed(() =>
  (todayReport.value?.byCategory ?? []).every((category) => category.costCoveragePercent === 100),
);
const todayProfitCaption = computed(() =>
  profitCostCoverageComplete.value
    ? 'Based on recorded product costs'
    : 'Some products are missing cost data',
);
const todayDate = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const money = (minor: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

onMounted(async () => {
  try {
    appInfo.value = await window.nouvo.getAppInfo();
  } catch {
    infoError.value = 'Desktop bridge unavailable. Restart the app and check its logs.';
  }
  try {
    // Sales must not disappear just because an unrelated settings request fails.
    todayReport.value = await window.nouvo.getSalesReport({
      fromDate: todayDate(),
      toDate: todayDate(),
    });
  } catch (error) {
    // Never disguise a failed report request as real zero sales/profit.
    reportError.value =
      error instanceof Error ? error.message : 'Sales report could not be loaded.';
  } finally {
    salesLoading.value = false;
  }
  try {
    const settings = (await window.nouvo.getBusinessSettings()) as BusinessSettings;
    currencyCode.value = settings.currencyCode;
  } catch {
    // Keep the default PKR display if only business settings fail to load.
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
    to: '/branding',
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
    <RouterLink class="today-sales-panel" to="/reports" aria-label="Open reports for today's sales">
      <div class="today-sales-copy">
        <span class="today-sales-label">TODAY'S SALES</span>
        <strong>{{
          salesLoading
            ? 'Loading…'
            : reportError
              ? 'Unavailable'
              : money(todayReport?.totalMinor ?? 0)
        }}</strong>
        <span class="today-sales-caption">{{
          reportError || 'Net sales after recorded refunds'
        }}</span>
      </div>
      <div class="today-profit-copy">
        <span class="today-sales-label">ESTIMATED GROSS PROFIT</span>
        <strong>{{
          salesLoading ? 'Loading…' : reportError ? 'Unavailable' : money(todayGrossProfitMinor)
        }}</strong>
        <span class="today-sales-caption">{{
          reportError || (salesLoading ? 'Calculating from item costs' : todayProfitCaption)
        }}</span>
      </div>
      <div class="today-sales-meta">
        <span class="today-sales-count">{{
          salesLoading ? '—' : reportError ? '—' : (todayReport?.saleCount ?? 0)
        }}</span>
        <span>completed sales today</span>
        <span class="today-sales-link">View sales report ↗</span>
      </div>
    </RouterLink>
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
