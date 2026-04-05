import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    define: {
        __APP_BUILD_ID__: JSON.stringify('current-build'),
    },
    resolve: {
        alias: [
            {find: '@', replacement: path.resolve(__dirname, 'src')},
            {find: '@refinio/fotos.ui', replacement: path.resolve(__dirname, '../../fotos.ui/src/index.ts')},
            {find: '@refinio/recovery.core', replacement: path.resolve(__dirname, '../../../vger/packages/recovery.core/dist')},
        ],
    },
    test: {
        include: ['src/**/*.test.ts'],
        testTimeout: 30_000,
    },
});
