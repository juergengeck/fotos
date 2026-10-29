import {describe, expect, it} from 'vitest';
import type {ReceivedFotosShareScope} from '@refinio/fotos.core/received-shares';
import type {PhotoEntry} from '@/types/fotos';
import {clearIncomingShareUrl, getIncomingGalleryProgress} from './fotosIncomingShareState.js';

const scope = {
    issuer: 'sender', scope: {kind: 'gallery', id: 'main'}, verified: true, status: 'active',
    entries: [{contentHash: 'first'}, {contentHash: 'second'}], photoCount: 2,
} as ReceivedFotosShareScope;
const photo = (hash: string, thumb?: string) => ({hash, thumb}) as PhotoEntry;

describe('incoming gallery milestones', () => {
    it('does not report unrelated photos or another sender as received', () => {
        expect(getIncomingGalleryProgress('sender', [{...scope, issuer: 'other'}], [photo('first', 'thumb')]))
            .toMatchObject({phase: 'waiting', expected: null, received: 0, percent: null});
        expect(getIncomingGalleryProgress('sender', [scope], [photo('unrelated', 'thumb'), photo('first')]))
            .toMatchObject({phase: 'waiting', expected: 2, received: 0, percent: 0});
    });
    it('counts usable images in this scope, including a matching local original', () => {
        expect(getIncomingGalleryProgress('sender', [scope], [photo('first', 'local-thumb')]))
            .toMatchObject({phase: 'receiving', expected: 2, received: 1, percent: 50});
        expect(getIncomingGalleryProgress('sender', [scope], [photo('first', 'local-thumb'), photo('second', 'remote-thumb')]))
            .toMatchObject({phase: 'ready', expected: 2, received: 2, percent: 100});
    });
    it('requires a verified active scope and distinguishes revocation from completion', () => {
        expect(getIncomingGalleryProgress('sender', [{...scope, verified: false}], [photo('first', 'thumb')]).phase).toBe('waiting');
        expect(getIncomingGalleryProgress('sender', [{...scope, status: 'revoked', entries: []}], [])).toMatchObject({phase: 'revoked', percent: null});
    });
    it('finishes an empty verified gallery without waiting forever', () => {
        expect(getIncomingGalleryProgress('sender', [{...scope, entries: [], photoCount: 0}], [])).toMatchObject({phase: 'ready', percent: 100});
    });
    it('removes the consumed invitation while retaining the active account and task', () => {
        const url = new URL(clearIncomingShareUrl('https://fotos.one/?fotosAccount=acct-1&fotosShare=invite&fotosAcceptAsNew=1&task=sharing&photo=abc'));
        expect(Object.fromEntries(url.searchParams)).toEqual({fotosAccount: 'acct-1', task: 'sharing', photo: 'abc'});
    });
});
