import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BaseButton from '../../src/renderer/src/components/base/BaseButton.vue';

describe('BaseButton', () => {
  it('renders slotted content and the selected variant', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'secondary' },
      slots: { default: 'Save changes' },
    });
    expect(wrapper.text()).toContain('Save changes');
    expect(wrapper.classes()).toContain('base-button--secondary');
  });

  it('disables itself while loading to prevent duplicate actions', () => {
    const wrapper = mount(BaseButton, { props: { loading: true }, slots: { default: 'Saving' } });
    expect(wrapper.find('button').element.disabled).toBe(true);
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true');
  });
});
