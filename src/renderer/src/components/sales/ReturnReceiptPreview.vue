<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import type { SaleReturnResult } from '@shared/contracts/returns';
const props = defineProps<{ result: SaleReturnResult }>();
const emit = defineEmits<{ close: [] }>();
const money = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: props.result.currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
const isPrinting = ref(false);
const printMessage = ref('');
const printerMoney = (minor: number) => `${props.result.currencyCode} ${(minor / 100).toFixed(2)}`;
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
  const result = props.result;
  const lines = [
    `[[CENTER]]${result.businessName}`,
    ...(result.businessAddress ? [`[[CENTER]]${result.businessAddress}`] : []),
    ...(result.businessPhone ? [`[[CENTER]]${result.businessPhone}`] : []),
    ...(result.businessRegistrationNumber ? [`Reg: ${result.businessRegistrationNumber}`] : []),
    '[[RULE]]',
    `${result.operation === 'void' ? 'SALE VOIDED' : 'RETURN COMPLETED'}: ${result.returnNumber}`,
    `Original receipt: ${result.originalReceiptNumber}`,
    `Date: ${new Date(result.createdAt).toLocaleString('en-GB')}`,
    '[[RULE]]',
    ...result.lines.flatMap((line) => [
      `[[PAIR]]${line.productName}\t${printerMoney(line.refundTotalMinor)}`,
      `  ${(line.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })} ${line.unit}`,
    ]),
    '[[RULE]]',
    `[[PAIR]]${result.operation === 'void' ? 'Refund total' : 'Return refund'}\t${printerMoney(result.totalMinor)}`,
    ...result.payments.map(
      (payment) =>
        `[[PAIR]]${payment.paymentMethod.replace('_', ' ')} refund\t${printerMoney(payment.amountMinor)}`,
    ),
    `Reason: ${result.reason}`,
    `[[CENTER]]${displayFooter(result.receiptFooter)}`,
    '',
  ];
  try {
    const response = await window.nouvo.printThermalReceipt({
      lines,
      paperWidthMm: result.receiptPaperWidthMm,
    });
    printMessage.value = response.success
      ? response.message
      : `Printing failed: ${response.message}`;
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
      class="inventory-modal receipt-preview-modal return-receipt-modal"
      :style="{ '--receipt-width': `${result.receiptPaperWidthMm}mm` }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-receipt-title"
    >
      <div class="checkout-receipt-success">
        <span>↩</span>
        <p>{{ result.operation === 'void' ? 'SALE VOIDED' : 'RETURN COMPLETED' }}</p>
        <h2 id="return-receipt-title">{{ result.returnNumber }}</h2>
        <small>{{ new Date(result.createdAt).toLocaleString() }}</small>
      </div>
      <div class="receipt-business-details">
        <strong>{{ result.businessName }}</strong
        ><span v-if="result.businessAddress">{{ result.businessAddress }}</span
        ><span v-if="result.businessPhone">{{ result.businessPhone }}</span
        ><span v-if="result.businessRegistrationNumber"
          >Reg: {{ result.businessRegistrationNumber }}</span
        >
      </div>
      <p class="return-receipt-original">Original receipt: #{{ result.originalReceiptNumber }}</p>
      <div class="checkout-receipt-lines">
        <div v-for="(line, index) in result.lines" :key="`${line.productName}-${index}`">
          <span
            >{{ line.productName
            }}<small
              >↩
              {{
                (line.quantityMilli / 1000).toLocaleString('en-PK', { maximumFractionDigits: 3 })
              }}
              {{ line.unit }}</small
            ></span
          ><strong>{{ money(line.refundTotalMinor) }}</strong>
        </div>
      </div>
      <div class="checkout-receipt-totals">
        <div class="checkout-grand-total">
          <span>{{ result.operation === 'void' ? 'Refund total' : 'Return refund' }}</span
          ><strong>{{ money(result.totalMinor) }}</strong>
        </div>
        <div v-for="(payment, index) in result.payments" :key="index" class="receipt-payment-line">
          <span>{{ payment.paymentMethod.replace('_', ' ') }} refund</span
          ><strong>{{ money(payment.amountMinor) }}</strong>
        </div>
        <div>
          <span>Reason</span><strong>{{ result.reason }}</strong>
        </div>
      </div>
      <p class="receipt-footer-text">{{ displayFooter(result.receiptFooter) }}</p>
      <p v-if="printMessage" class="checkout-receipt-note" role="status">{{ printMessage }}</p>
      <footer class="inventory-modal-footer receipt-preview-actions">
        <BaseButton
          variant="secondary"
          :loading="isPrinting"
          :disabled="isPrinting"
          @click="printReceipt"
          >{{ isPrinting ? 'Printing…' : 'Print return receipt' }}</BaseButton
        ><BaseButton @click="emit('close')">Close</BaseButton>
      </footer>
    </section>
  </div>
</template>
