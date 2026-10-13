<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseButton from '@/components/base/BaseButton.vue';
const router = useRouter();
</script>
<template>
  <main class="auth-page">
    <div class="auth-brand">
      <span class="brand-mark">N</span
      ><span><strong>NOUVO POS</strong><small>CASH &amp; CARRY EDITION</small></span>
    </div>
    <section class="auth-card">
      <span class="auth-step">ACCESS CONTROL</span>
      <h1>Permission required</h1>
      <p class="auth-description">
        Your account does not have permission to open this section. Ask the store owner to review
        your role.
      </p>
      <BaseButton block @click="router.replace('/')">Return to overview</BaseButton>
    </section>
    <p class="auth-footer">Access checks are enforced by the main process, not only the screen.</p>
  </main>
</template>
