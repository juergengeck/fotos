#!/usr/bin/env node
/** Read-only deployment checks. No production identity is registered or signed in. */
import {randomBytes} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium} from 'playwright';

const directory = fileURLToPath(new URL('./reports/glue-login-latest', import.meta.url));
mkdirSync(directory, {recursive: true});
const result = {scope: 'Live callback/audience readiness only; no successful production login claimed'};
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage();
  let apiRequests = 0;
  page.on('request', request => {if (request.url().startsWith('https://api.glue.one/')) apiRequests++;});
  const url = new URL('https://glue.one/one-auth.html');
  url.search = new URLSearchParams({client_id: 'https://fotos.one', nonce: randomBytes(32).toString('hex'),
    return_url: 'fotosone://glue-auth-result', response_mode: 'redirect'}).toString();
  await page.goto(url.toString());
  await page.waitForFunction(() => document.querySelector('#login-destination')?.textContent?.includes('https://fotos.one')
    || /Invalid|does not match/.test(document.querySelector('#loading')?.textContent || ''), undefined, {timeout: 15_000});
  result.consent = await page.evaluate(() => ({
    accepted: document.querySelector('#login-destination')?.textContent === 'Sign in to https://fotos.one',
    message: document.querySelector('#loading')?.textContent,
  }));
  result.consent.apiRequests = apiRequests;
  await page.screenshot({path: join(directory, 'expo-live-callback-rejection.png')});
  await context.close();
  result.audiences = [];
  for (const client of ['https://akte.one', 'https://fotos.one']) {
    const response = await fetch('https://api.glue.one/api/fedcm/assertion', {
      method: 'POST', headers: {Origin: 'https://glue.one', 'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: client, nonce: randomBytes(32).toString('hex'),
        response_mode: 'browser', native_client: 'true'}), signal: AbortSignal.timeout(15_000),
    });
    result.audiences.push({client, status: response.status, body: await response.json()});
  }
  // Anonymous callers must still be denied. A 400 invalid_request instead
  // means Fotos is refused before the normal authentication boundary.
  const fotos = result.audiences.find(value => value.client === 'https://fotos.one');
  result.passed = result.consent.accepted && fotos.status === 403 && fotos.body.error?.code === 'access_denied';
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  result.error = String(error); result.passed = false; process.exitCode = 1;
} finally {
  await browser.close();
  writeFileSync(join(directory, 'live-probe.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
