<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import ReceiptPreview from '@/components/sales/ReceiptPreview.vue';
import type { SaleListItem } from '@shared/contracts/sales';
import type { SaleResult } from '@shared/contracts/checkout';

const sales = ref<SaleListItem[]>([]);
const search = ref('');
const fromDate = ref('');
const toDate = ref('');
const loading = ref(false);
const errorMessage = ref('');
const selectedSale = ref<SaleResult | null>(null);
const totalListedMinor = computed(() =>
  sales.value.reduce((sum, sale) => sum + sale.totalMinor, 0),
);
const formatMoney = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
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
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Sales history could not be loaded.';
  } finally {
    loading.value = false;
  }
}

async function viewReceipt(sale: SaleListItem) {
  errorMessage.value = '';
  try {
    selectedSale.value = await window.nouvo.getSale(sale.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Receipt could not be loaded.';
  }
}

onMounted(loadSales);
</script>

<template>
  <div class="sales-history-page">
    <PageHeader
      eyebrow="TRANSACTION RECORDS"
      title="Sales history"
      description="Review completed counter sales and reopen saved receipt snapshots."
    />
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>

    <div class="inventory-stats sales-history-stats">
      <BaseCard
        ><span class="inventory-stat-label">Completed sales shown</span
        ><strong>{{ sales.length }}</strong
        ><small>Most recent 200 matching transactions</small></BaseCard
      >
      <BaseCard
        ><span class="inventory-stat-label">Sales total shown</span
        ><strong>{{ formatMoney(totalListedMinor) }}</strong
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
            <tr v-for="sale in sales" :key="sale.id">
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
              <td class="inventory-price">{{ formatMoney(sale.totalMinor) }}</td>
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
                <button class="inventory-text-action" type="button" @click="viewReceipt(sale)">
                  View receipt ↗
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="inventory-table-footer">
        <span
          >Showing {{ sales.length }} transaction{{ sales.length === 1 ? '' : 's' }} · Maximum 200
          per query</span
        ><button type="button" @click="loadSales">↻ Refresh</button>
      </div>
    </BaseCard>
    <ReceiptPreview
      v-if="selectedSale"
      :sale="selectedSale"
      done-label="Close"
      @close="selectedSale = null"
    />
  </div>
</template>
