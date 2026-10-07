import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

// Isolate the real controls from folder sync and identity setup.
for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: Glue gallery dock hold, drag, cancellation, keyboard, and resize`, { timeout: 60000 }, async () => {
  const server = await createServer({
    configFile: false, root: process.cwd(), logLevel: 'error', cacheDir: 'node_modules/.vite-gallery-scroll-test',
    esbuild: { jsx: 'automatic' },
    server: { port: 0 }, optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
    plugins: [{ name: 'scroll-fixture', configureServer(server) {
      server.middlewares.use('/scroll-fixture', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
      });
    }, resolveId(id) { if (id === '/fixture.jsx') return `${process.cwd()}/fixture.jsx`; },
    load(id) { if (id === `${process.cwd()}/fixture.jsx`) return `
      import '/src/index.css';
      import React, {useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {TimelineScrubber} from '/src/components/TimelineScrubber.tsx';
      function Fixture() {
        const ref = useRef(null);
        const groups = [{date:'2026-10-02',photos:[{}]}, {date:'2024-01-01',photos:[{}]}];
        return <div style={{height:'100vh',position:'relative',display:'flex',flexDirection:'column'}}>
          <header style={{height:56,flexShrink:0}}>Gallery view</header>
          <div ref={ref} id="scroller" style={{flex:1,minHeight:0,overflowY:'auto'}}><main>
            <section data-date="2026-10-02" style={{height:900}}>newer</section>
            <section data-date="2024-01-01" style={{height:1400}}>older</section>
          </main></div><TimelineScrubber scrollRef={ref} dayGroups={groups} topInset={56}/>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `; } }],
  });
  let browser;
  try {
    await server.listen();
    browser = await browserType.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => console.error(error));
    await page.goto(`${server.resolvedUrls.local[0]}scroll-fixture`);
    const scroller = page.locator('#scroller');
    const slider = page.getByRole('slider', {name:'Gallery timeline'});
    await slider.waitFor();
    await scroller.evaluate(el => { el.scrollTop = 1000; });
    await page.waitForFunction(() => Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow')) > 55);
    assert.match(await slider.getAttribute('aria-valuetext'), /2024/);
    const initial = await scroller.evaluate(el => el.scrollTop);
    const button = page.getByRole('button', {name:'Scroll to top',exact:true});
    await button.hover();
    await page.mouse.down();
    await page.getByRole('button', {name:'Scrub gallery',exact:true}).waitFor();
    // The same captured button remains mounted when the hold timer fires.
    await page.mouse.move(950, 200);
    await page.mouse.up();
    assert.ok(await scroller.evaluate(el => el.scrollTop) < initial);
    const active = page.getByRole('button', {name:'Scrub gallery',exact:true});
    await active.press('End');
    await page.waitForFunction(() => document.querySelector('[role=slider]').getAttribute('aria-valuenow') === '100');
    await active.press('Home');
    assert.equal(await scroller.evaluate(el => el.scrollTop), 0);
    await scroller.evaluate(el => { el.scrollTop = 600; });
    await page.waitForFunction(() => Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow')) > 30);
    const beforeCancel = await scroller.evaluate(el => el.scrollTop);
    const bounds = await active.boundingBox();
    await page.mouse.move(bounds.x+22, bounds.y+22);
    await page.mouse.down();
    await page.mouse.move(bounds.x+22, bounds.y+60);
    await active.dispatchEvent('pointercancel', {pointerId:1,pointerType:'mouse',isPrimary:true});
    await page.mouse.up();
    assert.equal(await scroller.evaluate(el => el.scrollTop), beforeCancel);
    await slider.press('End');
    assert.equal(await scroller.evaluate(el => el.scrollTop), 1656);
    await slider.press('Home');
    assert.equal(await scroller.evaluate(el => el.scrollTop), 0);
    for (const viewport of [{width:700,height:390},{width:390,height:700}]) {
      await page.setViewportSize(viewport);
      const dock = await page.locator('[data-feed-scrub-dock]').boundingBox();
      const track = await page.locator('[data-feed-scrub-track]').boundingBox();
      assert.ok(track.y >= 72, 'dock clears gallery toolbar');
      assert.ok(dock.y >= track.y-1 && dock.y+dock.height <= track.y+track.height+1);
    }
    await active.click(); // tap exits scrub mode without jumping
    await page.getByRole('button', {name:'Scroll to top',exact:true}).waitFor();
    await scroller.evaluate(el => {el.scrollTop = 500;});
    await page.getByRole('button', {name:'Scroll to top',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#scroller').scrollTop === 0);
  } finally { await browser?.close(); await server.close(); }
});
