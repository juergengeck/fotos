import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const root = path.resolve(process.cwd(), 'dist');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=', 'base64');
const hash = createHash('sha256').update(image).digest('hex');
const legacyIndex = `<!DOCTYPE html><html><head><meta name="generator" content="fotos.one browser-ingest"></head><body><article class="fs-node" data-scanned="2026-10-02T00:00:00Z"><table><tr class="fs-entry" data-mime="image/png" data-hash="${hash}" data-thumb="thumb.png" data-face-count="0" data-exif-date="2026-10-02" data-preserve="existing-metadata"><td class="fs-name"><a href="../photo.png">photo.png</a></td><td class="fs-size">rounded display size</td></tr></table></article></body></html>`;

test('production app restores a pre-update library, migrates exact sizes, and survives reload', {timeout:90000}, async () => {
    const server = createServer(async (request, response) => {
        try {
            let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            if (name === '/') name = '/index.html';
            const file = path.resolve(root, `.${name}`);
            if (!file.startsWith(`${root}/`)) {response.writeHead(403);response.end();return;}
            const data = await readFile(file);
            response.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)] ?? 'application/octet-stream');
            response.end(data);
        } catch {response.writeHead(404);response.end();}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({headless:true});
    try {
        const page = await browser.newPage();
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
        await page.goto(process.env.FOTOS_RESTORE_TEST_URL ?? `http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Open photo folder',exact:true}).waitFor({timeout:45000});
        await page.evaluate(async ({image,html})=>{
            const storage=await navigator.storage.getDirectory();
            const library=await storage.getDirectoryHandle('restore-regression',{create:true});
            const one=await library.getDirectoryHandle('one',{create:true});
            for (const [dir,name,content] of [[library,'photo.png',new Uint8Array(image)],[one,'thumb.png',new Uint8Array(image)],[one,'index.html',html]]) {
                const handle=await dir.getFileHandle(name,{create:true});
                const writer=await handle.createWritable();
                await writer.write(content);
                await writer.close();
            }
            const db=await new Promise((resolve,reject)=>{
                const request=indexedDB.open('fotos-prefs',1);
                request.onupgradeneeded=()=>request.result.createObjectStore('handles');
                request.onsuccess=()=>resolve(request.result);
                request.onerror=()=>reject(request.error);
            });
            const preference={kind:'opfs',path:['restore-regression'],label:'Restored library'};
            await new Promise((resolve,reject)=>{
                const tx=db.transaction('handles','readwrite');
                tx.objectStore('handles').put([{id:'restore-regression',preference}],'folders');
                tx.objectStore('handles').put(preference,'lastFolder');
                tx.oncomplete=resolve;
                tx.onerror=()=>reject(tx.error);
            });
            db.close();
        },{image:[...image],html:legacyIndex});
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Show images fullscreen',exact:true}).waitFor({timeout:20000});
        await page.getByText('Scanning one/ folders...', {exact:true}).waitFor({state:'hidden',timeout:20000});
        const migrated=await page.evaluate(async ()=>{
            const library=await (await navigator.storage.getDirectory()).getDirectoryHandle('restore-regression');
            const one=await library.getDirectoryHandle('one');
            return await (await (await one.getFileHandle('index.html')).getFile()).text();
        });
        assert.ok(migrated.includes(`data-size-bytes="${image.length}"`));
        assert.ok(migrated.includes('data-preserve="existing-metadata"'));
        assert.ok(migrated.includes('data-face-count="0"'));
        await page.getByRole('button',{name:'Show images fullscreen',exact:true}).click();
        await page.getByRole('button',{name:'Open photo.png',exact:true}).waitFor();
        await page.getByRole('button',{name:'Exit fullscreen images',exact:true}).click();
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Show images fullscreen',exact:true}).waitFor({timeout:20000});
        // A failed original read must show a useful error and finish loading.
        await page.evaluate(async html=>{
            const library=await (await navigator.storage.getDirectory()).getDirectoryHandle('restore-regression');
            const one=await library.getDirectoryHandle('one');
            const writer=await (await one.getFileHandle('index.html')).createWritable();
            await writer.write(html);
            await writer.close();
            await library.removeEntry('photo.png');
        },legacyIndex);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('alert').filter({hasText:'could not read original “photo.png”'}).waitFor({timeout:20000});
        await page.getByText('Scanning one/ folders...', {exact:true}).waitFor({state:'hidden',timeout:20000});
        assert.deepEqual(errors,[]);
    } finally {
        await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
});
