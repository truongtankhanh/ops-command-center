// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              message: 'Import glyphs from src/ui/icons.ts so the icon set stays swappable.',
            },
          ],
        },
      ],
    },
  },
  {
    // The one module that wraps the icon set.
    files: ['src/ui/icons.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
