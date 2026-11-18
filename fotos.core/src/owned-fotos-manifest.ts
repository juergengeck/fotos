/** Address one admitted native owner's library without conflating different Persons. */
export function getOwnedFotosManifestId(owner: string): string {
    if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner)) throw new Error('Owned Fotos manifest requires a canonical Person SHA256 id');
    return `fotos:${owner}`;
}
