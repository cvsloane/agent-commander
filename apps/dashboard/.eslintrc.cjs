module.exports = {
  extends: ['../../.eslintrc.cjs', 'next/core-web-vitals'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'no-control-regex': 'off',
    'react/no-unescaped-entities': 'off',
    'prefer-const': 'off',
  },
};
