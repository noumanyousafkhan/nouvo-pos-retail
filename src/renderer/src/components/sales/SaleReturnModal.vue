<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import type { SaleResult } from '@shared/contracts/checkout';
import type { ReturnableSaleLine, SaleReturnResult } from '@shared/contracts/returns';

const props = defineProps<{ sale: SaleResult; operation: 'return' | 'void' }>();
const emit = defineEmits<{ close: []; completed: [result: SaleReturnResult] }>();
const lines = ref<(ReturnableSaleLine & { selectedQuantity: string })[]>([]);
const reason = ref('');
const paymentMethod = ref<'cash' | 'card' | 'bank_transfer' | 'mobile_wallet' | 'other'>('cash');
const reference = ref('');
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref('');
const money = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: props.sale.currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
const selected = computed(() =>
  lines.value.filter(
    (line) => Number(line.selectedQuantity) > 0 && line.remainingQuantityMilli > 0,
  ),
);
const estimatedRefund = computed(() =>
  selected.value.reduce((sum, line) => {
    const qty = Math.min(
      line.remainingQuantityMilli,
      Math.round(Number(line.selectedQuantity) * 1000),
    );
    return (
      sum +
      (qty >= line.remainingQuantityMilli
        ? line.remainingRefundMinor
        : Math.min(
            line.remainingRefundMinor,
            Math.round((line.remainingRefundMinor * qty) / line.remainingQuantityMilli),
          ))
    );
  }, 0),
);
const canSubmit = computed(
  () =>
    !saving.value &&
    reason.value.trim().length >= 3 &&
    (props.operation === 'void' || selected.value.length > 0),
);
async function loadLines() {
  loading.value = true;
  errorMessage.value = '';
  try {
    lines.value = (await window.nouvo.getReturnableItems(props.sale.id)).map((line) => ({
      ...line,
      selectedQuantity:
        props.operation === 'void' ? String(line.remainingQuantityMilli / 1000) : '0',
    }));
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Returnable quantities could not be loaded.';
  } finally {
    loading.value = false;
  }
}
async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  errorMessage.value = '';
  try {
    const result =
      props.operation === 'void'
        ? await window.nouvo.voidSale({
            saleId: props.sale.id,
            reason: reason.value.trim(),
            refundPaymentMethod: paymentMethod.value,
            refundReference: reference.value.trim(),
          })
        : await window.nouvo.returnSale({
            saleId: props.sale.id,
            reason: reason.value.trim(),
            items: selected.value.map((line) => ({
              saleLineId: line.saleLineId,
              quantityMilli: Math.round(Number(line.selectedQuantity) * 1000),
            })),
            refundPaymentMethod: paymentMethod.value,
            refundReference: reference.value.trim(),
          });
    emit('completed', result);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Return could not be completed.';
  } finally {
    saving.value = false;
  }
}
onMounted(loadLines);
</script>

<template>
  <div class="inventory-modal-backdrop receipt-preview-backdrop" @click.self="emit('close')">
    <section
      class="inventory-modal sale-return-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-return-title"
    >
      <header class="sale-return-heading">
        <div>
          <span class="sale-return-eyebrow">ORIGINAL RECEIPT #{{ sale.receiptNumber }}</span>
          <h2 id="sale-return-title">
            {{ operation === 'void' ? 'Void sale & refund' : 'Return items' }}
          </h2>
          <p>
            {{
              operation === 'void'
                ? 'Void reverses the entire sale, restores its stock and records the refund.'
                : 'Choose the remaining quantity to return. Stock and refund records are posted together.'
            }}
          </p>
        </div>
        <button type="button" aria-label="Close return dialog" @click="emit('close')">×</button>
      </header>
      <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-if="loading" class="purchasing-empty">Checking remaining returnable quantities…</div>
      <div v-else class="sale-return-lines">
        <div v-for="line in lines" :key="line.saleLineId" class="sale-return-line">
          <div class="sale-return-product">
            <strong>{{ line.productName }}</strong
            ><small
              >Sold {{ (line.soldQuantityMilli / 1000).toLocaleString() }} {{ line.unit }} · Already
              returned {{ (line.returnedQuantityMilli / 1000).toLocaleString() }}</small
            ><small>Refundable balance {{ money(line.remainingRefundMinor) }}</small>
          </div>
          <label v-if="operation === 'return'" class="inventory-field"
            >Return qty<input
              v-model="line.selectedQuantity"
              type="number"
              min="0"
              :max="line.remainingQuantityMilli / 1000"
              step="0.001"
              :disabled="line.remainingQuantityMilli === 0"
          /></label>
          <div v-else class="sale-return-full-quantity">
            {{ (line.remainingQuantityMilli / 1000).toLocaleString() }} {{ line.unit }}
          </div>
        </div>
      </div>
      <div class="sale-return-form">
        <label class="inventory-field"
          >Reason <span>*</span
          ><textarea
            v-model="reason"
            rows="2"
            maxlength="500"
            required
            placeholder="Customer return, damaged item, duplicate sale…"
          />
        </label>
        <div class="sale-return-payment-fields">
          <label class="inventory-field"
            >Refund method<select v-model="paymentMethod">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_wallet">Mobile wallet</option>
              <option value="other">Other</option>
            </select></label
          ><label class="inventory-field"
            >Refund reference<input
              v-model="reference"
              maxlength="200"
              placeholder="Optional transaction reference"
          /></label>
        </div>
      </div>
      <div class="sale-return-summary">
        <span>{{ operation === 'void' ? 'Full sale refund' : 'Estimated refund' }}</span
        ><strong>{{ money(operation === 'void' ? sale.totalMinor : estimatedRefund) }}</strong>
      </div>
      <footer class="inventory-modal-footer">
        <BaseButton variant="secondary" :disabled="saving" @click="emit('close')">Cancel</BaseButton
        ><BaseButton :loading="saving" :disabled="loading || !canSubmit" @click="submit">{{
          operation === 'void' ? 'Confirm void & refund' : 'Confirm return & refund'
        }}</BaseButton>
      </footer>
    </section>
  </div>
</template>
