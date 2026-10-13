<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { SalesReport } from '@shared/contracts/reports';
import type { BusinessSettings } from '@shared/contracts/settings';

const loading = ref(false);
const errorMessage = ref('');
const report = ref<SalesReport | null>(null);
const currencyCode = ref('PKR');
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const thirtyDaysAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const filters = reactive({ fromDate: thirtyDaysAgo(), toDate: today() });
const money = (minor: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const periodLabel = computed(() => `${filters.fromDate} — ${filters.toDate}`);

async function loadReport() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [result, settings] = await Promise.all([
      window.nouvo.getSalesReport({ fromDate: filters.fromDate, toDate: filters.toDate }),
      window.nouvo.getBusinessSettings(),
    ]);
    report.value = result;
    currencyCode.value = (settings as BusinessSettings).currencyCode;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reports could not be loaded.';
  } finally {
    loading.value = false;
  }
}
function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(date);
}
onMounted(loadReport);
</script>

<template>
  <div class="reports-page">
    <PageHeader
      eyebrow="BUSINESS INTELLIGENCE"
      title="Reports & insights"
      description="Review completed sales, payment mix, best-selling products and current stock valuation for this counter."
    />
    <BaseCard class="reports-filter-card">
      <form class="reports-filters" @submit.prevent="loadReport">
        <label class="inventory-field"
          >From date<input v-model="filters.fromDate" type="date" :max="filters.toDate" required
        /></label>
        <label class="inventory-field"
          >To date<input
            v-model="filters.toDate"
            type="date"
            :min="filters.fromDate"
            :max="today()"
            required
        /></label>
        <button class="reports-apply-button" type="submit" :disabled="loading">
          {{ loading ? 'Loading…' : 'Apply filters' }}
        </button>
        <span class="reports-period">{{ periodLabel }}</span>
      </form>
    </BaseCard>
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-if="loading && !report" class="reports-empty">Loading your reports…</div>
    <template v-else-if="report">
      <section class="reports-kpi-grid" aria-label="Sales summary">
        <BaseCard
          ><span class="reports-kpi-label">Net sales</span
          ><strong>{{ money(report.totalMinor) }}</strong
          ><small>{{ report.saleCount }} completed sales</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">Subtotal</span
          ><strong>{{ money(report.subtotalMinor) }}</strong
          ><small>Before discounts and tax</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">Discounts</span
          ><strong>{{ money(report.discountMinor) }}</strong
          ><small>Recorded sale discounts</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">Tax collected</span
          ><strong>{{ money(report.taxMinor) }}</strong
          ><small>Based on configured tax mode</small></BaseCard
        >
      </section>
      <section class="reports-kpi-grid reports-kpi-grid--inventory" aria-label="Inventory summary">
        <BaseCard
          ><span class="reports-kpi-label">Active products</span
          ><strong>{{ report.inventory.activeProducts }}</strong
          ><small>Current catalogue</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">Products in stock</span
          ><strong>{{ report.inventory.stockedProducts }}</strong
          ><small>Based on stock ledger</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">On-hand quantity</span
          ><strong>{{ (report.inventory.quantityMilli / 1000).toLocaleString() }}</strong
          ><small>Base units across this counter</small></BaseCard
        >
        <BaseCard
          ><span class="reports-kpi-label">Estimated stock cost</span
          ><strong>{{ money(report.inventory.estimatedCostValueMinor) }}</strong
          ><small>Weighted-average unit cost × on-hand (estimate)</small></BaseCard
        >
      </section>
      <BaseCard class="reports-table-card reports-cashier-card">
        <header class="reports-card-heading">
          <div>
            <h2>Cashier performance</h2>
            <p>Net sales after recorded refunds, across this store</p>
          </div>
          <span>{{ report.byCashier.length }} cashiers</span>
        </header>
        <div v-if="report.byCashier.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Cashier</th>
                <th>Sales</th>
                <th class="reports-number">Net sales</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.byCashier" :key="row.cashierName">
                <td>{{ row.cashierName }}</td>
                <td>{{ row.saleCount }}</td>
                <td class="reports-number">{{ money(row.totalMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">No cashier sales in this date range.</div>
      </BaseCard>
      <BaseCard class="reports-table-card reports-cashier-card">
        <header class="reports-card-heading">
          <div>
            <h2>Category sales and gross margin</h2>
            <p>
              Sales exclude tax and recorded refunds. Cost uses the purchase-cost snapshot saved at
              checkout.
            </p>
          </div>
          <span>{{ report.byCategory.length }} categories</span>
        </header>
        <p
          v-if="report.byCategory.some((row) => row.costCoveragePercent < 100)"
          class="reports-empty"
        >
          Cost coverage is incomplete for some older sales created before cost snapshots were
          recorded. Gross margin is partial for those rows.
        </p>
        <div v-if="report.byCategory.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Sales</th>
                <th class="reports-number">Net sales</th>
                <th class="reports-number">Cost</th>
                <th class="reports-number">Gross margin</th>
                <th>Cost coverage</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.byCategory" :key="row.categoryName">
                <td>{{ row.categoryName }}</td>
                <td>{{ row.saleCount }}</td>
                <td class="reports-number">{{ money(row.netSalesMinor) }}</td>
                <td class="reports-number">{{ money(row.costMinor) }}</td>
                <td class="reports-number">{{ money(row.grossMarginMinor) }}</td>
                <td>{{ row.costCoveragePercent }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">Category sales will appear after checkout.</div>
      </BaseCard>
      <section class="reports-two-column">
        <BaseCard class="reports-table-card">
          <header class="reports-card-heading">
            <div>
              <h2>Daily sales</h2>
              <p>Completed sales by transaction date</p>
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
          <div v-else class="reports-empty">No completed sales in this date range.</div>
        </BaseCard>
        <BaseCard class="reports-table-card">
          <header class="reports-card-heading">
            <div>
              <h2>Top products</h2>
              <p>Ranked by sales value</p>
            </div>
            <span>Top 10</span>
          </header>
          <div v-if="report.topProducts.length" class="reports-table-wrap">
            <table class="inventory-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th class="reports-number">Sales</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.topProducts" :key="row.productName">
                  <td>{{ row.productName }}</td>
                  <td>{{ (row.quantityMilli / 1000).toLocaleString() }}</td>
                  <td class="reports-number">{{ money(row.totalMinor) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="reports-empty">Product sales will appear here after checkout.</div>
        </BaseCard>
      </section>
      <BaseCard class="reports-table-card reports-payments-card">
        <header class="reports-card-heading">
          <div>
            <h2>Payment summary</h2>
            <p>Applied payment amounts for completed sales</p>
          </div>
        </header>
        <div v-if="report.byPaymentMethod.length" class="reports-payment-grid">
          <div v-for="row in report.byPaymentMethod" :key="row.method" class="reports-payment-item">
            <span>{{ row.method }}</span
            ><strong>{{ money(row.amountMinor) }}</strong
            ><small>{{ row.paymentCount }} payment entries</small>
          </div>
        </div>
        <div v-else class="reports-empty">No payment records in this date range.</div>
      </BaseCard>
      <p class="reports-disclaimer">
        Stock value is an estimate using each product’s current purchase cost and this counter’s
        stock ledger. It is not a posted accounting valuation. Return refunds are deducted from net
        sales and top-product totals; voided sales are excluded. Purchases are not integrated into
        financial statements.
      </p>
    </template>
  </div>
</template>
