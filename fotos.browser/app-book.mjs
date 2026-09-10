/** Cross-repository source reference. Only the `repo://fotos/` prefix is
 *  existence-checked by the contract test. */
function sourceRef(source) {
  return source.includes('://') ? source : `repo://fotos/${source}`;
}

function foreignRef(repo, source) {
  return `repo://${repo}/${source}`;
}

function journey({
  id,
  title,
  purpose,
  inputs,
  steps,
  outputs,
  checks,
  sources,
  roles,
  implementationStatus = 'unbound',
  description = null,
}) {
  return {
    id: `fotos.app.journey.${id}`,
    title,
    description: description ?? `${title} across publisher-chosen fotos share scopes.`,
    purpose,
    implementationStatus,
    actorRoles: roles,
    triggerHints: [`A ${roles[0]} starts ${title.toLowerCase()}.`],
    inputRequirements: inputs,
    steps,
    outputContracts: outputs,
    verificationChecks: checks,
    sourceRefs: sources.map(sourceRef),
  };
}

/** Journeys carry no `normativeFlowIds` yet. `glue.seller` requires them and
 *  validates each against its normative market flow family (F59–F76); fotos has
 *  no such family, so an id here would be invented rather than referenced.
 *
 *  When fotos defines one: add `normativeFlowIds` to the `journey()` helper as a
 *  required argument, list the flows this journey realizes, and add the matching
 *  assertions to `test/app-book.contract.test.mjs` — non-empty per journey, every
 *  id drawn from the known family, and every normative flow covered by some
 *  journey. The last of those is what makes the family meaningful rather than
 *  decorative, and it is the reason to add all three together rather than only
 *  the field. */
const journeys = [
  journey({
    id: 'choose-scope-spatial-disclosure',
    title: 'Choose spatial disclosure for a shared scope',
    purpose:
      'Let the publisher of one FotosShareManifest decide, per scope and with the disclosure in front of her, whether that scope announces a spatial facet key to the content tracker overlay, and at what precision.',
    roles: ['publisher'],
    implementationStatus: 'unbound',
    description:
      'Publication decides who may read a scope. This journey decides the separate question of whether that scope is discoverable by location to peers who have never seen it.',
    inputs: [
      'One FotosShareManifest the publisher has already chosen to share',
      'The exifGpsLat / exifGpsLon values present on that scope’s entries, and only those entries',
      'The precision levels this build offers',
    ],
    steps: [
      {
        id: 'default-silent',
        title: 'Start from announcing nothing',
        actorRole: 'fotos.one',
        intent:
          'A newly published scope announces no spatial facet. Sharing photos with named people never, by itself, makes their location discoverable to strangers.',
        expectedOutputs: ['A published scope with an empty spatial announce set'],
      },
      {
        id: 'derive-on-request',
        title: 'Derive candidate cells only when the publisher asks',
        actorRole: 'publisher',
        intent:
          'Compute candidate cells from the EXIF coordinates of the entries in this scope, on explicit request. No intake, sync, or background path derives a cell.',
        expectedOutputs: ['Candidate cells at each offered precision, for this scope only'],
      },
      {
        id: 'show-the-disclosure',
        title: 'Show what announcing would disclose',
        actorRole: 'fotos.one',
        intent:
          'State plainly, before any confirmation: these cells would be announced; anyone who searches a cell learns that this device holds a published scope there; a coarse cell names a region, a fine cell names a place.',
        expectedOutputs: ['A legible statement of the exposure, per candidate precision'],
      },
      {
        id: 'choose-precision',
        title: 'Choose a precision, or none',
        actorRole: 'publisher',
        intent:
          'Offer the coarsest precision first and require an explicit selection for anything finer. "None" stays available at every step and is the default if the publisher does not choose.',
        expectedOutputs: ['One precision, or none, recorded against this scope'],
      },
      {
        id: 'announce',
        title: 'Announce the chosen key and nothing else',
        actorRole: 'fotos.one',
        intent:
          'Hand the tracker the chosen facet key for this scope root. Cells belonging to entries outside this scope are not announced, and no facet key is announced for a scope whose share certificate is revoked.',
        expectedOutputs: ['One per-root facet announce, or none'],
      },
      {
        id: 'withdraw',
        title: 'Withdraw the disclosure honestly',
        actorRole: 'publisher',
        intent:
          'Republish the scope without the facet, and tell the publisher that already-propagated provider records expire on their TTL rather than disappearing at once.',
        expectedOutputs: [
          'A republished scope with no facet key',
          'A stated, bounded propagation delay rather than an implied instant revocation',
        ],
      },
    ],
    outputs: [
      'A per-scope spatial announce decision the publisher made and can read back',
      'No spatial facet derived anywhere outside this journey',
      'No coupling between who may read a scope and who may discover it by location',
    ],
    checks: [
      'A newly created and shared FotosShareManifest announces no spatial facet.',
      'No intake, catalog, sync, or variant path derives a geohash cell from exifGpsLat / exifGpsLon; derivation appears only behind the publisher-initiated step.',
      'Two scopes published from the same device may carry different precisions, including one at full precision and one at none.',
      'A cell that occurs only on an entry absent from the scope’s entries set never appears in that scope’s announce.',
      'A scope whose FotosShareCertificate is revoked announces no facet key.',
      'Choosing a precision finer than the coarsest offered requires an explicit selection and cannot be reached by accepting defaults.',
      'Withdrawal republishes without the facet and surfaces the TTL-bounded propagation delay as a distinct state rather than reporting immediate removal.',
    ],
    sources: [
      'fotos.core/src/recipes/FotosRecipes.ts',
      'fotos.core/src/recipes/FotosMediaRecipes.ts',
      'fotos.core/src/share-model.ts',
    ],
  }),
];

export const FOTOS_APP_BOOK_DEFINITION = {
  book: {
    name: 'fotos.one',
    title: 'Fotos',
    kind: 'workspace',
    description:
      'Fotos publisher-owned photo sharing. This book currently covers one subject: what a shared scope discloses to the content tracker overlay, and who decides it.',
    lifecycleStage: 'source',
    status: 'available',
    availabilityPayload: 'local',
    availabilitySourceRef: 'workspace://fotos/fotos.browser/app',
    uses: ['share-scope', 'spatial-facet', 'content-tracker', 'disclosure'],
    sourceRefs: [
      sourceRef('fotos.browser/'),
      sourceRef('fotos.core/src/share-model.ts'),
      foreignRef('glue', 'docs/content-tracker.md'),
    ],
    entryIds: ['fotos.app.announce-policy', ...journeys.map(item => item.id)],
  },
  journeys,
  documents: [
    {
      name: 'fotos.app.announce-policy',
      title: 'Announce policy',
      body:
        'Publication answers who may read a scope. Announcement answers whether this device offers to serve it, and under which keys. Fotos treats these as two decisions. A content-hash key is discoverable only by someone who already has the hash, so it rides publication. A spatial facet key is guessable: someone who has never seen the scope can find its holder by walking a vocabulary of cells. Fotos therefore announces no spatial facet by default, derives one only inside a publisher-initiated step that shows the exposure first, and records the choice per share scope. There is no correct global default, because the same cell can mean "there is a memorial in my backyard and I want it found" or "something happened here and I do not want it indexed" — and only the publisher knows which. The overlay supplies the mechanism; this book supplies the policy.',
      sourceRefs: [
        foreignRef('glue', 'docs/content-tracker.md'),
        sourceRef('fotos.core/src/recipes/FotosRecipes.ts'),
      ],
    },
  ],
  /** Empty on purpose. The journey is `unbound`: nothing in fotos implements a
   *  facet announce yet, so there is no runnable evidence for it and a binding
   *  here would claim one. `fotos.core/src/share-model.test.ts` covers a
   *  precondition the journey depends on — that a scope has an explicit entries
   *  set and an active-or-revoked certificate — but a precondition is not
   *  evidence for the journey, and binding it would misreport this as built. */
  flowBindings: [],
  openImplementationGaps: [
    'No spatial facet key is derived, stored, or announced anywhere in fotos today; the whole journey is a policy contract ahead of its runtime.',
    'The content tracker overlay does not exist yet (glue docs/content-tracker.md is a proposal), so there is nothing to announce to.',
    'No per-scope announce decision is persisted on FotosShareManifest or beside it.',
    'The precision levels this build offers are undecided; the journey requires a coarsest-first ordering but does not name the levels.',
    'Withdrawal propagation depends on provider-record TTL, which is an unsettled tracker parameter (GLUE-TRACK-012).',
    'Fotos has no normative flow family yet, so journeys carry no normativeFlowIds. Add the field, and the contract check that every id resolves to a known flow, once that family exists — see the note above this journey list. Until then a flow id here would be invented rather than referenced.',
  ],
  compatibility: {
    bookRecipeOwner: '@refinio/source.core',
    flowBindingOwner: '@refinio/workspace.core',
    materializer: 'VGER app Book / flow ingestion',
    createsParallelBookRecipe: false,
    createsRuntimeRole: false,
  },
};

export default FOTOS_APP_BOOK_DEFINITION;
