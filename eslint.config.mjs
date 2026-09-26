import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/* Scope: the TypeScript app. The CommonJS assistant pipeline (lib/, api/*.js,
   scripts/*.js) is plain JavaScript and stays out of the TypeScript lint. */
export default tseslint.config(
  {
    ignores: [
      'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**',
      'prototype/**', '.superpowers/**', '**/*.js', '**/*.mjs', '**/*.cjs',
      /* Deno (npm: imports, the Deno global); its logic is src/server/notify, linted there */
      'supabase/functions/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    /* TND amounts intentionally use NBSP / narrow-no-break-space inside regex
       literals (money.ts, its test); skip regex contents so recommended's
       no-irregular-whitespace doesn't flag them. */
    rules: { 'no-irregular-whitespace': ['error', { skipRegExps: true }] },
  },
  { files: ['src/**/*.tsx'], ...jsxA11y.flatConfigs.recommended },
);
