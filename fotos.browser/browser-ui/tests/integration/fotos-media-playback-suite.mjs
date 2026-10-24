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
import {PhotoGrid} from ${JSON.stringify(resolve(sourceRoot, 'components/PhotoGrid.tsx'))};
import {FullscreenGallery} from ${JSON.stringify(resolve(sourceRoot, 'components/FullscreenGallery.tsx'))};
import ${JSON.stringify(resolve(sourceRoot, 'index.css'))};

const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="teal"/></svg>');
const photos = [
    {hash: 'gif', name: 'animation.gif', sourcePath: 'animation.gif', mimeType: 'image/gif'},
    {hash: 'video', name: 'clip.webm', sourcePath: 'clip.webm', mimeType: 'video/webm'},
].map(photo => ({...photo, managed: 'reference', tags: [], addedAt: '2026-10-23', size: 1, exif: {width: 320, height: 180}}));
const dayGroups = [{date: '2026-10-23', photos}];
window.__sourceRequests = [];
window.__openedPhotos = [];
const getThumbUrl = async () => poster;
const getFileUrl = async path => {
    window.__sourceRequests.push(path);
    return path === 'clip.webm' ? window.__videoUrl : '/animation.gif';
};
const openPhoto = index => window.__openedPhotos.push(index);

function App() {
    const [size, setSize] = React.useState('loading');
    const [mode, setMode] = React.useState('standalone');
    const scrollRef = React.useRef(null);
    React.useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        context.fillStyle = 'red';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, {mimeType: 'video/webm'});
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        recorder.onstop = () => {
            window.__videoUrl = URL.createObjectURL(new Blob(chunks, {type: 'video/webm'}));
            stream.getTracks().forEach(track => track.stop());
        };
        recorder.start();
        const changeFrame = setInterval(() => {
            context.fillStyle = context.fillStyle === '#ff0000' ? 'blue' : 'red';
            context.fillRect(0, 0, canvas.width, canvas.height);
        }, 100);
        const stop = setTimeout(() => {
            clearInterval(changeFrame);
            recorder.stop();
        }, 1_200);
        return () => {
            clearInterval(changeFrame);
            clearTimeout(stop);
            if (recorder.state !== 'inactive') recorder.stop();
            stream.getTracks().forEach(track => track.stop());
            if (window.__videoUrl) URL.revokeObjectURL(window.__videoUrl);
        };
    }, []);
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
    if (mode !== 'standalone') return <main style={{height: '100vh', display: 'flex', flexDirection: 'column', background: '#111'}}>
        <nav><button onClick={() => setMode('grid')}>Gallery cards</button><button onClick={() => setMode('fullscreen')}>Fullscreen cards</button></nav>
        <div id="card-scroller" ref={scrollRef} style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>
            {mode === 'grid' ? <PhotoGrid dayGroups={dayGroups} photos={photos} thumbScale={240} getThumbUrl={getThumbUrl} getFileUrl={getFileUrl} onPhotoClick={openPhoto}/>
                : <FullscreenGallery dayGroups={dayGroups} scrollRef={scrollRef} getThumbUrl={getThumbUrl} getFileUrl={getFileUrl} onPhotoClick={openPhoto}/>}
            <div style={{height: 1_200}}/>
        </div>
    </main>;
    return <main style={{width: 640, height: 480, position: 'relative', background: '#111'}}>
        <nav><button onClick={() => setMode('grid')}>Gallery cards</button></nav>
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
    esbuild: {jsx: 'automatic'},
    css: {postcss: uiRoot},
    resolve: {
        alias: [
            {find: '@', replacement: sourceRoot},
            {find: '@refinio/media.core', replacement: resolve(oneRoot, 'packages/media.core/dist')},
            {find: 'react', replacement: resolve(uiRoot, 'node_modules/react')},
            {find: 'react-dom', replacement: resolve(uiRoot, 'node_modules/react-dom')},
            {find: 'lucide-react', replacement: resolve(uiRoot, 'node_modules/lucide-react')},
            {find: '@refinio/fotos.ui', replacement: resolve(uiRoot, '../../fotos.ui/src/index.ts')},
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
    const page = await browser.newPage({viewport: {width: 1_000, height: 700}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
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

    const dimensions = await page.locator('#size').textContent();
    await page.waitForFunction(() => Boolean(window.__videoUrl));
    const inlineEvidence = [];
    for (const surface of ['Gallery cards', 'Fullscreen cards']) {
        await page.getByRole('button', {name: surface, exact: true}).click();
        await page.getByRole('button', {name: 'Play animation.gif', exact: true}).waitFor();
        await page.evaluate(() => { window.__sourceRequests = []; });
        if (await page.locator('video, canvas').count() !== 0) {
            throw new Error(`${surface}: idle cards mounted a player`);
        }
        await page.getByRole('button', {name: 'Play animation.gif', exact: true}).click();
        await page.locator('canvas[aria-label="Animated image: animation.gif"]').waitFor();
        if (JSON.stringify(await page.evaluate(() => window.__sourceRequests)) !== '["animation.gif"]') {
            throw new Error(`${surface}: playback fetched an unrelated original`);
        }
        await page.getByRole('button', {name: 'Pause animated image', exact: true}).click();
        const inlinePaused = await pixels();
        await page.waitForTimeout(180);
        if (JSON.stringify(inlinePaused) !== JSON.stringify(await pixels())) {
            throw new Error(`${surface}: inline GIF did not pause`);
        }
        await page.getByRole('button', {name: 'Play clip.webm', exact: true}).click();
        await page.locator('video').waitFor();
        await page.waitForFunction(() => {
            const video = document.querySelector('video');
            return video?.videoWidth === 320 && video.currentTime > 0;
        });
        if (await page.locator('canvas').count() !== 0) {
            throw new Error(`${surface}: previous GIF kept decoding after another card started`);
        }
        const video = page.locator('video');
        if (!await video.evaluate(element => element.controls && element.playsInline)) {
            throw new Error(`${surface}: video lacks native inline controls`);
        }
        if (process.env.FOTOS_MEDIA_SCREENSHOT) {
            await page.screenshot({path: `${process.env.FOTOS_MEDIA_SCREENSHOT}-${surface.startsWith('Gallery') ? 'grid' : 'fullscreen'}.png`});
        }
        await video.evaluate(element => element.pause());
        await video.evaluate(element => { element.currentTime = 0.1; });
        await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 0.1) < 0.05);
        await video.focus();
        await page.keyboard.press('ArrowRight');
        if ((await page.evaluate(() => window.__openedPhotos)).length !== 0) {
            throw new Error(`${surface}: player interaction opened the viewer`);
        }
        if (await page.locator('button button, button video, button input').count() !== 0) {
            throw new Error(`${surface}: player controls are nested in a card button`);
        }
        await page.getByRole('button', {name: 'Stop clip.webm', exact: true}).click();
        if (await page.locator('video, canvas').count() !== 0) {
            throw new Error(`${surface}: stopping left a media player mounted`);
        }
        await page.getByRole('button', {name: 'Play animation.gif', exact: true}).click();
        await page.locator('canvas').waitFor();
        await page.locator('#card-scroller').evaluate(element => { element.scrollTop = element.scrollHeight; });
        await page.waitForFunction(() => document.querySelectorAll('canvas, video').length === 0);
        await page.locator('#card-scroller').evaluate(element => { element.scrollTop = 0; });
        await page.getByRole('button', {name: 'Open viewer: animation.gif', exact: true}).click();
        if (JSON.stringify(await page.evaluate(() => window.__openedPhotos)) !== '[0]') {
            throw new Error(`${surface}: explicit viewer action did not open the selected item`);
        }
        await page.evaluate(() => { window.__openedPhotos = []; });
        inlineEvidence.push({surface, gifPaused: true, videoDecoded: true, sought: true, singlePlayer: true, stoppedOffscreen: true});
    }
    if (pageErrors.length !== 0) throw new Error(`Browser errors: ${JSON.stringify(pageErrors)}`);

    console.log(JSON.stringify({
        fixture: fixturePath ?? 'generated two-frame GIF',
        dimensions,
        durationMs: duration,
        ingest,
        advanced: true,
        paused: true,
        sought: true,
        stoppedWithoutLoop: true,
        inlineEvidence,
    }));
} finally {
    await browser?.close();
    await server.close();
    await rm(harnessRoot, {recursive: true, force: true});
}
