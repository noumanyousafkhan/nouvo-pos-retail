<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppTopbar from '@/components/layout/AppTopbar.vue';
</script>

<template>
  <div class="app-shell">
    <AppSidebar />
    <div class="app-main">
      <AppTopbar />
      <main class="page-content"><RouterView /></main>
    </div>
  </div>
</template>
