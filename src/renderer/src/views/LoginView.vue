<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/base/BaseButton.vue';
const router = useRouter();
const form = reactive({ username: '', password: '' });
const saving = ref(false);
const errorMessage = ref('');
async function signIn() {
  saving.value = true;
  errorMessage.value = '';
  try {
    await window.nouvo.login(form);
    await router.replace('/');
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Sign-in failed.';
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
          >Username <span>*</span
          ><input
            v-model="form.username"
            required
            minlength="3"
            maxlength="40"
            autocomplete="username"
            autofocus
            placeholder="Enter your username"
        /></label>
        <label class="inventory-field"
          >Password <span>*</span
          ><input
            v-model="form.password"
            required
            type="password"
            maxlength="128"
            autocomplete="current-password"
            placeholder="Enter your password"
        /></label>
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
