import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['src/**/*.jsx', 'src/hooks/**/*.js'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['src/**/*.jsx'],
    ...reactRefresh.configs.vite,
  },
  {
    files: ['src/workers/**/*.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['*.config.js', 'scripts/**/*.{js,mjs}', 'tests/**/*.{js,jsx}', 'e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
