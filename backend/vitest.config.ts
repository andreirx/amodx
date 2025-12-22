import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./test/setup.ts'],
        include: ['**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        alias: {
            '@amodx/shared': path.resolve(__dirname, '../packages/shared/src/index.ts')
        }
    },
});
