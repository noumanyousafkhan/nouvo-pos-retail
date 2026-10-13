<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type {
  AccountingAccount,
  JournalSummary,
  TrialBalanceRow,
  IncomeStatement,
} from '@shared/contracts/accounting';
import type { BusinessSettings } from '@shared/contracts/settings';

const accounts = ref<AccountingAccount[]>([]);
const journals = ref<JournalSummary[]>([]);
const trialBalance = ref<TrialBalanceRow[]>([]);
const incomeStatement = ref<IncomeStatement | null>(null);
const balanceSheet = ref<{
  assetsMinor: number;
  liabilitiesMinor: number;
  equityMinor: number;
  balanced: boolean;
} | null>(null);
const cashMovement = ref<{
  inflowMinor: number;
  outflowMinor: number;
  netChangeMinor: number;
  bySource: {
    sourceType: string;
    inflowMinor: number;
    outflowMinor: number;
    netChangeMinor: number;
  }[];
} | null>(null);
const indirectCashFlow = ref<{
  netIncomeMinor: number;
  inventoryChangeMinor: number;
  accountsPayableChangeMinor: number;
  salesTaxPayableChangeMinor: number;
  openingStockEquityChangeMinor: number;
  operatingCashFlowMinor: number;
  cashChangeMinor: number;
  reconciliationDifferenceMinor: number;
} | null>(null);
const today = new Date().toISOString().slice(0, 10);
const asOfDate = ref(today);
const periodEnd = ref(today);
const periodStart = ref(today.slice(0, 8) + '01');
const currencyCode = ref('PKR');
const loading = ref(true);
const errorMessage = ref('');
const successMessage = ref('');
const canManage = ref(false);
const manualSaving = ref(false);
const journalToReverse = ref<JournalSummary | null>(null);
const reversalReason = ref('');
const reversalSaving = ref(false);
const manualDescription = ref('');
type ManualLineDraft = { accountId: string; debit: string; credit: string; memo: string };
const newManualLine = (): ManualLineDraft => ({ accountId: '', debit: '', credit: '', memo: '' });
const manualLines = ref<ManualLineDraft[]>([
  newManualLine(),
  newManualLine(),
  newManualLine(),
  newManualLine(),
]);
const manualDebitTotalMinor = computed(() =>
  manualLines.value.reduce((sum, line) => sum + Math.round(Number(line.debit || 0) * 100), 0),
);
const manualCreditTotalMinor = computed(() =>
  manualLines.value.reduce((sum, line) => sum + Math.round(Number(line.credit || 0) * 100), 0),
);
const money = (minor: number) =>
  new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
  }).format(minor / 100);
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
async function refresh() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const [
      accountRows,
      journalRows,
      settings,
      balanceRows,
      incomeRows,
      sheet,
      cashRows,
      indirectRows,
    ] = await Promise.all([
      window.nouvo.listAccountingAccounts(),
      window.nouvo.listAccountingJournals(),
      window.nouvo.getBusinessSettings(),
      window.nouvo.getAccountingTrialBalance(asOfDate.value),
      window.nouvo.getAccountingIncomeStatement({
        startDate: periodStart.value,
        endDate: periodEnd.value,
      }),
      window.nouvo.getAccountingBalanceSheet(asOfDate.value),
      window.nouvo.getAccountingCashMovementStatement({
        startDate: periodStart.value,
        endDate: periodEnd.value,
      }),
      window.nouvo.getAccountingIndirectCashFlowStatement({
        startDate: periodStart.value,
        endDate: periodEnd.value,
      }),
    ]);
    accounts.value = accountRows;
    journals.value = journalRows;
    trialBalance.value = balanceRows;
    incomeStatement.value = incomeRows;
    balanceSheet.value = sheet;
    cashMovement.value = cashRows;
    indirectCashFlow.value = indirectRows;
    currencyCode.value = (settings as BusinessSettings).currencyCode;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Accounting ledger could not be loaded.';
  } finally {
    loading.value = false;
  }
}
async function postManualJournal(): Promise<void> {
  manualSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const lines = manualLines.value
      .filter((line) => line.accountId || line.debit !== '' || line.credit !== '')
      .map((line) => ({
        accountId: line.accountId,
        debitMinor: Math.round(Number(line.debit || 0) * 100),
        creditMinor: Math.round(Number(line.credit || 0) * 100),
        memo: line.memo,
      }));
    const id = await window.nouvo.postManualAccountingJournal({
      description: manualDescription.value,
      lines,
    });
    manualDescription.value = '';
    manualLines.value = [newManualLine(), newManualLine(), newManualLine(), newManualLine()];
    await refresh();
    successMessage.value = 'Manual journal posted successfully (' + id + ').';
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Manual journal could not be posted.';
  } finally {
    manualSaving.value = false;
  }
}
function reverseManualJournal(journal: JournalSummary): void {
  journalToReverse.value = journal;
  reversalReason.value = '';
  errorMessage.value = '';
  successMessage.value = '';
}
async function confirmManualJournalReversal(): Promise<void> {
  const journal = journalToReverse.value;
  const reason = reversalReason.value.trim();
  if (!journal || reason.length < 3 || reversalSaving.value) return;
  reversalSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const reversalId = await window.nouvo.reverseManualAccountingJournal({
      entryId: journal.id,
      reason,
    });
    journalToReverse.value = null;
    await refresh();
    successMessage.value = 'Journal reversed. Reversal entry: ' + reversalId;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Journal could not be reversed.';
  } finally {
    reversalSaving.value = false;
  }
}
onMounted(async () => {
  await refresh();
  try {
    const authState = await window.nouvo.getAuthState();
    canManage.value = authState.permissions.includes('accounting.manage');
  } catch {
    canManage.value = false;
  }
});
</script>

<template>
  <div class="accounting-page">
    <PageHeader
      eyebrow="FINANCIAL CONTROL"
      title="Accounting ledger"
      description="Review the default chart of accounts and automatically posted double-entry journals."
    />
    <div class="accounting-policy-note">
      <strong>Accounting foundation</strong
      ><span
        >Every displayed journal is checked for equal debits and credits. Default account mappings
        and tax treatment still require accountant approval before live financial use.</span
      >
    </div>
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>
    <section class="accounting-panel accounting-report-filters">
      <label>Trial balance as of <input v-model="asOfDate" type="date" /></label>
      <label>Income statement from <input v-model="periodStart" type="date" /></label>
      <label>Through <input v-model="periodEnd" type="date" /></label>
      <button class="reports-apply-button" type="button" :disabled="loading" @click="refresh">
        Refresh reports
      </button>
    </section>
    <div v-if="loading" class="reports-empty">Loading accounting ledger…</div>
    <template v-else>
      <section class="accounting-summary-grid">
        <BaseCard>
          <span>Chart of accounts</span><strong>{{ accounts.length }}</strong
          ><small>System accounts for this store</small>
        </BaseCard>
        <BaseCard>
          <span>Recent journal entries</span><strong>{{ journals.length }}</strong
          ><small>Latest posted transactions</small>
        </BaseCard>
        <BaseCard>
          <span>Balanced entries</span
          ><strong>{{ journals.filter((j) => j.debitMinor === j.creditMinor).length }}</strong
          ><small>Debits equal credits</small>
        </BaseCard>
      </section>
      <BaseCard class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Chart of accounts</h2>
            <p>
              Default local ledger accounts. Editing account structure is intentionally not exposed
              yet.
            </p>
          </div>
          <button class="reports-apply-button" type="button" :disabled="loading" @click="refresh">
            Refresh ledger
          </button>
        </header>
        <div class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account name</th>
                <th>Type</th>
                <th>Normal balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="account in accounts" :key="account.id">
                <td class="accounting-code">{{ account.code }}</td>
                <td>{{ account.name }}</td>
                <td>
                  <span class="accounting-type">{{ account.accountType }}</span>
                </td>
                <td>{{ account.normalBalance }}</td>
                <td>
                  <span class="accounting-active">{{
                    account.isActive ? 'Active' : 'Inactive'
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BaseCard>
      <section class="accounting-summary-grid">
        <BaseCard>
          <span>Net revenue</span
          ><strong>{{ money(incomeStatement?.totalRevenueMinor ?? 0) }}</strong>
          <small>{{ periodStart }} through {{ periodEnd }}</small>
        </BaseCard>
        <BaseCard>
          <span>Net expenses</span
          ><strong>{{ money(incomeStatement?.totalExpensesMinor ?? 0) }}</strong>
          <small>Posted income and expense accounts</small>
        </BaseCard>
        <BaseCard>
          <span>Net income</span
          ><strong :class="{ 'accounting-negative': (incomeStatement?.netIncomeMinor ?? 0) < 0 }">{{
            money(incomeStatement?.netIncomeMinor ?? 0)
          }}</strong>
          <small>Revenue minus expenses</small>
        </BaseCard>
      </section>
      <section class="accounting-summary-grid">
        <BaseCard>
          <span>Balance sheet — assets</span
          ><strong>{{ money(balanceSheet?.assetsMinor ?? 0) }}</strong>
          <small>Posted balances through {{ asOfDate }}</small>
        </BaseCard>
        <BaseCard>
          <span>Liabilities</span><strong>{{ money(balanceSheet?.liabilitiesMinor ?? 0) }}</strong>
          <small>Posted liability accounts</small>
        </BaseCard>
        <BaseCard>
          <span>Equity + retained earnings</span
          ><strong>{{ money(balanceSheet?.equityMinor ?? 0) }}</strong>
          <small>{{
            balanceSheet?.balanced
              ? 'Assets equal liabilities plus equity'
              : 'Out of balance — review ledger'
          }}</small>
        </BaseCard>
      </section>
      <BaseCard class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Cash movement statement</h2>
            <p>
              Cash and non-cash clearing account movements for {{ periodStart }} through
              {{ periodEnd }}. This is a ledger cash-movement summary, not a full indirect-method
              cash-flow statement.
            </p>
          </div>
          <span class="cash-session-count">Net {{ money(cashMovement?.netChangeMinor ?? 0) }}</span>
        </header>
        <section class="accounting-summary-grid">
          <BaseCard
            ><span>Inflows</span
            ><strong>{{ money(cashMovement?.inflowMinor ?? 0) }}</strong></BaseCard
          >
          <BaseCard
            ><span>Outflows</span
            ><strong>{{ money(cashMovement?.outflowMinor ?? 0) }}</strong></BaseCard
          >
        </section>
        <div v-if="cashMovement?.bySource.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Inflow</th>
                <th>Outflow</th>
                <th>Net change</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in cashMovement.bySource" :key="row.sourceType">
                <td>{{ row.sourceType }}</td>
                <td>{{ money(row.inflowMinor) }}</td>
                <td>{{ money(row.outflowMinor) }}</td>
                <td>{{ money(row.netChangeMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">No cash or clearing movements in this period.</div>
      </BaseCard>
      <BaseCard class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Indirect cash-flow reconciliation</h2>
            <p>
              Net income adjusted for inventory, supplier payables, sales tax payable and non-cash
              opening-stock entries. The difference should be zero when cash-affecting entries are
              classified in the ledger.
            </p>
          </div>
          <span class="cash-session-count"
            >Operating {{ money(indirectCashFlow?.operatingCashFlowMinor ?? 0) }}</span
          >
        </header>
        <div class="reports-table-wrap">
          <table class="inventory-table">
            <tbody>
              <tr>
                <td>Net income</td>
                <td class="reports-number">{{ money(indirectCashFlow?.netIncomeMinor ?? 0) }}</td>
              </tr>
              <tr>
                <td>Less / (add) change in inventory</td>
                <td class="reports-number">
                  {{ money(-(indirectCashFlow?.inventoryChangeMinor ?? 0)) }}
                </td>
              </tr>
              <tr>
                <td>Change in accounts payable</td>
                <td class="reports-number">
                  {{ money(indirectCashFlow?.accountsPayableChangeMinor ?? 0) }}
                </td>
              </tr>
              <tr>
                <td>Change in sales tax payable</td>
                <td class="reports-number">
                  {{ money(indirectCashFlow?.salesTaxPayableChangeMinor ?? 0) }}
                </td>
              </tr>
              <tr>
                <td>Non-cash opening-stock/equity adjustment</td>
                <td class="reports-number">
                  {{ money(indirectCashFlow?.openingStockEquityChangeMinor ?? 0) }}
                </td>
              </tr>
              <tr>
                <th>Net operating cash flow</th>
                <th class="reports-number">
                  {{ money(indirectCashFlow?.operatingCashFlowMinor ?? 0) }}
                </th>
              </tr>
              <tr>
                <td>Actual cash / clearing account change</td>
                <td class="reports-number">{{ money(indirectCashFlow?.cashChangeMinor ?? 0) }}</td>
              </tr>
              <tr>
                <td>Reconciliation difference</td>
                <td class="reports-number">
                  {{ money(indirectCashFlow?.reconciliationDifferenceMinor ?? 0) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </BaseCard>
      <BaseCard class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Trial balance</h2>
            <p>
              Posted journal balances through {{ asOfDate }}. Total debits and credits must agree.
            </p>
          </div>
          <span class="cash-session-count"
            >{{
              money(trialBalance.reduce((sum, row) => sum + row.debitBalanceMinor, 0))
            }}
            debit</span
          >
        </header>
        <div class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th>Debit balance</th>
                <th>Credit balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in trialBalance" :key="row.accountId">
                <td class="accounting-code">{{ row.code }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.accountType }}</td>
                <td>{{ money(row.debitBalanceMinor) }}</td>
                <td>{{ money(row.creditBalanceMinor) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colspan="3">Totals</th>
                <th>
                  {{ money(trialBalance.reduce((sum, row) => sum + row.debitBalanceMinor, 0)) }}
                </th>
                <th>
                  {{ money(trialBalance.reduce((sum, row) => sum + row.creditBalanceMinor, 0)) }}
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
      </BaseCard>
      <BaseCard v-if="canManage" class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Manual journal</h2>
            <p>
              Post an owner-approved balanced journal. Corrections must use a reversal rather than
              editing a posted entry.
            </p>
          </div>
          <span class="cash-session-count">{{ money(manualDebitTotalMinor) }} debit</span>
        </header>
        <form class="manual-journal-form" @submit.prevent="postManualJournal">
          <label
            >Description
            <input
              v-model.trim="manualDescription"
              required
              minlength="3"
              maxlength="200"
              placeholder="Reason for this journal"
          /></label>
          <div class="manual-journal-lines">
            <div class="manual-journal-line manual-journal-line--heading">
              <span>Account</span><span>Debit ({{ currencyCode }})</span
              ><span>Credit ({{ currencyCode }})</span><span>Memo</span>
            </div>
            <div v-for="(line, index) in manualLines" :key="index" class="manual-journal-line">
              <select v-model="line.accountId" aria-label="Journal account">
                <option value="">Select account</option>
                <option
                  v-for="account in accounts.filter((item) => item.isActive)"
                  :key="account.id"
                  :value="account.id"
                >
                  {{ account.code }} — {{ account.name }}
                </option>
              </select>
              <input
                v-model="line.debit"
                type="number"
                min="0"
                step="0.01"
                aria-label="Debit amount"
                placeholder="0.00"
              />
              <input
                v-model="line.credit"
                type="number"
                min="0"
                step="0.01"
                aria-label="Credit amount"
                placeholder="0.00"
              />
              <input
                v-model.trim="line.memo"
                maxlength="200"
                aria-label="Journal line memo"
                placeholder="Optional memo"
              />
            </div>
          </div>
          <div class="manual-journal-footer">
            <span
              >Debits: <strong>{{ money(manualDebitTotalMinor) }}</strong></span
            ><span
              >Credits: <strong>{{ money(manualCreditTotalMinor) }}</strong></span
            ><button
              type="button"
              class="reports-apply-button"
              @click="manualLines.push(newManualLine())"
              :disabled="manualLines.length >= 50"
            >
              Add line</button
            ><button
              type="submit"
              class="reports-apply-button"
              :disabled="
                manualSaving ||
                manualDebitTotalMinor <= 0 ||
                manualDebitTotalMinor !== manualCreditTotalMinor
              "
            >
              {{ manualSaving ? 'Posting…' : 'Post journal' }}
            </button>
          </div>
        </form>
      </BaseCard>
      <div v-if="successMessage" class="accounting-success" role="status">{{ successMessage }}</div>
      <BaseCard class="accounting-panel">
        <header class="accounting-panel-heading">
          <div>
            <h2>Posted journals</h2>
            <p>
              Sales, returns/voids and received purchase orders. Entries are immutable in this view.
            </p>
          </div>
          <span class="cash-session-count">{{ journals.length }} entries</span>
        </header>
        <div v-if="journals.length" class="reports-table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Posted at</th>
                <th>Entry</th>
                <th>Source</th>
                <th>Description</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Check</th>
                <th>Status / action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="journal in journals" :key="journal.id">
                <td>{{ formatDate(journal.postedAt) }}</td>
                <td class="accounting-code">{{ journal.entryNumber }}</td>
                <td>
                  <span class="accounting-type">{{ journal.sourceType.replace('_', ' ') }}</span>
                </td>
                <td>{{ journal.description }}</td>
                <td>{{ money(journal.debitMinor) }}</td>
                <td>{{ money(journal.creditMinor) }}</td>
                <td>
                  <span
                    class="accounting-active"
                    :class="{ 'accounting-unbalanced': journal.debitMinor !== journal.creditMinor }"
                    >{{
                      journal.debitMinor === journal.creditMinor ? 'Balanced' : 'UNBALANCED'
                    }}</span
                  >
                </td>
                <td>
                  <span class="accounting-type">{{ journal.status }}</span>
                  <button
                    v-if="
                      canManage && journal.sourceType === 'manual' && journal.status === 'posted'
                    "
                    type="button"
                    class="accounting-reverse-button"
                    @click="reverseManualJournal(journal)"
                  >
                    Reverse
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">
          No journals yet. A journal is created when a sale, return or purchase receipt is posted.
        </div>
      </BaseCard>
    </template>
    <div v-if="journalToReverse" class="accounting-modal-backdrop" role="presentation">
      <section
        class="accounting-reversal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reversal-title"
      >
        <h2 id="reversal-title">Reverse {{ journalToReverse.entryNumber }}?</h2>
        <p>
          The original journal remains in the audit trail. A balanced reversing entry will be
          posted.
        </p>
        <label for="reversal-reason">Reason for reversal</label>
        <textarea
          id="reversal-reason"
          v-model.trim="reversalReason"
          maxlength="500"
          rows="3"
          placeholder="Explain why this entry must be reversed"
        />
        <div class="accounting-reversal-actions">
          <button
            type="button"
            class="reports-apply-button"
            :disabled="reversalSaving"
            @click="journalToReverse = null"
          >
            Cancel
          </button>
          <button
            type="button"
            class="accounting-reverse-button"
            :disabled="reversalSaving || reversalReason.trim().length < 3"
            @click="confirmManualJournalReversal"
          >
            {{ reversalSaving ? 'Reversing…' : 'Confirm reversal' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
