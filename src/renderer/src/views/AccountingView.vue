<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { AccountingAccount, JournalSummary } from '@shared/contracts/accounting';
import type { BusinessSettings } from '@shared/contracts/settings';

const accounts = ref<AccountingAccount[]>([]);
const journals = ref<JournalSummary[]>([]);
const currencyCode = ref('PKR');
const loading = ref(true);
const errorMessage = ref('');
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
    const [accountRows, journalRows, settings] = await Promise.all([
      window.nouvo.listAccountingAccounts(),
      window.nouvo.listAccountingJournals(),
      window.nouvo.getBusinessSettings(),
    ]);
    accounts.value = accountRows;
    journals.value = journalRows;
    currencyCode.value = (settings as BusinessSettings).currencyCode;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Accounting ledger could not be loaded.';
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);
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
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="reports-empty">
          No journals yet. A journal is created when a sale, return or purchase receipt is posted.
        </div>
      </BaseCard>
    </template>
  </div>
</template>
