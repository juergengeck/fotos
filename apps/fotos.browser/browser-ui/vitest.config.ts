import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    define: {
        __APP_BUILD_ID__: JSON.stringify('current-build'),
    },
    resolve: {
        dedupe: ['react', 'react-dom', '@refinio/one.core', '@refinio/one.models'],
        alias: [
            {find: '@', replacement: path.resolve(__dirname, 'src')},
        ],
    },
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        testTimeout: 30_000,
    },
});
