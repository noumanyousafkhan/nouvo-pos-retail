<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
  }>(),
  {
    variant: 'primary',
    type: 'button',
    disabled: false,
    loading: false,
  },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="base-button"
    :class="`base-button--${variant}`"
    :aria-busy="loading"
  >
    <span v-if="loading" class="button-spinner" aria-hidden="true"></span>
    <slot />
  </button>
</template>
