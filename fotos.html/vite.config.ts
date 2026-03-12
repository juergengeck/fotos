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
            {find: '@refinio/fotos.ui', replacement: path.resolve(__dirname, '../fotos.ui/src/index.ts')}
        ]
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true
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
