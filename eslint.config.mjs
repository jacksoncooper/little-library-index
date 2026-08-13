// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig({
  files: ['**/*.ts'],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    prettier,
  ],
  languageOptions: {
    parserOptions: {
      projectService: true,
    },
  },
});
