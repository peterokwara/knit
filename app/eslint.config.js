import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', '.output/**', '.tanstack/**', 'src/routeTree.gen.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      ...jsdoc.configs['flat/recommended-typescript-error'].rules,
      'jsdoc/require-description': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
        { selector: 'classProperty', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'require' },
      ],
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        require: {
          ArrowFunctionExpression: true,
          ClassDeclaration: true,
          ClassExpression: true,
          FunctionDeclaration: true,
          FunctionExpression: true,
          MethodDefinition: true,
        },
      }],
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['src/server/models/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': ['error', {
        contexts: ['TSInterfaceDeclaration', 'TSPropertySignature', 'TSMethodSignature', 'TSIndexSignature', 'TSTypeAliasDeclaration'],
        require: { FunctionDeclaration: false },
      }],
      'jsdoc/require-hyphen-before-param-description': ['error', 'never'],
    },
  },
)
