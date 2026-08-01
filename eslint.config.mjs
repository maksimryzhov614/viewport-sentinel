import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'artifacts/**', 'config.schema.json'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['eslint.config.mjs'],
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['scripts/**/*.mjs'],
  },
);
