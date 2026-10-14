<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import ReceiptPreview from '@/components/sales/ReceiptPreview.vue';
import type { SaleListItem } from '@shared/contracts/sales';
import type { SaleResult } from '@shared/contracts/checkout';
import type { AuthState } from '@shared/contracts/auth';
import type { SaleReturnResult } from '@shared/contracts/returns';
import SaleReturnModal from '@/components/sales/SaleReturnModal.vue';
import ReturnReceiptPreview from '@/components/sales/ReturnReceiptPreview.vue';

const sales = ref<SaleListItem[]>([]);
const search = ref('');
const fromDate = ref('');
const toDate = ref('');
const loading = ref(false);
const errorMessage = ref('');
const selectedSale = ref<SaleResult | null>(null);
const authState = ref<AuthState | null>(null);
const returningSale = ref<SaleResult | null>(null);
const returnOperation = ref<'return' | 'void'>('return');
const returnReceipt = ref<SaleReturnResult | null>(null);
const page = ref(1);
const pageSize = 10;
const totalPages = computed(() => Math.max(1, Math.ceil(sales.value.length / pageSize)));
const pagedSales = computed(() =>
  sales.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const totalListedMinor = computed(() =>
  sales.value.reduce((sum, sale) => sum + sale.totalMinor, 0),
);
const formatMoney = (minor: number, currencyCode = 'PKR') =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);

async function loadSales() {
  loading.value = true;
  errorMessage.value = '';
  try {
    sales.value = await window.nouvo.listSales({
      search: search.value,
      ...(fromDate.value ? { fromDate: fromDate.value } : {}),
      ...(toDate.value ? { toDate: toDate.value } : {}),
      limit: 200,
    });
    page.value = 1;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Sales history could not be loaded.';
  } finally {
    loading.value = false;
  }
}

function setSalesPeriod(period: 'daily' | 'weekly' | 'monthly' | 'all' | 'custom') {
  const now = new Date();
  const iso = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const end = iso(now);
  const start = new Date(now);
  if (period === 'daily') start.setDate(start.getDate());
  else if (period === 'weekly') start.setDate(start.getDate() - 6);
  else if (period === 'monthly') start.setDate(start.getDate() - 29);
  if (period === 'all') {
    fromDate.value = '';
    toDate.value = '';
  } else if (period !== 'custom') {
    fromDate.value = iso(start);
    toDate.value = end;
  }
  if (period !== 'custom') void loadSales();
}
async function viewReceipt(sale: SaleListItem) {
  errorMessage.value = '';
  try {
    selectedSale.value = await window.nouvo.getSale(sale.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Receipt could not be loaded.';
  }
}

async function startReturn(sale: SaleListItem, operation: 'return' | 'void') {
  errorMessage.value = '';
  try {
    selectedSale.value = null;
    returnReceipt.value = null;
    returningSale.value = await window.nouvo.getSale(sale.id);
    returnOperation.value = operation;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Original sale could not be loaded.';
  }
}
function onReturnCompleted(result: SaleReturnResult) {
  returningSale.value = null;
  returnReceipt.value = result;
  void loadSales();
}
async function initialize() {
  try {
    authState.value = await window.nouvo.getAuthState();
  } catch {
    authState.value = null;
  }
  await loadSales();
}
onMounted(initialize);
</script>

<template>
  <div class="sales-history-page">
    <PageHeader
      eyebrow="TRANSACTION RECORDS"
      title="Sales history"
      description="Review sales, issue permitted returns/refunds or voids, and reopen saved receipt snapshots."
    />
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>

    <div class="inventory-stats sales-history-stats">
      <BaseCard
        ><span class="inventory-stat-label">Transactions shown</span
        ><strong>{{ sales.length }}</strong
        ><small>Most recent 200 matching transactions</small></BaseCard
      >
      <BaseCard
        ><span class="inventory-stat-label">Original totals shown</span
        ><strong>{{ formatMoney(totalListedMinor, sales[0]?.currencyCode ?? 'PKR') }}</strong
        ><small>Based on current filters</small></BaseCard
      >
      <BaseCard
        ><span class="inventory-stat-label">Receipt storage</span
        ><strong class="inventory-storage-status">Saved locally</strong
        ><small>Receipt snapshots survive app restarts</small></BaseCard
      >
    </div>

    <BaseCard :padded="false" class="sales-history-table-card">
      <form class="sales-history-filters" @submit.prevent="loadSales">
        <label class="sales-history-search"
          ><span aria-hidden="true">⌕</span
          ><input
            v-model="search"
            placeholder="Search receipt number or product…"
            aria-label="Search receipt number or product"
        /></label>
        <div class="sales-history-presets" aria-label="Sales period">
          <button type="button" @click="setSalesPeriod('daily')">Daily</button>
          <button type="button" @click="setSalesPeriod('weekly')">Weekly</button>
          <button type="button" @click="setSalesPeriod('monthly')">Monthly</button>
          <button type="button" @click="setSalesPeriod('all')">All time</button>
        </div>
        <label class="sales-history-date">From <input v-model="fromDate" type="date" /></label>
        <label class="sales-history-date">To <input v-model="toDate" type="date" /></label>
        <BaseButton type="submit" variant="secondary" :loading="loading">Apply filters</BaseButton>
      </form>
      <div v-if="loading && sales.length === 0" class="inventory-empty">
        <span class="inventory-spinner"></span><strong>Loading sales…</strong>
      </div>
      <div v-else-if="sales.length === 0" class="inventory-empty">
        <div class="inventory-empty-icon">▧</div>
        <strong>No sales found</strong>
        <p>Completed sales will appear here. Try changing the search or date filters.</p>
      </div>
      <div v-else class="inventory-table-wrap">
        <table class="inventory-table sales-history-table">
          <thead>
            <tr>
              <th>RECEIPT</th>
              <th>DATE / TIME</th>
              <th>LINES</th>
              <th>PAYMENT METHOD</th>
              <th>TOTAL</th>
              <th>STATUS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sale in pagedSales" :key="sale.id">
              <td>
                <strong class="sales-receipt-number">#{{ sale.receiptNumber }}</strong
                ><small class="sales-business-name">{{ sale.businessName }}</small>
              </td>
              <td>{{ new Date(sale.completedAt).toLocaleString() }}</td>
              <td>{{ sale.itemCount }}</td>
              <td>
                <div class="sales-payment-methods">
                  <span v-for="method in sale.paymentMethods" :key="method">{{
                    method.replace('_', ' ')
                  }}</span>
                </div>
              </td>
              <td class="inventory-price">{{ formatMoney(sale.totalMinor, sale.currencyCode) }}</td>
              <td>
                <span
                  class="inventory-status"
                  :class="
                    sale.status === 'completed'
                      ? 'inventory-status--active'
                      : 'inventory-status--archived'
                  "
                  >{{ sale.status.replace('_', ' ') }}</span
                >
              </td>
              <td>
                <div class="sales-history-actions">
                  <button class="inventory-text-action" type="button" @click="viewReceipt(sale)">
                    View receipt ↗
                  </button>
                  <button
                    v-if="
                      authState?.permissions.includes('sales.return') &&
                      ['completed', 'partially_returned'].includes(sale.status)
                    "
                    class="inventory-text-action"
                    type="button"
                    @click="startReturn(sale, 'return')"
                  >
                    Return / refund
                  </button>
                  <button
                    v-if="
                      authState?.permissions.includes('sales.void') && sale.status === 'completed'
                    "
                    class="inventory-text-action sales-void-action"
                    type="button"
                    @click="startReturn(sale, 'void')"
                  >
                    Void sale
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="inventory-table-footer">
        <span
          >Showing {{ pagedSales.length }} of {{ sales.length }} matching transactions · up to 200
          loaded</span
        >
        <div class="sales-history-pagination">
          <button type="button" :disabled="page === 1" @click="page = 1">First</button>
          <button type="button" :disabled="page === 1" @click="page--">Previous</button>
          <button
            v-for="number in totalPages"
            :key="number"
            type="button"
            :class="{ 'is-active': page === number }"
            :aria-current="page === number ? 'page' : undefined"
            @click="page = number"
          >
            {{ number }}
          </button>
          <button type="button" :disabled="page === totalPages" @click="page++">Next</button>
          <button type="button" :disabled="page === totalPages" @click="page = totalPages">
            Last
          </button>
          <button type="button" @click="loadSales">↻ Refresh</button>
        </div>
      </div>
    </BaseCard>
    <ReceiptPreview
      v-if="selectedSale"
      :sale="selectedSale"
      done-label="Close"
      @close="selectedSale = null"
    />
    <SaleReturnModal
      v-if="returningSale"
      :sale="returningSale"
      :operation="returnOperation"
      @close="returningSale = null"
      @completed="onReturnCompleted"
    />
    <ReturnReceiptPreview
      v-if="returnReceipt"
      :result="returnReceipt"
      @close="returnReceipt = null"
    />
  </div>
</template>
