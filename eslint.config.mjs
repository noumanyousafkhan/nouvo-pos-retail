import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default [
  { ignores: ['node_modules/**', 'out/**', 'release/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: [
      'src/renderer/src/views/InventoryView.vue',
      'src/renderer/src/views/CheckoutView.vue',
      'src/renderer/src/views/SalesHistoryView.vue',
      'src/renderer/src/components/sales/ReceiptPreview.vue',
    ],
    // Prettier formats wrapped inline Vue text differently from these template layout rules in the dense inventory, checkout and sales templates.
    rules: {
      'vue/html-indent': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.ts', '**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
    },
  },
];
