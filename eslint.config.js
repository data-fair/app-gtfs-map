import neostandard from 'neostandard'
import pluginVue from 'eslint-plugin-vue'
import pluginVuetify from 'eslint-plugin-vuetify'
import dfLibRecommended from '@data-fair/lib-utils/eslint/recommended.js'

// the flat/base config of eslint-plugin-vuetify already registers the `vue` plugin and
// ESLint 9.39+ refuses a redefined plugin: drop `plugins` from the vue config.
const vueFlatRecommended = pluginVue.configs['flat/recommended'].map(({ plugins, ...rest }) => rest)

export default [
  ...dfLibRecommended,
  ...vueFlatRecommended,
  ...pluginVuetify.configs['flat/recommended'],
  ...neostandard({ ts: true, env: ['browser'] }),
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      'no-undef': 'off' // typescript s'en charge
    }
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: '@typescript-eslint/parser' } }
  },
  { ignores: ['dist/', 'node_modules/', 'src/config/.type/', 'tests/output/'] }
]
