import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores([
    '**/node_modules',
    '**/dist',
    '**/dev-dist',
    '**/coverage',
    '**/.turbo',
    '**/routeTree.gen.ts',
    '**/database.types.ts',
    'supabase/.temp',
    '.claude/worktrees',
  ]),

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  // React code (web app, shared ui, api hooks)
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/api/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },

  // Browser-only code
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Fast refresh rules for the Vite app. Route files are handled by the router plugin.
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/routes/**'],
    extends: [reactRefresh.configs.vite],
  },

  // Packages shared with the future React Native app must stay platform-neutral.
  {
    files: ['packages/{core,api,tokens,i18n}/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {},
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react-dom', 'react-dom/*', '@potluck/ui', '@potluck/web'],
              message: 'Shared packages must not depend on the DOM or web-only code.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Shared packages must not use DOM globals.' },
        { name: 'document', message: 'Shared packages must not use DOM globals.' },
        { name: 'localStorage', message: 'Shared packages must not use DOM globals.' },
        { name: 'sessionStorage', message: 'Shared packages must not use DOM globals.' },
      ],
    },
  },
])
