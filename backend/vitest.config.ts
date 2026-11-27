import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // The include below also runs every file under test/unit/, so those files need the setup file that
        // vitest.unit.config.ts gives them: the reserved-word guard (PROJECTION-RESERVED-1). Without it,
        // projection-reserved-1.test.ts fails here (CI-LOCKFILE-1). The guard needs no AWS; it only adds an
        // expression check to the command constructors. Why the staging suites here are expected to be unaffected:
        // docs/slices/ci-lockfile-1.md, section "Is the guard safe for the staging suites?".
        setupFiles: ['./test/setup.ts', './test/unit/dynamo-reserved-setup.ts'],
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        alias: {
            '@amodx/shared': path.resolve(__dirname, '../packages/shared/src/index.ts')
        }
    },
});
