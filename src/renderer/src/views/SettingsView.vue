<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';
import type { BusinessSettings } from '@shared/contracts/settings';

const loading = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const form = reactive({
  name: 'My Store',
  currencyCode: 'PKR',
  timezone: 'Asia/Karachi',
  taxBehavior: 'exclusive' as 'exclusive' | 'inclusive',
  address: '',
  phone: '',
  businessRegistrationNumber: '',
  receiptFooter: '',
  receiptPaperWidthMm: 80 as 58 | 80,
});

function applySettings(settings: BusinessSettings) {
  Object.assign(form, settings);
}

async function loadSettings() {
  loading.value = true;
  errorMessage.value = '';
  try {
    applySettings(await window.nouvo.getBusinessSettings());
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : 'Business settings could not be loaded.';
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const saved = await window.nouvo.saveBusinessSettings({ ...form });
    applySettings(saved);
    successMessage.value =
      'Business and receipt settings saved. New sales will use these settings.';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Settings could not be saved.';
  } finally {
    saving.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <div class="settings-page">
    <PageHeader
      eyebrow="STORE CONFIGURATION"
      title="Business settings"
      description="Configure the shop identity, currency, tax behavior and receipt details for this counter."
    />
    <div v-if="successMessage" class="inventory-alert inventory-alert--success" role="status">
      {{ successMessage }}
    </div>
    <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
      {{ errorMessage }}
    </div>

    <form class="settings-layout" @submit.prevent="saveSettings">
      <BaseCard class="settings-card">
        <header class="settings-card-header">
          <span class="settings-icon">▦</span>
          <div>
            <h2>Business identity</h2>
            <p>Shown in the application and saved receipt snapshots.</p>
          </div>
        </header>
        <div class="settings-fields-grid">
          <label class="inventory-field settings-field-wide"
            >Business / shop name <span>*</span
            ><input
              v-model="form.name"
              required
              maxlength="160"
              placeholder="Your registered shop name"
          /></label>
          <label class="inventory-field"
            >Currency code <span>*</span
            ><input
              v-model="form.currencyCode"
              required
              minlength="3"
              maxlength="3"
              pattern="[A-Za-z]{3}"
              @input="form.currencyCode = form.currencyCode.toUpperCase()"
              placeholder="PKR"
            /><small>ISO 4217 code, e.g. PKR, USD or SAR.</small></label
          >
          <label class="inventory-field"
            >Business timezone <span>*</span
            ><input
              v-model="form.timezone"
              required
              maxlength="100"
              placeholder="Asia/Karachi"
            /><small>Use an IANA timezone identifier.</small></label
          >
          <label class="inventory-field settings-field-wide"
            >Business address<textarea
              v-model="form.address"
              rows="2"
              maxlength="500"
              placeholder="Shop address for receipts"
            />
          </label>
          <label class="inventory-field"
            >Phone number<input
              v-model="form.phone"
              maxlength="80"
              placeholder="Business contact number"
          /></label>
          <label class="inventory-field"
            >Registration / tax number<input
              v-model="form.businessRegistrationNumber"
              maxlength="100"
              placeholder="Optional registration ID"
          /></label>
        </div>
      </BaseCard>

      <BaseCard class="settings-card">
        <header class="settings-card-header">
          <span class="settings-icon settings-icon--tax">%</span>
          <div>
            <h2>Tax and pricing</h2>
            <p>Choose how configured product tax rates affect the sale total.</p>
          </div>
        </header>
        <div class="settings-tax-options">
          <label
            class="settings-choice"
            :class="form.taxBehavior === 'exclusive' ? 'settings-choice--selected' : ''"
            ><input v-model="form.taxBehavior" type="radio" value="exclusive" /><span
              ><strong>Tax exclusive</strong
              ><small>Tax is added on top of the product selling price.</small></span
            ></label
          >
          <label
            class="settings-choice"
            :class="form.taxBehavior === 'inclusive' ? 'settings-choice--selected' : ''"
            ><input v-model="form.taxBehavior" type="radio" value="inclusive" /><span
              ><strong>Tax inclusive</strong
              ><small
                >Product price already includes tax; tax is extracted for reporting.</small
              ></span
            ></label
          >
        </div>
        <p class="settings-warning">
          <strong>Important:</strong> Confirm the tax mode with your accountant before using this
          POS for real transactions. Existing receipts keep their original tax and business
          snapshots.
        </p>
      </BaseCard>

      <BaseCard class="settings-card">
        <header class="settings-card-header">
          <span class="settings-icon settings-icon--receipt">▤</span>
          <div>
            <h2>Receipt settings</h2>
            <p>Configure the saved receipt snapshot and thermal paper width.</p>
          </div>
        </header>
        <div class="settings-fields-grid">
          <label class="inventory-field settings-field-wide"
            >Receipt paper width<select v-model.number="form.receiptPaperWidthMm">
              <option :value="58">58 mm thermal paper</option>
              <option :value="80">80 mm thermal paper</option></select
            ><small
              >The print preview uses this width; the actual printer still needs to be selected in
              the system print dialog.</small
            ></label
          >
          <label class="inventory-field settings-field-wide"
            >Receipt footer<textarea
              v-model="form.receiptFooter"
              rows="3"
              maxlength="500"
              placeholder="Thank you for shopping with us."
            />
          </label>
        </div>
      </BaseCard>

      <div class="settings-actions">
        <span v-if="loading">Loading saved settings…</span
        ><span v-else>Settings are stored locally and queued for future sync.</span
        ><BaseButton type="submit" :loading="saving" :disabled="loading"
          >Save business settings</BaseButton
        >
      </div>
    </form>
  </div>
</template>
