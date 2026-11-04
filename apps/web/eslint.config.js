import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import boundaries from 'eslint-plugin-boundaries';

const SLICED_LAYERS = ['pages', 'widgets', 'features', 'entities'];

// Other elements are reached only through their public API; shared segments are open.
const publicApi = (types) => ({ element: { type: types, fileInternalPath: 'index.ts' } });
const anyFile = (types) => ({ element: { type: types } });

const allow = (from, to) => ({ from: { element: { type: from } }, allow: { to } });

const sameSlice = (type) =>
  allow(type, { element: { type, captured: { slice: '{{ from.element.captured.slice }}' } } });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true, project: './tsconfig.json' } },
      'boundaries/root-path': import.meta.dirname,
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        ...SLICED_LAYERS.map((type) => ({
          type,
          pattern: `src/${type}/*`,
          partialMatch: false,
          capture: ['slice'],
        })),
        { type: 'shared', pattern: 'src/shared', partialMatch: false },
        { type: 'routes', pattern: 'app', partialMatch: false },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'FSD: {{ from.element.types.[0] }} cannot import {{ to.element.types.[0] }} here. Layers only import lower layers, slices of the same layer stay isolated and src/ never imports the Next.js routes in app/.',
          policies: [
            allow('routes', publicApi(['app', 'pages'])),
            allow('app', publicApi(SLICED_LAYERS)),
            allow('pages', publicApi(['widgets', 'features', 'entities'])),
            allow('widgets', publicApi(['features', 'entities'])),
            allow('features', publicApi(['entities'])),
            allow(['routes', 'app', ...SLICED_LAYERS, 'shared'], anyFile(['shared'])),
            allow('app', anyFile(['app'])),
            ...SLICED_LAYERS.map(sameSlice),
          ],
        },
      ],
    },
  },
  prettier,
];

export default config;
