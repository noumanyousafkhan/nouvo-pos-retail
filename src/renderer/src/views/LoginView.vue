<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/base/BaseButton.vue';
const router = useRouter();
const form = reactive({ username: '', password: '' });
const saving = ref(false);
const errorMessage = ref('');
const showPassword = ref(false);
function readableError(error: unknown): string {
  if (!(error instanceof Error)) return 'Sign-in failed.';
  return error.message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error: /, '');
}
async function signIn() {
  saving.value = true;
  errorMessage.value = '';
  try {
    await window.nouvo.login({ username: form.username.trim(), password: form.password });
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
    <section class="auth-card auth-card--login">
      <span class="auth-step">SECURE COUNTER ACCESS</span>
      <h1>Welcome back</h1>
      <p class="auth-description">Sign in with your assigned staff account to open this counter.</p>
      <div v-if="errorMessage" class="inventory-alert inventory-alert--error" role="alert">
        {{ errorMessage }}
      </div>
      <form class="auth-form" @submit.prevent="signIn">
        <label class="inventory-field"
          >Username ><input
            v-model="form.username"
            required
            minlength="3"
            maxlength="40"
            autocomplete="username"
            autofocus
            placeholder="Enter your username"
        /></label>
        <label class="inventory-field"
          >Password
          <div class="auth-password-input">
            <input
              v-model="form.password"
              required
              :type="showPassword ? 'text' : 'password'"
              maxlength="128"
              autocomplete="current-password"
              placeholder="Enter your password"
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
            </button></div
        ></label>
        <BaseButton block type="submit" :loading="saving"
          >Sign in securely <span>→</span></BaseButton
        >
      </form>
      <p class="auth-security-note">
        <span>▣</span> 5 failed attempts trigger a 15-minute lockout.
      </p>
    </section>
    <p class="auth-footer">Ask your store owner if you need an account or a password reset.</p>
  </main>
</template>
