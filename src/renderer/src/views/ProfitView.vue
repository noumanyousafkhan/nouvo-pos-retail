<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { SalesReport } from '@shared/contracts/reports';
import type { BusinessSettings } from '@shared/contracts/settings';

type Period = 'daily' | 'weekly' | 'monthly' | 'all' | 'custom';
const loading = ref(false);
const errorMessage = ref('');
const report = ref<SalesReport | null>(null);
const currencyCode = ref('PKR');
const activePeriod = ref<Period>('daily');
const localDate = (date: Date) => {
  const copy = new Date(date);
  return new Date(copy.getTime() - copy.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const today = () => localDate(new Date());
const startOfWeek = (date: Date) => {
  const start = new Date(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const filters = reactive({ fromDate: today(), toDate: today() });
const categories = computed(() => report.value?.byCategory ?? []);
const salesMinor = computed(() =>
  categories.value.reduce((sum, row) => sum + row.netSalesMinor, 0),
);
const costMinor = computed(() => categories.value.reduce((sum, row) => sum + row.costMinor, 0));
const grossProfitMinor = computed(() =>
  categories.value.reduce((sum, row) => sum + row.grossMarginMinor, 0),
);
const marginPercent = computed(() =>
  salesMinor.value > 0 ? (grossProfitMinor.value / salesMinor.value) * 100 : 0,
);
const costCoverageComplete = computed(() =>
  categories.value.every((row) => row.costCoveragePercent === 100),
);
const money = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const periodLabel = computed(() =>
  activePeriod.value === 'all' ? 'All recorded sales' : `${filters.fromDate} — ${filters.toDate}`,
);

async function loadReport() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [result, settings] = await Promise.all([
      window.nouvo.getSalesReport({
        ...(filters.fromDate ? { fromDate: filters.fromDate } : {}),
        ...(filters.toDate ? { toDate: filters.toDate } : {}),
      }),
      window.nouvo.getBusinessSettings(),
    ]);
    report.value = result;
    currencyCode.value = (settings as BusinessSettings).currencyCode;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Profit report could not be loaded.';
  } finally {
    loading.value = false;
  }
}
function setPeriod(period: Period) {
  activePeriod.value = period;
  if (period === 'custom') return;
  if (period === 'all') {
    filters.fromDate = '';
    filters.toDate = '';
  } else {
    const end = new Date();
    const start =
      period === 'daily'
        ? new Date(end)
        : period === 'weekly'
          ? startOfWeek(end)
          : startOfMonth(end);
    filters.fromDate = localDate(start);
    filters.toDate = localDate(end);
  }
  void loadReport();
}
function applyCustom() {
  activePeriod.value = 'custom';
  void loadReport();
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}
onMounted(loadReport);
</script>

<template>
  <div class="reports-page profit-page">
    <PageHeader
      eyebrow="FINANCIAL PERFORMANCE"
      title="Profit & Loss"
      description="Track gross profit by day, week, month, all time, or a custom date range."
    />
    <BaseCard class="reports-filter-card">
      <form class="reports-filters" @submit.prevent="applyCustom">
        <div class="reports-period-presets" aria-label="Profit reporting period">
          <button
            v-for="item in [
              { key: 'daily', label: 'Daily' },
              { key: 'weekly', label: 'Weekly' },
              { key: 'monthly', label: 'Monthly' },
              { key: 'all', label: 'Overall / all time' },
              { key: 'custom', label: 'Custom dates' },
            ]"
            :key="item.key"
            type="button"
            :class="{ 'is-active': activePeriod === item.key }"
            @click="setPeriod(item.key as Period)"
          >
            {{ item.label }}
          </button>
        </div>
        <label class="inventory-field"
        >From date<input
          v-model="filters.fromDate"
          type="date"
          :max="filters.toDate || today()"
          :required="activePeriod !== 'all'"
        /></label>
        <label class="inventory-field"
        >To date<input
          v-model="filters.toDate"
          type="date"
          :min="filters.fromDate || undefined"
          :max="today()"
          :required="activePeriod !== 'all'"
        /></label>
        <button class="reports-apply-button" type="submit" :disabled="loading">
          {{ loading ? 'Loading…' : 'Apply dates' }}
        </button>
        <span class="reports-period">{{ periodLabel }}</span>
      </form>
    </BaseCard>
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-if="loading && !report" class="reports-empty">Loading profit report…</div>
    <template v-else-if="report">
      <section class="reports-kpi-grid profit-kpi-grid" aria-label="Profit summary">
        <BaseCard>
          <span class="reports-kpi-label">Net sales (excl. tax)</span
          ><strong>{{ money(salesMinor) }}</strong
          ><small>{{ report.saleCount }} completed sales before item-cost calculation</small>
        </BaseCard>
        <BaseCard>
          <span class="reports-kpi-label">Cost of goods sold</span
          ><strong>{{ money(costMinor) }}</strong
          ><small>Cost snapshots from sold items, after recorded returns</small>
        </BaseCard>
        <BaseCard class="profit-primary-kpi">
          <span class="reports-kpi-label">Gross profit</span
          ><strong>{{ money(grossProfitMinor) }}</strong
          ><small>Net sales minus recorded product cost</small>
        </BaseCard>
        <BaseCard>
          <span class="reports-kpi-label">Gross margin</span
          ><strong>{{ marginPercent.toFixed(2) }}%</strong
          ><small>Gross profit as a share of net sales</small>
        </BaseCard>
      </section>
      <BaseCard class="reports-table-card reports-cashier-card">
        <header class="reports-card-heading">
          <div>
            <h2>Profit by category</h2>
            <p>
              Sales exclude tax and recorded refunds. Product costs use the cost snapshot saved at
              checkout.
            </p>
          </div>
          <span>{{ categories.length }} categories</span>
        </header>
        <div v-if="!costCoverageComplete" class="inventory-alert" role="status">
          Some older sale lines have missing cost snapshots. Profit shown for those items may be
          overstated; check cost coverage before relying on the total.
        </div>
        <div v-if="categories.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Sales</th>
                <th class="reports-number">Net sales</th>
                <th class="reports-number">Product cost</th>
                <th class="reports-number">Gross profit</th>
                <th>Cost coverage</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in categories" :key="row.categoryName">
                <td>{{ row.categoryName }}</td>
                <td>{{ row.saleCount }}</td>
                <td class="reports-number">{{ money(row.netSalesMinor) }}</td>
                <td class="reports-number">{{ money(row.costMinor) }}</td>
                <td
                  class="reports-number"
                  :class="row.grossMarginMinor < 0 ? 'profit-negative' : 'profit-positive'"
                >
                  {{ money(row.grossMarginMinor) }}
                </td>
                <td>{{ row.costCoveragePercent }}%</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colspan="2">Total</th>
                <th class="reports-number">{{ money(salesMinor) }}</th>
                <th class="reports-number">{{ money(costMinor) }}</th>
                <th class="reports-number">{{ money(grossProfitMinor) }}</th>
                <th>{{ costCoverageComplete ? '100%' : 'Partial' }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="reports-empty">No completed sales for this period.</div>
      </BaseCard>
      <BaseCard class="reports-table-card reports-cashier-card">
        <header class="reports-card-heading">
          <div>
            <h2>Daily sales activity</h2>
            <p>
              Transaction dates for the selected period. Daily gross profit is summarized above and
              by category.
            </p>
          </div>
          <span>{{ report.daily.length }} days</span>
        </header>
        <div v-if="report.daily.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Sales</th>
                <th class="reports-number">Net sales</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.daily" :key="row.date">
                <td>{{ formatDate(row.date) }}</td>
                <td>{{ row.saleCount }}</td>
                <td class="reports-number">{{ money(row.totalMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">No sales recorded in this period.</div>
      </BaseCard>
      <p class="reports-disclaimer">
        Important: this page reports gross profit (sales less recorded product costs), not final net
        business profit. Rent, salaries, utilities and other operating expenses must be entered and
        correctly posted in Accounting to calculate net profit. Older sales without cost snapshots
        are marked with incomplete coverage.
      </p>
    </template>
  </div>
</template>
