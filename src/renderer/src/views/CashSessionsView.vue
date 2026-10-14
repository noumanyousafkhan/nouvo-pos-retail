<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { CashSession } from '@shared/contracts/cash-sessions';
import type { BusinessSettings } from '@shared/contracts/settings';

const active = ref<CashSession | null>(null);
const history = ref<CashSession[]>([]);
const currencyCode = ref('PKR');
const loading = ref(true);
const saving = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const openForm = reactive({ openingFloat: '0', openingNote: '' });
const movementForm = reactive({
  movementType: 'cash_in' as 'cash_in' | 'cash_out',
  amount: '',
  reason: '',
});
const closeForm = reactive({ countedCash: '', closingNote: '' });
const money = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
  }).format(minor / 100);
const varianceLabel = computed(() => {
  if (!active.value) return '';
  const amount = active.value.expectedCashMinor;
  return amount < 0
    ? `Cash deficit ${money(Math.abs(amount))}`
    : `Cash expected in drawer ${money(amount)}`;
});

async function refresh() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [current, recent, settings] = await Promise.all([
      window.nouvo.getActiveCashierSession(),
      window.nouvo.listCashierSessions(),
      window.nouvo.getBusinessSettings(),
    ]);
    active.value = current;
    history.value = recent;
    currencyCode.value = (settings as BusinessSettings).currencyCode;
    if (current) closeForm.countedCash = (current.expectedCashMinor / 100).toFixed(2);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Cashier shift information could not be loaded.';
  } finally {
    loading.value = false;
  }
}
function minor(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 90_000_000_000 &&
    Math.round(parsed * 100) / 100 === parsed
    ? Math.round(parsed * 100)
    : null;
}
async function openShift() {
  errorMessage.value = '';
  successMessage.value = '';
  const amount = minor(openForm.openingFloat);
  if (amount === null) {
    errorMessage.value = 'Enter a valid opening float amount.';
    return;
  }
  saving.value = true;
  try {
    active.value = await window.nouvo.openCashierSession({
      openingFloatMinor: amount,
      openingNote: openForm.openingNote,
    });
    successMessage.value = 'Cashier shift opened. Checkout and refunds are now enabled.';
    closeForm.countedCash = (active.value.expectedCashMinor / 100).toFixed(2);
    await refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Shift could not be opened.';
  } finally {
    saving.value = false;
  }
}
async function recordMovement() {
  errorMessage.value = '';
  successMessage.value = '';
  const amount = minor(movementForm.amount);
  if (amount === null || amount <= 0) {
    errorMessage.value = 'Enter a cash movement amount greater than zero.';
    return;
  }
  if (movementForm.reason.trim().length < 3) {
    errorMessage.value = 'Enter a reason for the cash movement.';
    return;
  }
  saving.value = true;
  try {
    active.value = await window.nouvo.recordCashMovement({
      movementType: movementForm.movementType,
      amountMinor: amount,
      reason: movementForm.reason.trim(),
    });
    successMessage.value =
      movementForm.movementType === 'cash_in'
        ? 'Cash added to drawer and logged.'
        : 'Cash removed from drawer and logged.';
    movementForm.amount = '';
    movementForm.reason = '';
    closeForm.countedCash = (active.value.expectedCashMinor / 100).toFixed(2);
    await refresh();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Cash movement could not be saved.';
  } finally {
    saving.value = false;
  }
}
async function closeShift() {
  errorMessage.value = '';
  successMessage.value = '';
  const amount = minor(closeForm.countedCash);
  if (amount === null) {
    errorMessage.value = 'Enter the actual counted cash amount.';
    return;
  }
  saving.value = true;
  try {
    const closed = await window.nouvo.closeCashierSession({
      countedCashMinor: amount,
      closingNote: closeForm.closingNote,
    });
    active.value = null;
    successMessage.value = `Shift closed. Variance: ${money(closed.varianceMinor ?? 0)}.`;
    openForm.openingFloat = '0';
    openForm.openingNote = '';
    closeForm.closingNote = '';
    await refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Shift could not be closed.';
  } finally {
    saving.value = false;
  }
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
onMounted(refresh);
</script>

<template>
  <div class="cash-sessions-page">
    <PageHeader
      eyebrow="CASH CONTROL"
      title="Cashier shifts"
      description="Open the cash drawer, record cash added or removed, and count the money when your shift ends."
    />
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-if="successMessage" class="cash-session-notice" role="status">{{ successMessage }}</div>
    <div v-if="loading" class="reports-empty">Loading cashier shift…</div>
    <template v-else>
      <section v-if="active" class="cash-session-status-grid">
        <BaseCard
          ><span class="cash-session-label">Shift status</span
          ><strong class="cash-session-open">OPEN</strong
          ><small>{{ active.openedByName }} · {{ formatDate(active.openedAt) }}</small></BaseCard
        >
        <BaseCard
          ><span class="cash-session-label">Cash that should be in drawer</span
          ><strong>{{ money(active.expectedCashMinor) }}</strong
          ><small>Starting cash + cash sales − refunds + cash added or removed</small></BaseCard
        >
        <BaseCard
          ><span class="cash-session-label">Cash sales</span
          ><strong>{{ money(active.cashSalesMinor) }}</strong
          ><small>Cash received, less change returned</small></BaseCard
        >
        <BaseCard
          ><span class="cash-session-label">Cash refunds</span
          ><strong>{{ money(active.cashRefundsMinor) }}</strong
          ><small>Refunds recorded during this shift</small></BaseCard
        >
      </section>
      <section v-if="active" class="cash-session-work-grid">
        <BaseCard class="cash-session-panel">
          <header class="cash-session-panel-heading">
            <div>
              <h2>Drawer movements</h2>
              <p>Log every cash addition or removal with a reason.</p>
            </div>
          </header>
          <form class="cash-session-form" @submit.prevent="recordMovement">
            <label class="inventory-field"
              >What do you want to do?<select v-model="movementForm.movementType">
                <option value="cash_in">Add cash to drawer</option>
                <option value="cash_out">Take cash out of drawer</option>
              </select></label
            >
            <label class="inventory-field"
              >Amount<input
                v-model="movementForm.amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                required
            /></label>
            <label class="inventory-field cash-session-wide"
              >Reason<input
                v-model="movementForm.reason"
                maxlength="500"
                minlength="3"
                placeholder="e.g. petty cash for delivery"
                required
            /></label>
            <button class="reports-apply-button" type="submit" :disabled="saving">
              {{ saving ? 'Saving…' : 'Record movement' }}
            </button>
          </form>
          <div class="cash-session-mini-grid">
            <div>
              <span>Cash in</span><strong>{{ money(active.cashInMinor) }}</strong>
            </div>
            <div>
              <span>Cash out</span><strong>{{ money(active.cashOutMinor) }}</strong>
            </div>
          </div>
        </BaseCard>
        <BaseCard class="cash-session-panel">
          <header class="cash-session-panel-heading">
            <div>
              <h2>Count drawer & close</h2>
              <p>Count physical cash before closing the shift.</p>
            </div>
          </header>
          <div class="cash-session-expected">{{ varianceLabel }}</div>
          <form class="cash-session-form cash-session-form--single" @submit.prevent="closeShift">
            <label class="inventory-field"
              >Cash counted in drawer<input
                v-model="closeForm.countedCash"
                type="number"
                min="0"
                step="0.01"
                required
            /></label>
            <label class="inventory-field"
              >Closing note (optional)<textarea
                v-model="closeForm.closingNote"
                rows="2"
                maxlength="500"
                placeholder="Explain any shortage or overage"
              />
            </label>
            <button class="cash-session-close-button" type="submit" :disabled="saving">
              {{ saving ? 'Closing…' : 'Close shift & reconcile' }}
            </button>
          </form>
        </BaseCard>
      </section>
      <BaseCard v-else class="cash-session-panel cash-session-open-panel">
        <div class="cash-session-empty-icon" aria-hidden="true">₨</div>
        <h2>No open shift</h2>
        <p>
          Open a shift with the cash float currently in the drawer. Sales and refunds require an
          open shift.
        </p>
        <form class="cash-session-form cash-session-open-form" @submit.prevent="openShift">
          <label class="inventory-field"
            >Starting cash in drawer<input
              v-model="openForm.openingFloat"
              type="number"
              min="0"
              step="0.01"
              required
          /></label>
          <label class="inventory-field"
            >Note (optional)<input
              v-model="openForm.openingNote"
              maxlength="500"
              placeholder="e.g. morning shift float"
          /></label>
          <button class="reports-apply-button" type="submit" :disabled="saving">
            {{ saving ? 'Opening…' : 'Open cashier shift' }}
          </button>
        </form>
      </BaseCard>
      <BaseCard class="cash-session-history-card">
        <header class="cash-session-panel-heading">
          <div>
            <h2>Recent closed shifts</h2>
            <p>Last 30 reconciliations for this counter.</p>
          </div>
          <span class="cash-session-count">{{ history.length }} shifts</span>
        </header>
        <div v-if="history.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Closed at</th>
                <th>Cashier</th>
                <th>Expected cash</th>
                <th>Counted cash</th>
                <th>Variance</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="shift in history" :key="shift.id">
                <td>{{ shift.closedAt ? formatDate(shift.closedAt) : '—' }}</td>
                <td>{{ shift.openedByName }}</td>
                <td>{{ money(shift.expectedCashMinor) }}</td>
                <td>{{ money(shift.countedCashMinor ?? 0) }}</td>
                <td
                  :class="{
                    'cash-session-shortage': (shift.varianceMinor ?? 0) < 0,
                    'cash-session-overage': (shift.varianceMinor ?? 0) > 0,
                  }"
                >
                  {{ money(shift.varianceMinor ?? 0) }}
                </td>
                <td>
                  <span
                    class="cash-session-result"
                    :class="{ 'cash-session-result--variance': shift.varianceMinor !== 0 }"
                    >{{
                      shift.varianceMinor === 0
                        ? 'Balanced'
                        : shift.varianceMinor! < 0
                          ? 'Shortage'
                          : 'Overage'
                    }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">Closed shifts and cash variances will appear here.</div>
      </BaseCard>
    </template>
  </div>
</template>
