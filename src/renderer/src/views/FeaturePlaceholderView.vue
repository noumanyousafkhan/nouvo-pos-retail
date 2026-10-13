<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import BaseCard from '@/components/base/BaseCard.vue';
import PageHeader from '@/components/base/PageHeader.vue';

const route = useRoute();
const title = computed(() => String(route.meta.title ?? 'Module'));
const description = computed(() =>
  String(route.meta.description ?? 'This module will be implemented in a later milestone.'),
);
const moduleName = computed(() => String(route.meta.module ?? title.value));
</script>

<template>
  <div class="feature-placeholder">
    <PageHeader eyebrow="MODULE WORKSPACE" :title="title" :description="description" />
    <BaseCard>
      <div class="placeholder-content">
        <div class="placeholder-symbol">✳</div>
        <span class="placeholder-status">NOT IMPLEMENTED YET</span>
        <h2>{{ moduleName }} is reserved for its own module.</h2>
        <p>
          This screen is intentionally a clear placeholder, not a fake working feature. Its UI,
          domain rules, persistence, permissions and tests will be implemented together and verified
          before it is marked complete.
        </p>
      </div>
    </BaseCard>
  </div>
</template>
