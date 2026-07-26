import { defineConfig } from 'vitest/config';
import * as path from 'path';

/**
 * Pure unit tests — no AWS, no credentials, no DynamoDB.
 *
 * Separate from `vitest.config.ts` because that config loads `test/setup.ts`, which
 * requires `.env.test` + a live staging `TABLE_NAME` and whose suites mutate real staging
 * data. Tests under `test/unit/` must be runnable by anyone, in CI, on a laptop, with no
 * AWS account — so they get a config with **no `setupFiles`**.
 *
 * Run: `npm run test:unit` (from `backend/`).
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/unit/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        alias: {
            '@amodx/shared': path.resolve(__dirname, '../packages/shared/src/index.ts')
        }
    },
});
