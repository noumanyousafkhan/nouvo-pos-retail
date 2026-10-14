<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { SyncOverview } from '@shared/contracts/sync';

const overview = ref<SyncOverview | null>(null);
const loading = ref(false);
const actionError = ref('');
const notice = ref('');
const configLoading = ref(false);
const configSaving = ref(false);
const serverUrl = ref('');
const storeId = ref('');
const counterId = ref('');
const counterToken = ref('');
const secureStorageAvailable = ref(false);
const configError = ref('');
const configNotice = ref('');
const eventsPage = ref(1);
const eventsPageSize = 10;
const eventPages = computed(() =>
  Math.max(1, Math.ceil((overview.value?.events.length ?? 0) / eventsPageSize)),
);
const pagedEvents = computed(() => {
  const events = overview.value?.events ?? [];
  const start = (eventsPage.value - 1) * eventsPageSize;
  return events.slice(start, start + eventsPageSize);
});
const statusLabels: Record<SyncOverview['status'], string> = {
  not_configured: 'Not configured',
  idle: 'Waiting to sync',
  syncing: 'Syncing',
  connected: 'Connected',
  offline: 'Offline / retry pending',
  error: 'Needs attention',
};
function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
async function loadConfiguration(): Promise<void> {
  configLoading.value = true;
  configError.value = '';
  try {
    const configuration = await window.nouvo.getSyncConfiguration();
    serverUrl.value = configuration.url;
    storeId.value = configuration.storeId;
    counterId.value = configuration.counterId;
    secureStorageAvailable.value = configuration.secureStorageAvailable;
  } catch (error) {
    configError.value =
      error instanceof Error ? error.message : 'Could not load sync configuration.';
  } finally {
    configLoading.value = false;
  }
}
async function saveConfiguration(): Promise<void> {
  configSaving.value = true;
  configError.value = '';
  configNotice.value = '';
  try {
    const configuration = await window.nouvo.saveSyncConfiguration({
      url: serverUrl.value,
      token: counterToken.value,
    });
    serverUrl.value = configuration.url;
    storeId.value = configuration.storeId;
    counterId.value = configuration.counterId;
    secureStorageAvailable.value = configuration.secureStorageAvailable;
    counterToken.value = '';
    configNotice.value = 'Sync configuration saved securely. A sync attempt has started.';
    await refresh();
  } catch (error) {
    configError.value =
      error instanceof Error ? error.message : 'Could not save sync configuration.';
  } finally {
    configSaving.value = false;
  }
}
async function refresh(): Promise<void> {
  loading.value = true;
  actionError.value = '';
  try {
    const loadedOverview = await window.nouvo.getSyncOverview();
    overview.value = loadedOverview;
    eventsPage.value = Math.min(
      eventsPage.value,
      Math.max(1, Math.ceil(loadedOverview.events.length / eventsPageSize)),
    );
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : 'Could not load synchronization status.';
  } finally {
    loading.value = false;
  }
}
async function syncNow(): Promise<void> {
  loading.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    overview.value = await window.nouvo.runSyncNow();
    notice.value = 'Sync attempt finished. Review event statuses below.';
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Sync attempt failed.';
  } finally {
    loading.value = false;
  }
}
async function retryFailed(): Promise<void> {
  loading.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    const count = await window.nouvo.retryFailedSyncEvents();
    const loadedOverview = await window.nouvo.getSyncOverview();
    overview.value = loadedOverview;
    eventsPage.value = Math.min(
      eventsPage.value,
      Math.max(1, Math.ceil(loadedOverview.events.length / eventsPageSize)),
    );
    notice.value = count
      ? 'Returned ' + count + ' failed event(s) to the retry queue.'
      : 'There are no failed events to retry.';
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Could not retry failed events.';
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void refresh();
  void loadConfiguration();
});
</script>

<template>
  <section class="sync-page">
    <header class="sync-page__header">
      <div>
        <p class="sync-eyebrow">OPERATIONS</p>
        <h1>Synchronization</h1>
        <p class="sync-muted">
          Local transactions remain available offline. Delivery requires a compatible central sync
          API.
        </p>
      </div>
      <div class="sync-actions">
        <button
          type="button"
          class="sync-button sync-button--secondary"
          :disabled="loading"
          @click="refresh"
        >
          Refresh
        </button>
        <button
          type="button"
          class="sync-button"
          :disabled="loading || !overview?.configured"
          @click="syncNow"
        >
          Sync now
        </button>
      </div>
    </header>
    <section class="sync-config-panel">
      <div class="sync-events__header">
        <div>
          <h2>Central server connection</h2>
          <p>Configure the HTTPS API URL and this counter's unique token.</p>
        </div>
        <span>{{
          secureStorageAvailable ? 'OS secure storage available' : 'Secure storage unavailable'
        }}</span>
      </div>
      <p v-if="!secureStorageAvailable" class="sync-alert sync-alert--error" role="alert">
        Saved tokens require operating-system secure storage. On this device, use environment
        configuration or enable OS keyring support before saving credentials.
      </p>
      <div class="sync-identity-grid">
        <label>
          <span>Local store UUID</span>
          <input :value="storeId" readonly @focus="($event.target as HTMLInputElement).select()" />
        </label>
        <label>
          <span>This counter UUID</span>
          <input
            :value="counterId"
            readonly
            @focus="($event.target as HTMLInputElement).select()"
          />
        </label>
      </div>
      <p class="sync-muted">
        Use these exact IDs when provisioning this store and counter on the central server.
      </p>
      <form class="sync-config-form" @submit.prevent="saveConfiguration">
        <label>
          <span>Central sync API URL</span>
          <input
            v-model.trim="serverUrl"
            type="url"
            placeholder="https://sync.example.com"
            required
            :disabled="configLoading || configSaving"
            autocomplete="url"
          />
        </label>
        <label>
          <span>Counter token</span>
          <input
            v-model="counterToken"
            type="password"
            placeholder="Paste the token provisioned for this counter"
            :required="!overview?.configured"
            :disabled="configLoading || configSaving"
            autocomplete="new-password"
          />
          <small>Leave blank to keep the saved token.</small>
        </label>
        <button
          type="submit"
          class="sync-button"
          :disabled="configLoading || configSaving || !secureStorageAvailable"
        >
          {{ configSaving ? 'Saving…' : 'Save connection' }}
        </button>
      </form>
      <p v-if="configError" class="sync-alert sync-alert--error" role="alert">{{ configError }}</p>
      <p v-if="configNotice" class="sync-alert" role="status">{{ configNotice }}</p>
    </section>
    <p v-if="actionError" class="sync-alert sync-alert--error" role="alert">{{ actionError }}</p>
    <p v-if="notice" class="sync-alert" role="status">{{ notice }}</p>
    <div v-if="overview" class="sync-status-strip">
      <span class="sync-status-dot" :class="'is-' + overview.status"></span>
      <div>
        <strong>{{ statusLabels[overview.status] }}</strong
        ><small>{{
          overview.configured
            ? 'Server URL and token are configured'
            : 'Events are safely queued locally. Configure the central API URL and counter token to upload them.'
        }}</small>
      </div>
      <button
        type="button"
        class="sync-button sync-button--secondary"
        :disabled="loading || overview.failedCount === 0"
        @click="retryFailed"
      >
        Retry failed
      </button>
    </div>
    <div v-if="overview" class="sync-metrics">
      <article class="sync-metric">
        <span>Pending</span><strong>{{ overview.pendingCount }}</strong
        ><small>{{
          overview.configured
            ? 'Waiting for retry window or upload'
            : 'Queued locally until server configuration'
        }}</small>
      </article>
      <article class="sync-metric">
        <span>In flight</span><strong>{{ overview.inFlightCount }}</strong
        ><small>Claimed by the sync worker</small>
      </article>
      <article class="sync-metric">
        <span>Failed</span><strong>{{ overview.failedCount }}</strong
        ><small>Manual retry or review required</small>
      </article>
      <article class="sync-metric">
        <span>Acknowledged</span><strong>{{ overview.acknowledgedCount }}</strong
        ><small>Accepted by the remote API</small>
      </article>
    </div>
    <div v-if="overview" class="sync-details">
      <div>
        <span>Last attempt</span><strong>{{ formatDate(overview.lastAttemptAt) }}</strong>
      </div>
      <div>
        <span>Last successful sync</span><strong>{{ formatDate(overview.lastSuccessAt) }}</strong>
      </div>
      <div v-if="overview.lastError" class="sync-last-error">
        <span>Latest error</span><strong>{{ overview.lastError }}</strong>
      </div>
    </div>
    <section class="sync-events">
      <div class="sync-events__header">
        <div>
          <h2>Outbox events</h2>
          <p>Latest 100 local events, newest first.</p>
        </div>
        <span>{{ overview?.events.length ?? 0 }} events · {{ pagedEvents.length }} on page</span>
      </div>
      <div v-if="loading && !overview" class="sync-empty">Loading synchronization details…</div>
      <div v-else-if="!overview?.events.length" class="sync-empty">
        No sync events have been queued yet. New supported transactions will appear here.
      </div>
      <div v-else class="sync-table-wrap">
        <table class="sync-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Record</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Created</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in pagedEvents" :key="event.id">
              <td>
                <strong>{{ event.eventType }}</strong
                ><small>{{ event.id.slice(0, 8) }}</small>
              </td>
              <td>
                {{ event.aggregateType }}<small>{{ event.aggregateId.slice(0, 12) }}</small>
              </td>
              <td>
                <span class="sync-event-status" :class="'is-' + event.status">{{
                  event.status.replace('_', ' ')
                }}</span>
              </td>
              <td>{{ event.attempts }}</td>
              <td>{{ formatDate(event.createdAt) }}</td>
              <td class="sync-error-cell">{{ event.lastError || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav
        v-if="(overview?.events.length ?? 0) > eventsPageSize"
        class="sync-pagination"
        aria-label="Outbox event pages"
      >
        <span>Page {{ eventsPage }} of {{ eventPages }}</span>
        <div class="sync-pagination__controls">
          <button type="button" :disabled="eventsPage === 1" @click="eventsPage = 1">First</button>
          <button type="button" :disabled="eventsPage === 1" @click="eventsPage--">Previous</button>
          <button
            v-for="page in eventPages"
            :key="page"
            type="button"
            :class="{ 'is-active': page === eventsPage }"
            :aria-current="page === eventsPage ? 'page' : undefined"
            @click="eventsPage = page"
          >
            {{ page }}
          </button>
          <button type="button" :disabled="eventsPage === eventPages" @click="eventsPage++">
            Next
          </button>
          <button
            type="button"
            :disabled="eventsPage === eventPages"
            @click="eventsPage = eventPages"
          >
            Last
          </button>
        </div>
      </nav>
    </section>
  </section>
</template>
