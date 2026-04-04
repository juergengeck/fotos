import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: [
            {find: '@', replacement: path.resolve(__dirname, 'src')},
            {find: '@refinio/recovery.core', replacement: path.resolve(__dirname, '../../../vger/packages/recovery.core/dist')},
        ],
    },
    test: {
        include: ['src/**/*.test.ts'],
        testTimeout: 30_000,
    },
});
