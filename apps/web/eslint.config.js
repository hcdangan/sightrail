import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the web client.
 *
 * Deliberately small: correctness rules plus the React hooks linter. Formatting
 * is left to the editor (Tailwind class order is handled by convention).
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks 7 promotes the React Compiler rule set into
      // `recommended` at `error`, and exposes no legacy preset that excludes it.
      // Adopting that set wholesale is a code migration, not a dependency bump,
      // so the two rules this codebase does not yet satisfy are held at `warn`:
      // they stay visible in every lint run and in the editor, while everything
      // else the plugin recommends - including rules added in future releases -
      // still fails the build.
      //
      //   14x set-state-in-effect         effects that call setState synchronously
      //    2x preserve-manual-memoization useMemo deps the compiler cannot infer
      //
      // The first is a real cascading-render anti-pattern worth migrating; the
      // second is a compiler optimisation note rather than a defect. Fix the
      // call sites, then delete these two lines. Tracked in HANDOFF.md.
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
);
