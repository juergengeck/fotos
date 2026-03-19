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
            // meaning.core needs directory alias (sub-path imports like /vector-index/HNSWIndex.js)
            {find: /^@refinio\/meaning\.core\/(.*)$/, replacement: path.resolve(__dirname, '../meaning.core/src/$1')},
            {find: '@refinio/meaning.core', replacement: path.resolve(__dirname, '../meaning.core/src/index.ts')},
        ]
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            // Workspace deps used only in Node.js code paths (ONE.core recipes)
            // that are tree-shaken away in the browser build — safe to externalize
            external: [
                /^@refinio\/one\.core/,
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
