import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    base: '/fotos/',
    clearScreen: false,
    plugins: [react()],
    resolve: {
        alias: [
            {find: '@', replacement: path.resolve(__dirname, './src')},
            {find: '@refinio/fotos.ui', replacement: path.resolve(__dirname, '../fotos.ui/src/index.ts')},
            {find: '@refinio/fotos.core/faces', replacement: path.resolve(__dirname, '../fotos.core/src/faces.ts')},
            {find: '@refinio/fotos.core', replacement: path.resolve(__dirname, '../fotos.core/src/index.ts')},
            {find: '@refinio/trie.core', replacement: path.resolve(__dirname, '../trie.core/src/index.ts')},
            {find: /^@refinio\/meaning\.core\/(.*)$/, replacement: path.resolve(__dirname, '../meaning.core/src/$1')},
            {find: '@refinio/meaning.core', replacement: path.resolve(__dirname, '../meaning.core/src/index.ts')},
            // Browser shim for one.core crypto (used by trie.core/hash.ts)
            {find: '@refinio/one.core/lib/system/crypto-helpers.js', replacement: path.resolve(__dirname, './src/shims/crypto-helpers.ts')},
            // Externalize remaining one.core imports (type-only, tree-shaken)
            {find: /^@refinio\/one\.core/, replacement: path.resolve(__dirname, './src/shims/empty.ts')},
        ]
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            external: [
                /^node:/,
                'sharp',
            ],
        },
    },
    server: {
        port: 5189,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:3000',
                ws: true,
            },
            '/fotos': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
