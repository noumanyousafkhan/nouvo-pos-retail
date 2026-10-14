<script setup lang="ts">
/* eslint-disable vue/html-indent */
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@/components/base/PageHeader.vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseCard from '@/components/base/BaseCard.vue';
import type { BusinessSettings } from '@shared/contracts/settings';

const settingsSaving = ref(false);
const settingsError = ref('');
const settingsSuccess = ref('');
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
async function loadBusinessIdentity() {
  try {
    Object.assign(form, await window.nouvo.getBusinessSettings());
  } catch (error) {
    settingsError.value =
      error instanceof Error ? error.message : 'Business identity could not be loaded.';
  }
}
async function saveBusinessIdentity() {
  settingsSaving.value = true;
  settingsError.value = '';
  settingsSuccess.value = '';
  try {
    const saved = await window.nouvo.saveBusinessSettings({ ...form } as BusinessSettings);
    Object.assign(form, saved);
    settingsSuccess.value = 'Business identity saved successfully.';
  } catch (error) {
    settingsError.value =
      error instanceof Error ? error.message : 'Business identity could not be saved.';
  } finally {
    settingsSaving.value = false;
  }
}

const DEFAULT_PRIMARY_COLOR = '#635bda';
const DEFAULT_SECONDARY_COLOR = '#16a085';
const primaryColor = ref(DEFAULT_PRIMARY_COLOR);
const secondaryColor = ref(DEFAULT_SECONDARY_COLOR);
function applyBrandColors() {
  document.documentElement.style.setProperty('--primary', primaryColor.value);
  document.documentElement.style.setProperty('--primary-dark', primaryColor.value);
  document.documentElement.style.setProperty('--secondary', secondaryColor.value);
  document.documentElement.style.setProperty('--nav-active-bg', `${primaryColor.value}18`);
}
function saveBrandColors() {
  if (!/^#[0-9a-f]{6}$/i.test(primaryColor.value) || !/^#[0-9a-f]{6}$/i.test(secondaryColor.value))
    return;
  applyBrandColors();
  localStorage.setItem(
    'nouvo-brand-colors',
    JSON.stringify({ primary: primaryColor.value, secondary: secondaryColor.value }),
  );
  settingsSuccess.value = 'Brand colors saved successfully.';
  settingsError.value = '';
}
function restoreDefaultBrandColors() {
  primaryColor.value = DEFAULT_PRIMARY_COLOR;
  secondaryColor.value = DEFAULT_SECONDARY_COLOR;
  applyBrandColors();
  localStorage.setItem(
    'nouvo-brand-colors',
    JSON.stringify({ primary: DEFAULT_PRIMARY_COLOR, secondary: DEFAULT_SECONDARY_COLOR }),
  );
  settingsSuccess.value = 'Default brand colors restored and saved.';
  settingsError.value = '';
}
function loadBrandColors() {
  try {
    const saved = JSON.parse(localStorage.getItem('nouvo-brand-colors') || '{}');
    if (/^#[0-9a-f]{6}$/i.test(saved.primary)) primaryColor.value = saved.primary;
    if (/^#[0-9a-f]{6}$/i.test(saved.secondary)) secondaryColor.value = saved.secondary;
  } catch {
    /* use defaults */
  }
  applyBrandColors();
}
onMounted(() => {
  loadBrandColors();
  void loadBusinessIdentity();
});
</script>

<template>
  <div class="settings-page">
    <PageHeader
      eyebrow="WORKSPACE APPEARANCE"
      title="Branding"
      description="Customize the primary and secondary colors used across the POS workspace."
    />
    <section class="settings-branding-card">
      <header class="settings-card-header">
        <span class="settings-icon">✦</span>
        <div>
          <h2>Branding &amp; color scheme</h2>
          <p>
            Customize the app accent colors. Select colors here, then save to apply them across the
            workspace.
          </p>
        </div>
      </header>
      <div class="settings-brand-colors">
        <label class="settings-brand-color"
          ><span>Primary color</span>
          <div>
            <input v-model="primaryColor" aria-label="Choose primary color" type="color" /><input
              v-model="primaryColor"
              aria-label="Primary color hex code"
              class="settings-color-hex"
              pattern="^#[0-9a-fA-F]{6}$"
              maxlength="7"
              @change="
                /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? undefined : (primaryColor = '#635bda')
              "
            /></div
        ></label>
        <label class="settings-brand-color"
          ><span>Secondary color</span>
          <div>
            <input
              v-model="secondaryColor"
              aria-label="Choose secondary color"
              type="color"
            /><input
              v-model="secondaryColor"
              aria-label="Secondary color hex code"
              class="settings-color-hex"
              pattern="^#[0-9a-fA-F]{6}$"
              maxlength="7"
              @change="
                /^#[0-9a-fA-F]{6}$/.test(secondaryColor) ? undefined : (secondaryColor = '#16a085')
              "
            /></div
        ></label>
      </div>
      <div class="settings-form-actions settings-color-actions">
        <BaseButton type="button" variant="secondary" @click="restoreDefaultBrandColors">
          Restore default colors
        </BaseButton>
        <BaseButton type="button" @click="saveBrandColors">Save colors</BaseButton>
      </div>
    </section>
    <form class="settings-layout" @submit.prevent="saveBusinessIdentity">
      <div v-if="settingsError" class="inventory-alert inventory-alert--error" role="alert">
        {{ settingsError }}
      </div>
      <div v-if="settingsSuccess" class="inventory-alert inventory-alert--success" role="status">
        {{ settingsSuccess }}
      </div>
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
              placeholder="PKR"
              @input="form.currencyCode = form.currencyCode.toUpperCase()"
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

      <div class="settings-form-actions">
        <BaseButton type="submit" :loading="settingsSaving">Save business identity</BaseButton>
      </div>
    </form>
  </div>
</template>
