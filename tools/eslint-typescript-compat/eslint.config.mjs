import { createRequire } from 'node:module';
import plugin from '@typescript-eslint/eslint-plugin';

const requireFromPlugin = createRequire(import.meta.resolve('@typescript-eslint/eslint-plugin'));
const parser = requireFromPlugin('@typescript-eslint/parser');

export { parser, plugin };
