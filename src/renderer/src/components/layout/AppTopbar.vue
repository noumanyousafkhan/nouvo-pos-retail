<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const pageTitle = computed(() => String(route.meta.title ?? 'Workspace'));
</script>

<template>
  <header class="topbar">
    <div class="topbar-breadcrumb">
      <span>Workspace</span><span class="breadcrumb-separator">/</span
      ><strong>{{ pageTitle }}</strong>
    </div>
    <div class="topbar-actions">
      <div class="local-status"><span class="status-dot"></span><span>Counter workspace</span></div>
      <div class="avatar" aria-label="NOUVO POS">N</div>
    </div>
  </header>
</template>
