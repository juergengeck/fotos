import type {PhotoEntry} from '@/types/fotos';
import type {ReceivedFotosShareScope} from '@refinio/fotos.core/received-shares';

/** Measure this sender's gallery against its verified manifest, never our own manifest. */
export function getIncomingGalleryProgress(
    senderPersonId: string,
    scopes: readonly ReceivedFotosShareScope[],
    photos: readonly PhotoEntry[],
) {
    const scope = scopes.find(item => item.issuer === senderPersonId
        && item.scope.kind === 'gallery' && item.scope.id === 'main');
    if (!scope || !scope.verified || scope.status !== 'active') {
        return {
            phase: scope?.status === 'revoked' ? 'revoked' as const : 'waiting' as const,
            expected: null,
            received: 0,
            percent: null,
        };
    }
    const expectedHashes = new Set(scope.entries.map(entry => entry.contentHash));
    const availableHashes = new Set(photos.filter(photo => photo.thumb).map(photo => photo.hash));
    const received = [...expectedHashes].filter(hash => availableHashes.has(hash)).length;
    const expected = expectedHashes.size;
    return {
        phase: received === expected ? 'ready' as const : received > 0 ? 'receiving' as const : 'waiting' as const,
        expected,
        received,
        percent: expected === 0 ? 100 : Math.round(received / expected * 100),
    };
}

/** Keep the selected account and photo/task route when finishing or dismissing an invite. */
export function clearIncomingShareUrl(href: string): string {
    const url = new URL(href);
    url.searchParams.delete('fotosShare');
    url.searchParams.delete('fotosAcceptAsNew');
    return url.toString();
}
