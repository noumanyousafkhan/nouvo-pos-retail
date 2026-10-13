<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/base/BaseButton.vue';
const router = useRouter();
const form = reactive({ username: 'owner', displayName: '', password: '', confirmPassword: '' });
const saving = ref(false);
const errorMessage = ref('');
async function setupOwner() {
  errorMessage.value = '';
  if (form.password !== form.confirmPassword) {
    errorMessage.value = 'Passwords do not match.';
    return;
  }
  saving.value = true;
  try {
    await window.nouvo.setupOwner({
      username: form.username,
      displayName: form.displayName,
      password: form.password,
    });
    await router.replace('/');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Owner setup failed.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-brand">
      <span class="brand-mark">N</span
      ><span><strong>NOUVO POS</strong><small>CASH &amp; CARRY EDITION</small></span>
    </div>
    <section class="auth-card">
      <span class="auth-step">FIRST-RUN SETUP · 01</span>
      <h1>Create your owner account</h1>
      <p class="auth-description">
        Set up the first store owner. This account can manage staff, permissions, settings and
        backups.
      </p>
      <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
        {{ errorMessage }}
      </div>
      <form class="auth-form" @submit.prevent="setupOwner">
        <label class="inventory-field"
          >Owner display name <span>*</span
          ><input
            v-model="form.displayName"
            required
            minlength="2"
            maxlength="100"
            autocomplete="name"
            placeholder="Your name"
        /></label>
        <label class="inventory-field"
          >Username <span>*</span
          ><input
            v-model="form.username"
            required
            minlength="3"
            maxlength="40"
            pattern="[A-Za-z0-9._-]+"
            autocomplete="username"
            placeholder="owner"
        /></label>
        <label class="inventory-field"
          >Password <span>*</span
          ><input
            v-model="form.password"
            required
            minlength="12"
            maxlength="128"
            type="password"
            autocomplete="new-password"
            placeholder="At least 12 characters"
          /><small>Stored using Argon2id password hashing.</small></label
        >
        <label class="inventory-field"
          >Confirm password <span>*</span
          ><input
            v-model="form.confirmPassword"
            required
            minlength="12"
            maxlength="128"
            type="password"
            autocomplete="new-password"
            placeholder="Enter password again"
        /></label>
        <BaseButton block type="submit" :loading="saving"
          >Create owner and open POS <span>→</span></BaseButton
        >
      </form>
      <p class="auth-security-note">
        <span>▣</span> Local sign-in · Permission-checked IPC · 8-hour session
      </p>
    </section>
    <p class="auth-footer">
      Your database stays on this counter. Keep your owner password private.
    </p>
  </main>
</template>
