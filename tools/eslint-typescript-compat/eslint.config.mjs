/**
 * Pins the TypeScript toolchain used for *linting* only.
 *
 * Why this exists: the workspace compiles with typescript@^7, but
 * typescript-eslint 8.x declares a peer range that stops at TypeScript 5.x and
 * refuses to load against 7. Rather than drop TypeScript linting entirely, this
 * package vendors its own typescript@5.9.3 + @typescript-eslint@8.64.0 so ESLint
 * parses with a supported pair while `tsc` keeps building with 7.
 *
 * Consequences: the linter's view of the language is one major version behind
 * the compiler's. TypeScript 7-only syntax will fail to parse here even though
 * it builds fine. Type-aware rules (see the control-plane block in the root
 * eslint.config.mjs) run against the 5.9 checker.
 *
 * Exit condition: delete this package and depend on @typescript-eslint directly
 * once it ships a release whose peer range accepts TypeScript 7. Track at
 * https://github.com/typescript-eslint/typescript-eslint/issues — then remove
 * the `@agent-command/eslint-typescript-compat` devDependency from the root
 * package.json and the `COPY tools/eslint-typescript-compat/` lines from
 * deploy/Dockerfile.*.base.
 */
import { createRequire } from 'node:module';
import plugin from '@typescript-eslint/eslint-plugin';

const requireFromPlugin = createRequire(import.meta.resolve('@typescript-eslint/eslint-plugin'));
const parser = requireFromPlugin('@typescript-eslint/parser');

export { parser, plugin };
