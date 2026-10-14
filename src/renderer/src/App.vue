<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppShell from '@/layouts/AppShell.vue';

const route = useRoute();
const isAuthPage = computed(() => ['/setup', '/login', '/forbidden'].includes(route.path));

function preventNumberInputWheelChange(event: WheelEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'number') {
    event.preventDefault();
  }
}

onMounted(() => {
  document.addEventListener('wheel', preventNumberInputWheelChange, {
    capture: true,
    passive: false,
  });
});
onUnmounted(() => {
  document.removeEventListener('wheel', preventNumberInputWheelChange, true);
});
</script>

<template><RouterView v-if="isAuthPage" /><AppShell v-else /></template>
