import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**', 'commitlint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // 插件纪律（docs/05 §3）：内置插件只能依赖 plugins/host 与 shared/，机械保证不退化为互相 import
    files: ['src/plugins/builtins/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/store/**', '../../main/**', '../../renderer/**', '../../preload/**', '../../core/**'],
              message: '内置插件只能依赖 plugins/host 与 shared/（见 docs/05 §4）',
            },
          ],
        },
      ],
    },
  },
);
