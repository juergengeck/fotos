import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';
import { fotosApiPlugin } from './vite-plugin-fotos-api';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DEV_API_PROXY_TARGET = process.env.VITE_HEADLESS_URL || 'https://api.glue.one';

/** Vite plugin that serves local photos and provides a scan API */
function localPhotosPlugin(): Plugin {
    const PHOTO_ROOTS = [
        path.join(os.homedir(), 'Downloads'),
        path.join(os.homedir(), 'Pictures'),
    ];
    const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tiff', '.gif']);

    function scanDir(dir: string, maxDepth: number, depth = 0): string[] {
        if (depth > maxDepth) return [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const results: string[] = [];
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                const full = path.join(dir, entry.name);
                if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
                    results.push(full);
                } else if (entry.isDirectory() && depth < maxDepth) {
                    results.push(...scanDir(full, maxDepth, depth + 1));
                }
            }
            return results;
        } catch { return []; }
    }

    return {
        name: 'local-photos',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                // Catalog API: load trie-managed catalog if it exists
                if (req.url?.startsWith('/api/catalog')) {
                    (async () => {
                        try {
                            const { loadCatalog } = await import('../../one.fotos/dist/catalog.js');
                            const catalogDir = process.env.FOTOS_DIR || os.homedir();
                            const catalog = await loadCatalog(catalogDir);
                            const entries = catalog.trie.allEntries();
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({
                                name: catalog.name,
                                device: catalog.device,
                                syncRoot: await catalog.trie.syncRoot(),
                                photos: entries,
                            }));
                        } catch (e: any) {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ photos: [], error: e.message }));
                        }
                    })();
                    return;
                }

                // Date-range query API: /api/query?from=2025-08-01&to=2025-08-31
                if (req.url?.startsWith('/api/query')) {
                    (async () => {
                        try {
                            const url = new URL(req.url!, `http://${req.headers.host}`);
                            const from = url.searchParams.get('from');
                            const to = url.searchParams.get('to');
                            if (!from || !to) {
                                res.statusCode = 400;
                                res.end(JSON.stringify({ error: 'from and to params required' }));
                                return;
                            }
                            const { loadCatalog } = await import('../../one.fotos/dist/catalog.js');
                            const catalogDir = process.env.FOTOS_DIR || os.homedir();
                            const catalog = await loadCatalog(catalogDir);
                            const photos = catalog.trie.queryDateRange(new Date(from), new Date(to));
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ photos }));
                        } catch (e: any) {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ photos: [], error: e.message }));
                        }
                    })();
                    return;
                }

                // Scan API: list available photos
                if (req.url === '/api/scan') {
                    const photos: { name: string; path: string; size: number; mtime: string; dir: string }[] = [];
                    for (const root of PHOTO_ROOTS) {
                        const files = scanDir(root, 2);
                        for (const f of files) {
                            try {
                                const stat = fs.statSync(f);
                                photos.push({
                                    name: path.basename(f),
                                    path: f,
                                    size: stat.size,
                                    mtime: stat.mtime.toISOString(),
                                    dir: path.basename(path.dirname(f)),
                                });
                            } catch { /* skip */ }
                        }
                    }
                    // Sort by mtime desc, limit to 500
                    photos.sort((a, b) => b.mtime.localeCompare(a.mtime));
                    const limited = photos.slice(0, 500);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(limited));
                    return;
                }

                // Serve photo files: /photos/<base64-encoded-path>
                if (req.url?.startsWith('/photos/')) {
                    const encoded = req.url.slice('/photos/'.length).split('?')[0];
                    try {
                        const filePath = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf-8');
                        // Security: must be under one of the photo roots
                        const resolved = path.resolve(filePath);
                        const allowed = PHOTO_ROOTS.some(r => resolved.startsWith(r));
                        if (!allowed) { res.statusCode = 403; res.end('Forbidden'); return; }
                        if (!fs.existsSync(resolved)) { res.statusCode = 404; res.end('Not found'); return; }

                        const ext = path.extname(resolved).toLowerCase();
                        const mimeMap: Record<string, string> = {
                            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                            '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
                            '.tiff': 'image/tiff',
                        };
                        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
                        res.setHeader('Cache-Control', 'public, max-age=3600');
                        fs.createReadStream(resolved).pipe(res);
                    } catch { res.statusCode = 400; res.end('Bad request'); }
                    return;
                }

                next();
            });
        }
    };
}

export default defineConfig({
    base: '/',
    clearScreen: false,
    plugins: [
        react(),
        nodePolyfills(),
        localPhotosPlugin(),
        fotosApiPlugin(),
        VitePWA({
            registerType: 'prompt',
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            manifest: {
                name: 'fotos.one',
                short_name: 'fotos',
                description: 'Photo management with face recognition',
                start_url: '/',
                display: 'standalone',
                background_color: '#111111',
                theme_color: '#111111',
                icons: [
                    { src: '/cam.svg', sizes: 'any', type: 'image/svg+xml' },
                    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
                ],
                share_target: {
                    action: '/_share',
                    method: 'POST',
                    enctype: 'multipart/form-data',
                    params: {
                        files: [{ name: 'photos', accept: ['image/*'] }],
                    },
                } as any,
            },
            injectManifest: {
                globPatterns: ['**/*.{js,css,svg,png,woff2}'],
            },
        }),
    ],
    resolve: {
        alias: [
            {find: '@', replacement: path.resolve(__dirname, './src')},
            {find: '@refinio/fotos.ui', replacement: path.resolve(__dirname, '../../fotos.ui/src/index.ts')},
            {find: '@refinio/local.core/BrowserMultimodalEmbeddingProvider.js', replacement: path.resolve(__dirname, '../../../vger/packages/local.core/dist/BrowserMultimodalEmbeddingProvider.js')},
            {find: '@huggingface/transformers', replacement: path.resolve(__dirname, '../../../vger/node_modules/.pnpm/node_modules/@huggingface/transformers/dist/transformers.web.js')},
            {find: '@vger/vger.core', replacement: path.resolve(__dirname, '../../../vger/packages/vger.core/dist')},
            {find: '@vger/vger.glue', replacement: path.resolve(__dirname, '../../../vger/packages/vger.glue/dist')},
            // Stub out Node-only modules that ONE.core dependency tree pulls in
            {find: '@anthropic-ai/sdk', replacement: path.resolve(__dirname, './src/stubs/empty.ts')},
            {find: '@whiskeysockets/baileys', replacement: path.resolve(__dirname, './src/stubs/empty.ts')},
            {find: '@whiskeysockets/libsignal-node', replacement: path.resolve(__dirname, './src/stubs/empty.ts')},
            {find: 'werift', replacement: path.resolve(__dirname, './src/stubs/empty.ts')},
            // nodePolyfills plugin injects shim imports that Rollup can't resolve for pre-built deps
            {find: 'vite-plugin-node-polyfills/shims/buffer', replacement: path.resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js')},
            {find: 'vite-plugin-node-polyfills/shims/process', replacement: path.resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js')},
        ],
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        dedupe: ['react', 'react-dom', '@refinio/one.core', '@refinio/one.models'],
    },
    define: {
        global: 'globalThis',
        'process.env': {},
        'process.version': '"v20.0.0"',
        'process.platform': '"browser"',
    },
    optimizeDeps: {
        entries: ['src/workers/face.worker.ts', 'src/workers/semantic.worker.ts'],
        include: [
            'react',
            'react-dom',
            'tweetnacl',
        ],
        exclude: ['onnxruntime-web'],
    },
    worker: {
        format: 'es',
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            external: ['ws'],
        },
    },
    server: {
        port: 5188,
        strictPort: true,
        open: true,
        proxy: {
            '/api': {
                target: DEV_API_PROXY_TARGET,
                changeOrigin: true,
                secure: true,
            },
        },
    }
});
