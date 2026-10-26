export interface FotosFoundationPhase {
  key: string;
  title: string;
  status: 'wired' | 'next';
  summary: string;
}

export interface FotosPlannedRun {
  key: string;
  title: string;
  summary: string;
}

export const fotosFoundationPhases: FotosFoundationPhase[] = [
  {
    key: 'identity',
    title: 'Identity and MultiUser',
    status: 'wired',
    summary: 'Boot the app through the same login, storage, recipe, and instance ownership path as vger.expo.',
  },
  {
    key: 'settings',
    title: 'Settings, secrets, and devices plans',
    status: 'wired',
    summary: 'Keep fotos-specific settings beside the shared device, glue, and secret sections so mobile state stays compatible with ONE.',
  },
  {
    key: 'discovery',
    title: 'mDNS and QUICVC discovery',
    status: 'wired',
    summary: 'Advertise and discover peers locally, surface transport capability, and preserve the handshake-backed collection step.',
  },
  {
    key: 'users',
    title: 'User and instance management',
    status: 'wired',
    summary: 'Expose the local instance, my devices, contact devices, and trust levels instead of hiding them behind a fotos-only facade.',
  },
  {
    key: 'chum',
    title: 'CHUM sharing policy',
    status: 'next',
    summary: 'Add fotos-specific object filters and import policy so manifests and gallery scopes travel only to approved peers.',
  },
  {
    key: 'runs',
    title: 'Runs orchestration',
    status: 'next',
    summary: 'Materialize ingest, enrichment, manifest sync, and trusted sharing as explicit runs on top of the initialized runtime.',
  },
];

export const fotosPlannedRuns: FotosPlannedRun[] = [
  {
    key: 'library-ingest',
    title: 'library-ingest',
    summary: 'Materialize the mobile intake path into ONE-backed fotos entries and gallery trie updates.',
  },
  {
    key: 'analysis-enrichment',
    title: 'analysis-enrichment',
    summary: 'Run face and semantic work locally or hand it to a stronger trusted device once the run graph exists.',
  },
  {
    key: 'manifest-sync',
    title: 'manifest-sync',
    summary: 'Exchange fotos manifests and the required object closures over CHUM once sharing policy is in place.',
  },
  {
    key: 'trusted-share',
    title: 'trusted-share',
    summary: 'Ship selected gallery scopes to verified peers using the user and device trust model rather than ad hoc exports.',
  },
];
