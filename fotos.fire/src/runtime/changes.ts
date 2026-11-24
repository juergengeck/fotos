/** Authorization changes retire displayed media before any asynchronous work. */
export type FireTvChange = 'authorization' | 'media';

const AUTHORIZATION_TYPES = new Set([
  'FotosShareCertificate', 'FotosShareCertificateChain', 'FotosShareManifest', 'Signature',
]);
const MEDIA_TYPES = new Set(['FotosEntry', 'FotosMediaVariant']);
const TRUST_TYPES = new Set([
  'Profile', 'Someone', 'Person', 'Keys', 'SignKey', 'TrustKeysCertificate',
  'RightToDeclareTrustedKeysForSelfCertificate', 'RightToDeclareTrustedKeysForEverybodyCertificate',
  'Certificate', 'CertificateRegistry', 'PublicKeyTrustIndex', 'TrustRelationship',
  'IssuerKeyRootAuthority', 'IssuerKeyRootSelection', 'IssuerKeyCertificateBundle',
  'IssuerKeyBundleStatus', 'EffectiveIssuerKeyHead', 'IssuerKeyLifecycleState',
  'PersonalTrustAttestation', 'PersonalTrustAttestationBundle', 'PersonalTrustBundleStatus',
  'PersonalTrustDelegation', 'PersonalTrustPolicy', 'PersonalTrustProjection',
  'PersonalTrustSource', 'PersonalTrustState', 'OwnerCredentialTrustProjection', 'OwnerCredentialTrustState',
]);

export function classifyFotosArrival(imported: {kind: string; type: string}): FireTvChange | undefined {
  if (AUTHORIZATION_TYPES.has(imported.type) || TRUST_TYPES.has(imported.type)) return 'authorization';
  if (imported.kind === 'blob' || MEDIA_TYPES.has(imported.type)) return 'media';
  return undefined;
}
