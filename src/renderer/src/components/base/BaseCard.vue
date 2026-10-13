<script setup lang="ts">
withDefaults(defineProps<{ padded?: boolean; interactive?: boolean }>(), {
  padded: true,
  interactive: false,
});
</script>

<template>
  <section
    class="base-card"
    :class="{ 'base-card--padded': padded, 'base-card--interactive': interactive }"
  >
    <slot />
  </section>
</template>
