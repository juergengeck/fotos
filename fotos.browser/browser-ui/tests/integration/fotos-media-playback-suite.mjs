import {mkdtemp, readFile, realpath, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(testDirectory, '../..');
const sourceRoot = resolve(uiRoot, 'src');
const oneRoot = resolve(uiRoot, '../../../one');
const harnessRoot = await realpath(await mkdtemp(resolve(tmpdir(), 'fotos-media-playback-')));

function generatedAnimatedGif() {
    const ascii = text => Array.from(text, character => character.charCodeAt(0));
    const graphicControl = [0x21, 0xf9, 0x04, 0x00, 0x0c, 0x00, 0x00, 0x00];
    const image = colorCode => [
        0x2c,
        0, 0, 0, 0,
        1, 0, 1, 0,
        0,
        2,
        2, colorCode, 0x01,
        0,
    ];
    return Uint8Array.from([
        ...ascii('GIF89a'),
        1, 0, 1, 0,
        0x80, 0, 0,
        255, 0, 0,
        0, 0, 255,
        0x21, 0xff, 0x0b, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0,
        ...graphicControl, ...image(0x44),
        ...graphicControl, ...image(0x4c),
        0x3b,
    ]);
}

const fixturePath = process.env.FOTOS_GIF_FIXTURE;
const fixture = fixturePath ? await readFile(fixturePath) : generatedAnimatedGif();
await mkdir(resolve(harnessRoot, 'public'));
await mkdir(resolve(harnessRoot, 'src'));
await writeFile(resolve(harnessRoot, 'public', 'animation.gif'), fixture);
await writeFile(resolve(harnessRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
await writeFile(resolve(harnessRoot, 'src', 'main.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TimedMediaPlayer} from ${JSON.stringify(resolve(sourceRoot, 'components/TimedMediaPlayer.tsx'))};

function App() {
    const [size, setSize] = React.useState('loading');
    React.useEffect(() => {
        void (async () => {
            const {ingestFiles} = await import(${JSON.stringify(resolve(sourceRoot, 'lib/browserIngest.ts'))});
            const original = await (await fetch('/animation.gif')).arrayBuffer();
            const entries = await ingestFiles([new File([original], 'animation.gif', {type: 'image/gif', lastModified: 1})]);
            const entry = entries[0];
            const stored = await (await fetch(entry.objectUrl)).arrayBuffer();
            const thumbnail = await (await fetch(entry.thumb)).blob();
            const digest = await crypto.subtle.digest('SHA-256', original);
            const expectedHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            window.__ingestEvidence = {
                mimeType: entry.mimeType,
                hashMatches: entry.hash === expectedHash,
                originalMatches: original.byteLength === stored.byteLength &&
                    new Uint8Array(original).every((byte, index) => byte === new Uint8Array(stored)[index]),
                thumbnailType: thumbnail.type,
                thumbnailSize: thumbnail.size,
            };
        })();
    }, []);
    return <main style={{width: 640, height: 480, position: 'relative', background: '#111'}}>
        <div id="size">{size}</div>
        <TimedMediaPlayer
            src="/animation.gif"
            name="animation.gif"
            mediaStyle={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) scale(4)'}}
            onReady={(width, height) => setSize(width + 'x' + height)}
        />
    </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
`);

const server = await createServer({
    root: harnessRoot,
    logLevel: 'error',
    resolve: {
        alias: [
            {find: '@', replacement: sourceRoot},
            {find: '@refinio/media.core', replacement: resolve(oneRoot, 'packages/media.core/dist')},
            {find: 'react', replacement: resolve(uiRoot, 'node_modules/react')},
            {find: 'react-dom', replacement: resolve(uiRoot, 'node_modules/react-dom')},
            {find: 'lucide-react', replacement: resolve(uiRoot, 'node_modules/lucide-react')},
        ],
    },
    server: {
        host: '127.0.0.1',
        port: 0,
        fs: {allow: [harnessRoot, resolve(uiRoot, '../..'), oneRoot]},
    },
});

let browser;
try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a test port');

    browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`, {waitUntil: 'networkidle'});
    await page.waitForSelector('canvas[aria-label="Animated image: animation.gif"]');
    await page.waitForFunction(() => document.querySelector('#size')?.textContent !== 'loading');
    await page.waitForFunction(() => window.__ingestEvidence?.thumbnailSize > 0);
    const ingest = await page.evaluate(() => window.__ingestEvidence);
    if (ingest.mimeType !== 'image/gif' || !ingest.hashMatches || !ingest.originalMatches ||
        ingest.thumbnailType !== 'image/jpeg' || ingest.thumbnailSize <= 0) {
        throw new Error(`GIF ingest evidence failed: ${JSON.stringify(ingest)}`);
    }

    const pixels = () => page.locator('canvas').evaluate(canvas =>
        Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data),
    );
    const first = await pixels();
    await page.waitForFunction(previous => {
        const canvas = document.querySelector('canvas');
        const current = Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
        return JSON.stringify(previous) !== JSON.stringify(current);
    }, first, {timeout: 3_000});

    await page.getByRole('button', {name: 'Pause animated image'}).click();
    const paused = await pixels();
    await page.waitForTimeout(180);
    if (JSON.stringify(paused) !== JSON.stringify(await pixels())) {
        throw new Error('Pause did not hold the current GIF frame');
    }

    const range = page.locator('input[aria-label="Animated image position"]');
    const duration = Number(await range.getAttribute('max'));
    const seekTo = async value => range.evaluate((input, nextValue) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, String(nextValue));
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    }, value);
    await seekTo(1);
    const startFrame = await pixels();
    await seekTo(duration * 0.75);
    if (JSON.stringify(startFrame) === JSON.stringify(await pixels())) {
        throw new Error('Seeking did not redraw the requested GIF frame');
    }

    const loopButton = page.locator('button[aria-label$="animated image looping"]');
    if (await loopButton.getAttribute('aria-pressed') === 'false') {
        await loopButton.click();
        if (await loopButton.getAttribute('aria-pressed') !== 'true') {
            throw new Error('Loop toggle did not enable looping');
        }
    }
    await loopButton.click();
    if (await loopButton.getAttribute('aria-pressed') !== 'false') {
        throw new Error('Loop toggle did not disable looping');
    }
    await seekTo(0);
    await page.getByRole('button', {name: 'Play animated image'}).click();
    await page.waitForTimeout(duration + 100);
    await page.getByRole('button', {name: 'Play animated image'}).waitFor();

    console.log(JSON.stringify({
        fixture: fixturePath ?? 'generated two-frame GIF',
        dimensions: await page.locator('#size').textContent(),
        durationMs: duration,
        ingest,
        advanced: true,
        paused: true,
        sought: true,
        stoppedWithoutLoop: true,
    }));
} finally {
    await browser?.close();
    await server.close();
    await rm(harnessRoot, {recursive: true, force: true});
}
