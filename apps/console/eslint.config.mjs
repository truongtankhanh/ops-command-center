// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import root from '../../eslint.config.mjs';

const LUCIDE = {
  name: 'lucide-react',
  message: 'Import glyphs from src/ui/icons.ts so the icon set stays swappable.',
};

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
          paths: [LUCIDE],
          patterns: [
            {
              group: ['three', 'three/*', '@react-three/*', 'three-mesh-bvh'],
              message:
                'The 3D toolchain lives in src/twin/ only: it is a lazy chunk that the 2D view, the fallback and the sign-in screens must never download (ADR-0020).',
            },
            {
              group: ['**/twin/*', '**/twin'],
              allowTypeImports: true,
              message:
                'Import src/twin/ only with a dynamic import() from StageView (the one lazy crossing, ADR-0020).',
            },
          ],
        },
      ],
    },
  },
  {
    // The 3D code may import the toolchain; it still must not import lucide-react directly. A later
    // block replaces the whole option object of the rule, so the icon restriction is restated.
    files: ['src/twin/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: [LUCIDE] }] },
  },
  {
    // The one module that wraps the icon set.
    files: ['src/ui/icons.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
