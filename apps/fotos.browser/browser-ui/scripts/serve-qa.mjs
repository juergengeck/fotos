import {createServer} from 'vite';

// Keep integration actors on their loaded code while other workspace builds run.
// The HMR websocket remains available for the app-owned QA operation transport.
const port = Number(process.argv[2] ?? 5383);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Supply an unprivileged QA server port between 1024 and 65535');
}
const server = await createServer({
    cacheDir: `node_modules/.vite-qa-${port}`,
    server: {host: '127.0.0.1', port, strictPort: true, open: false},
    plugins: [{
        name: 'fotos-qa-stable-server',
        enforce: 'post',
        configResolved(config) {
            // Vite's config merge discards null overrides; set this after resolution.
            config.server.watch = null;
        },
    }],
});
if (server.config.server.watch !== null) throw new Error('QA server file watching must be disabled');
await server.listen();
server.printUrls();
console.log('QA file watching is disabled; restart this server after changing code.');

/** Close owned transports when the QA actor server is stopped. */
async function stop() {
    await server.close();
    process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
