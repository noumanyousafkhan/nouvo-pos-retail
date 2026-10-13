<script setup lang="ts">
import BaseButton from '@/components/base/BaseButton.vue';
import type { SaleResult } from '@shared/contracts/checkout';

const props = withDefaults(defineProps<{ sale: SaleResult; doneLabel?: string }>(), {
  doneLabel: 'Close',
});
const emit = defineEmits<{ close: [] }>();
const formatMoney = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: props.sale.currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
function printReceipt() {
  window.print();
}
</script>

<template>
  <div class="inventory-modal-backdrop receipt-preview-backdrop">
    <section
      class="inventory-modal checkout-receipt-modal receipt-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
    >
      <div class="checkout-receipt-success">
        <span>✓</span>
        <p>SALE COMPLETED</p>
        <h2 id="receipt-title">Receipt #{{ sale.receiptNumber }}</h2>
        <small>{{ sale.businessName }} · {{ new Date(sale.completedAt).toLocaleString() }}</small>
      </div>
      <div class="checkout-receipt-lines">
        <div v-for="(line, index) in sale.lines" :key="`${line.productId}-${index}`">
          <span
            >{{ line.productName
            }}<small
              >×
              {{
                (line.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })
              }}
              {{ line.unit }} @ {{ formatMoney(line.unitPriceMinor) }}</small
            ></span
          >
          <strong>{{ formatMoney(line.lineTotalMinor) }}</strong>
        </div>
      </div>
      <div class="checkout-receipt-totals">
        <div>
          <span>Subtotal</span><strong>{{ formatMoney(sale.subtotalMinor) }}</strong>
        </div>
        <div v-if="sale.discountMinor > 0">
          <span>Discount</span><strong>−{{ formatMoney(sale.discountMinor) }}</strong>
        </div>
        <div>
          <span>Tax</span><strong>{{ formatMoney(sale.taxMinor) }}</strong>
        </div>
        <div class="checkout-grand-total">
          <span>Total</span><strong>{{ formatMoney(sale.totalMinor) }}</strong>
        </div>
        <div
          v-for="(payment, index) in sale.payments"
          :key="`${payment.paymentMethod}-${index}`"
          class="receipt-payment-line"
        >
          <span>{{ payment.paymentMethod.replace('_', ' ') }} paid</span
          ><strong>{{ formatMoney(payment.amountMinor) }}</strong>
        </div>
        <div>
          <span>Change due</span><strong>{{ formatMoney(sale.changeDueMinor) }}</strong>
        </div>
      </div>
      <p class="checkout-receipt-note">
        This receipt is saved locally. Use Print receipt to open the system print dialog and select
        an available printer.
      </p>
      <footer class="inventory-modal-footer receipt-preview-actions">
        <BaseButton variant="secondary" @click="printReceipt">Print receipt</BaseButton>
        <BaseButton @click="emit('close')">{{ doneLabel }}</BaseButton>
      </footer>
    </section>
  </div>
</template>
