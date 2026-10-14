<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/base/BaseButton.vue';
const router = useRouter();
const form = reactive({ username: 'owner', displayName: '', password: '', confirmPassword: '' });
const saving = ref(false);
const errorMessage = ref('');
function readableError(error: unknown): string {
  if (!(error instanceof Error)) return 'Owner setup failed.';
  return error.message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '');
}
const showPassword = ref(false);
const showConfirmPassword = ref(false);
async function setupOwner() {
  errorMessage.value = '';
  form.username = form.username.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(form.username)) {
    errorMessage.value =
      'Username must be 3–40 characters and use only English letters, numbers, dots, underscores or hyphens. Spaces are not allowed.';
    return;
  }
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
    errorMessage.value = readableError(error);
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
          >Owner display name ><input
            v-model="form.displayName"
            required
            minlength="2"
            maxlength="100"
            autocomplete="name"
            placeholder="Your name"
        /></label>
        <label class="inventory-field"
          >Username ><input
            v-model="form.username"
            required
            minlength="3"
            maxlength="40"
            pattern="[A-Za-z0-9._-]+"
            autocomplete="username"
            placeholder="owner"
          /><small
            >3–40 characters. Letters, numbers, dots, underscores and hyphens only; no
            spaces.</small
          ></label
        >
        <label class="inventory-field"
          >Password
          <div class="auth-password-input">
            <input
              v-model="form.password"
              required
              minlength="12"
              maxlength="128"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="At least 12 characters"
            />
            <button
              class="auth-password-toggle"
              type="button"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <svg v-if="!showPassword" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m3 3 18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8.1 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.4 4-1"
                />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            </button>
          </div>
          <small>Stored using Argon2id password hashing.</small>
        </label>
        <label class="inventory-field"
          >Confirm password
          <div class="auth-password-input">
            <input
              v-model="form.confirmPassword"
              required
              minlength="12"
              maxlength="128"
              :type="showConfirmPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Enter password again"
            />
            <button
              class="auth-password-toggle"
              type="button"
              :aria-label="showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'"
              :aria-pressed="showConfirmPassword"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              <svg v-if="!showConfirmPassword" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m3 3 18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8.1 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.4 4-1"
                />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </svg>
            </button>
          </div>
        </label>
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
