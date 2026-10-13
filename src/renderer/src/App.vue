<script setup lang="ts">
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import AppShell from '@/layouts/AppShell.vue';
const route = useRoute();
const isAuthPage = computed(() => ['/setup', '/login', '/forbidden'].includes(route.path));
</script>

<template><RouterView v-if="isAuthPage" /><AppShell v-else /></template>
