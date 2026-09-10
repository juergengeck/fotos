const range = (start, end) => Array.from({length: end - start + 1}, (_, index) => `F${start + index}`);

/**
 * Executable ownership for every flow in docs/product/ui.prd.md.
 *
 * A flow can have several evidence owners. The coverage gate only accepts a
 * flow when at least one owner is part of the product-owned test runner. This
 * file deliberately uses ranges so a new PRD row cannot be silently absorbed:
 * the runner parses the PRD and fails on any unmapped or stale ID.
 */
export const FOTOS_FLOW_SUITES = [
  {
    id: 'ui-cold-start-intake',
    title: 'Cold start, intake choices, routing, and onboarding',
    featureIds: [...range(1, 13), 'F99', 'F105'],
    evidence: ['browser-ui'],
  },
  {
    id: 'ui-ingest-folders',
    title: 'Ingest progress and managed-folder lifecycle',
    featureIds: range(14, 21),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'ui-gallery-navigation',
    title: 'Timeline, browse controls, search, filters, and history',
    featureIds: range(22, 36),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'ui-lightbox',
    title: 'Photo viewer navigation, transforms, metadata, and actions',
    featureIds: range(37, 50),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'ui-people',
    title: 'People clusters, naming, grouping, merging, and deletion',
    featureIds: range(51, 60),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'ui-selection-collections',
    title: 'Selection and collection lifecycle',
    featureIds: range(61, 67),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'integration-gallery-sharing',
    title: 'Invite, pairing, CHUM sync, named sharing, and revocation',
    featureIds: range(68, 81),
    evidence: ['browser-ui', 'multi-instance-integration', 'unit-contract'],
  },
  {
    id: 'integration-identity-recovery',
    title: 'fotos ID authentication, passkeys, recovery, and logout',
    featureIds: range(82, 90),
    evidence: ['browser-ui', 'multi-instance-integration', 'unit-contract'],
  },
  {
    id: 'ui-settings-tools',
    title: 'Storage, ingestion, AI, device, history, export, and audit settings',
    featureIds: range(91, 98),
    evidence: ['browser-ui', 'unit-contract'],
  },
  {
    id: 'ui-context-responsive-safety',
    title: 'Context menus, responsive control pane, onboarding, and confirmation',
    featureIds: range(100, 106),
    evidence: ['browser-ui', 'unit-contract'],
  },
];

export function getMappedFeatureIds() {
  return [...new Set(FOTOS_FLOW_SUITES.flatMap(suite => suite.featureIds))]
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}
