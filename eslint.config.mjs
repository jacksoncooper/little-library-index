// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default defineConfig({
  files: ['**/*.ts'],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    prettier,
  ],
  plugins: {
    'simple-import-sort': simpleImportSort,
  },
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
  languageOptions: {
    parserOptions: {
      projectService: true,
    },
  },
});
