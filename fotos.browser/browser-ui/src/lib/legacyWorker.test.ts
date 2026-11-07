import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('retires the root worker and moves old app windows without touching user storage', async () => {
    const handlers = new Map<string, (event: any) => void>();
    const root = {url: 'https://fotos.one/?photo=a#invite', navigate: vi.fn()};
    const invite = {url: 'https://fotos.one/invites/inviteDevice?invited=true#token', navigate: vi.fn()};
    const app = {url: 'https://fotos.one/app/', navigate: vi.fn()};
    const unregister = vi.fn();
    runInNewContext(readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), {
        URL, self: {addEventListener: (type: string, handler: any) => handlers.set(type, handler),
            registration: {unregister}, clients: {matchAll: async () => [root, invite, app]}},
    });
    let completion: Promise<void> | undefined;
    handlers.get('activate')!({waitUntil: (promise: Promise<void>) => {completion = promise;}});
    await completion;
    expect(unregister).toHaveBeenCalledOnce();
    expect(root.navigate).toHaveBeenCalledWith('https://fotos.one/app/?photo=a#invite');
    expect(invite.navigate).toHaveBeenCalledWith('https://fotos.one/app/invites/inviteDevice?invited=true#token');
    expect(app.navigate).not.toHaveBeenCalled();
});
