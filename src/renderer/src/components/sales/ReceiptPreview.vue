<script setup lang="ts">
import { ref } from 'vue';
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
const isPrinting = ref(false);
const printMessage = ref('');
const printerMoney = (minor: number) => `${props.sale.currencyCode} ${(minor / 100).toFixed(2)}`;
const posFooter = 'POS by: Nouman Yousaf - 03114521220';
function displayFooter(value: string): string {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && line !== posFooter),
    ),
    posFooter,
  ].join('\n');
}
async function printReceipt() {
  if (isPrinting.value) return;
  isPrinting.value = true;
  printMessage.value = '';
  const sale = props.sale;
  const lines = [
    `[[CENTER]]${sale.businessName}`,
    ...(sale.businessAddress ? [`[[CENTER]]${sale.businessAddress}`] : []),
    ...(sale.businessPhone ? [`[[CENTER]]${sale.businessPhone}`] : []),
    ...(sale.businessRegistrationNumber ? [`Reg: ${sale.businessRegistrationNumber}`] : []),
    '[[RULE]]',
    `Receipt: ${sale.receiptNumber}`,
    `Date: ${new Date(sale.completedAt).toLocaleString('en-GB')}`,
    '[[RULE]]',
    ...sale.lines.flatMap((line) => [
      `[[PAIR]]${line.productName}\t${printerMoney(line.lineTotalMinor)}`,
      `  ${(line.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${line.unit} x ${printerMoney(line.unitPriceMinor)}`,
    ]),
    '[[RULE]]',
    `[[PAIR]]Subtotal\t${printerMoney(sale.subtotalMinor)}`,
    ...(sale.discountMinor > 0 ? [`[[PAIR]]Discount\t-${printerMoney(sale.discountMinor)}`] : []),
    `[[PAIR]]Tax\t${printerMoney(sale.taxMinor)}`,
    `[[PAIR]]TOTAL\t${printerMoney(sale.totalMinor)}`,
    ...sale.payments.map(
      (payment) =>
        `[[PAIR]]${payment.paymentMethod.replace('_', ' ')} paid\t${printerMoney(payment.amountMinor)}`,
    ),
    `[[PAIR]]Change due\t${printerMoney(sale.changeDueMinor)}`,
    `[[CENTER]]${displayFooter(sale.receiptFooter)}`,
    '',
    'Thank you!',
  ];
  try {
    const result = await window.nouvo.printThermalReceipt({
      lines,
      paperWidthMm: sale.receiptPaperWidthMm,
    });
    if (!result.success) {
      printMessage.value = `Printing failed: ${result.message}`;
    } else {
      printMessage.value = result.message;
      emit('close');
    }
  } catch (error) {
    printMessage.value = `Printing failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    isPrinting.value = false;
  }
}
</script>

<template>
  <div class="inventory-modal-backdrop receipt-preview-backdrop">
    <section
      class="inventory-modal checkout-receipt-modal receipt-preview-modal"
      :style="{ '--receipt-width': `${sale.receiptPaperWidthMm}mm` }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
    >
      <div class="checkout-receipt-success">
        <span>✓</span>
        <p>SALE COMPLETED</p>
        <h2 id="receipt-title">Receipt #{{ sale.receiptNumber }}</h2>
        <small>{{ new Date(sale.completedAt).toLocaleString() }}</small>
      </div>
      <div class="receipt-business-details">
        <strong>{{ sale.businessName }}</strong>
        <span v-if="sale.businessAddress">{{ sale.businessAddress }}</span>
        <span v-if="sale.businessPhone">{{ sale.businessPhone }}</span>
        <span v-if="sale.businessRegistrationNumber"
          >Reg: {{ sale.businessRegistrationNumber }}</span
        >
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
      <p class="receipt-footer-text">{{ displayFooter(sale.receiptFooter) }}</p>
      <p class="checkout-receipt-note">
        Receipt printing sends a single thermal-print job directly to the configured printer.
      </p>
      <p v-if="printMessage" class="checkout-receipt-note" role="status">{{ printMessage }}</p>
      <footer class="inventory-modal-footer receipt-preview-actions">
        <BaseButton
          variant="secondary"
          :loading="isPrinting"
          :disabled="isPrinting"
          @click="printReceipt"
          >{{ isPrinting ? 'Printing…' : 'Print receipt' }}</BaseButton
        >
        <BaseButton @click="emit('close')">{{ doneLabel }}</BaseButton>
      </footer>
    </section>
  </div>
</template>
