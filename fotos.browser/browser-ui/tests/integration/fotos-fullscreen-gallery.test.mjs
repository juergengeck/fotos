import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, webkit} from 'playwright';
import {createServer} from 'vite';
import path from 'node:path';

for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: fullscreen images, keyboard scrolling, and exit`, {timeout: 60000}, async () => {
    const server = await createServer({
        configFile: false, root: process.cwd(), logLevel: 'error',
        cacheDir: 'node_modules/.vite-fullscreen-gallery-test',
        resolve: {alias: {'@refinio/media.core': path.resolve(process.cwd(), '../../../one/packages/media.core/dist')}},
        esbuild: {jsx: 'automatic'},
        server: {port: 0}, optimizeDeps: {noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react']},
        plugins: [{name: 'fullscreen-fixture', configureServer(server) {
            server.middlewares.use('/fullscreen-fixture', (_req, res) => {
                res.setHeader('Content-Type', 'text/html');
                res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/fixture-fullscreen.jsx"></script></body></html>');
            });
        }, resolveId(id) {
            if (id === '/fixture-fullscreen.jsx') return `${process.cwd()}/fixture-fullscreen.jsx`;
        }, load(id) {
            if (id !== `${process.cwd()}/fixture-fullscreen.jsx`) return;
            return `
                import '/src/index.css';
                import React, {useEffect, useRef, useState} from 'react';
                import {createRoot} from 'react-dom/client';
                import {FullscreenGallery, FullscreenGalleryExit, GallerySurfaceSwitcher} from '/src/components/FullscreenGallery.tsx';
                import {handleFullscreenGalleryKey} from '/src/lib/fullscreenGalleryKeyboard.ts';
                const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="tomato"/></svg>');
                const photos = Array.from({length:6}, (_, index) => ({hash:String(index),name:'image-'+index+'.jpg',sourcePath:'media/'+index+'.jpg',managed:'reference',tags:[],addedAt:'2026-10-02',size:12,exif:{width:600,height:400}}));
                const groups = [{date:'2026-10-02',photos:photos.slice(0,3)}, {date:'2026-10-01',photos:photos.slice(3)}];
                window.sourceRequests = [];
                const getThumbUrl = async photo => photo.hash === '0' ? 'data:image/png;base64,invalid' : image;
                const getFileUrl = async path => {
                    window.sourceRequests.push(path);
                    // Original arrives after the deliberately broken thumbnail.
                    await new Promise(resolve => setTimeout(resolve, 80));
                    return image;
                };
                function Fixture() {
                    const ref = useRef(null);
                    const [fullscreen, setFullscreen] = useState(false);
                    useEffect(() => {
                        if (!fullscreen) return;
                        const key = event => {
                            handleFullscreenGalleryKey(event, ref.current);
                            if (event.key === 'Escape') setFullscreen(false);
                        };
                        window.addEventListener('keydown', key);
                        return () => window.removeEventListener('keydown', key);
                    }, [fullscreen]);
                    return <div style={{height:'100vh',position:'relative'}}>
                        {fullscreen ? <>
                            <div ref={ref} id="scroller" style={{height:'100%',overflowY:'auto'}}><FullscreenGallery dayGroups={groups} scrollRef={ref} getThumbUrl={getThumbUrl} getFileUrl={getFileUrl} onPhotoClick={index => window.openedPhoto = index}/></div>
                            <FullscreenGalleryExit onExit={() => setFullscreen(false)}/>
                        </> : <GallerySurfaceSwitcher fullscreen={false} onChange={setFullscreen}/>}
                    </div>;
                }
                createRoot(document.getElementById('root')).render(<Fixture/>);
            `;
        }}],
    });
    let browser;
    try {
        await server.listen();
        browser = await browserType.launch({headless: true});
        const page = await browser.newPage({viewport: {width: 1000, height: 700}});
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${server.resolvedUrls.local[0]}fullscreen-fixture`, {waitUntil: 'commit'});
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', {name: 'Show images fullscreen', exact: true}).click();
        await page.getByRole('button', {name: 'Exit fullscreen images', exact: true}).waitFor();
        await page.waitForFunction(() => {
            const img = document.querySelector('[data-photo-index="0"] img');
            return img?.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1';
        });
        const stream = page.locator('[data-fullscreen-gallery]');
        assert.equal(await stream.locator('section').count(), 2);
        assert.equal(await stream.locator('[data-photo-index="0"] span').count(), 0, 'Loaded image has no filename caption overlay');
        const bounds = await page.getByRole('button', {name: 'Open image-0.jpg', exact: true}).boundingBox();
        assert.equal(bounds.width, 1000);
        assert.ok(Math.abs(bounds.height - 1000 * 2 / 3) < 1, 'Uncropped image keeps its natural aspect ratio');
        assert.ok(await page.evaluate(() => window.sourceRequests.includes('media/0.jpg')));
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.photoIndex), '0');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.photoIndex), '1');
        assert.ok(await page.locator('#scroller').evaluate(el => el.scrollTop) > 0);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.openedPhoto), 1);
        await page.keyboard.press('Escape');
        await page.getByRole('button', {name: 'Show images fullscreen', exact: true}).waitFor();
        assert.equal(await stream.count(), 0);
        await page.getByRole('button', {name: 'Show images fullscreen', exact: true}).click();
        await page.getByRole('button', {name: 'Exit fullscreen images', exact: true}).click();
        await page.getByRole('button', {name: 'Show images fullscreen', exact: true}).waitFor();
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        await server.close();
    }
});
