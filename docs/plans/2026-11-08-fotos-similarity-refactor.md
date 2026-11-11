# Fotos Similarity Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give face and CLIP similarity one shared set of primitives with named thresholds, remove the silent fallbacks around them, and sync per-photo analysis (face detections, face embeddings, CLIP embedding) between devices as `FotosMediaVariant` objects instead of the never-written `FotosEntry.faceEmbeddings` / `faceCrops` fields.

**Architecture:** `fotos.core` gains `similarity.ts` (normalize, compare, rank, thresholds, model ids) and `embedding-set.ts` (a self-describing binary codec). Every similarity caller in `fotos.ui` and `fotos.browser` goes through those. Analysis results are published as `analysis-output` variants that are `derivedFrom` the original variant, which is the extension point [`fotos-media-model.md`](../fotos-media-model.md) already defines. A new browser module `analysis-variants.ts` owns writing and reading them, so `fotos-sync.ts` and `useFolderAccess.ts` only call into it.

**Tech Stack:** TypeScript, Vitest, ONE.core (`storeVersionedObject`, `storeArrayBufferAsBlob`, `readBlobAsArrayBuffer`, `getObjectWithType`), WebCrypto `crypto.subtle`, React (fotos.browser).

## Findings this plan acts on

Verified in the tree on 2026-11-08:

1. **Face sync is only half built.** `FotosEntry.faceEmbeddings` and `faceCrops` exist in the recipe ([FotosRecipes.ts:53-54](../../fotos.core/src/recipes/FotosRecipes.ts)) and are read by `extractFaceDataFromEntry` ([fotos-sync.ts:722](../../fotos.browser/browser-ui/src/lib/fotos-sync.ts)), but nothing in `fotos`, `vger` or `../one/packages` ever writes them. Only `faceCount` is synced.
2. **The read path makes up data.** When a face blob is missing or unreadable, `extractFaceDataFromEntry` logs a warning, fills 512 zeros per face and uses bbox `[0,0,0,0]` with score `0`. `useFolderAccess` then writes those placeholder boxes and scores into the local `one/index.html` (`updateIndexHtmlFaceData`, around line 1950).
3. **CLIP embeddings never leave the device.** They live only in `data-semantic-*` attributes of `index.html`, so every device recomputes them.
4. **Semantic search quietly switches to text search** when nothing passes the threshold ([gallery.ts:158-163](../../fotos.ui/src/lib/gallery.ts)).
5. **Similarity code is scattered.** The same "cut a face out of the flat embedding array, cosine, threshold, sort" loop appears three times (`gallery.ts` twice, `cluster-gallery.ts` once). Thresholds are inline literals (0.55, 0.99, 0.3, 0.35, 0.18). `l2Normalize` exists twice: the `faces.ts` version divides by zero, and the `BrowserMultimodalEmbeddingProvider.ts` version throws. `cosineSimilarity` does not check that both vectors have the same dimensions.

## Decisions taken (change them before executing if you disagree)

- **D1 — Semantic search shows only semantic results.** If a CLIP query embedding exists and nothing passes the threshold, the gallery is empty; it does not switch to filename/tag matching. While the query embedding is still being computed (`searchEmbedding === null`), the existing text filter still runs. That is a loading state, not a fallback.
- **D2 — Analysis is stored as variants, not as `FotosEntry` fields.** Each analysis payload is a `FotosMediaVariant` with role `analysis-output`, `derivedFrom` = the original variant, `label` = model id, and `contentHash` = SHA-256 of the payload bytes. The `faceEmbeddings` / `faceCrops` recipe fields are removed. They were never written, so no stored object carries them.
- **D3 — Existing thresholds keep their values.** They get names, but there are still two face-search thresholds (0.3 for the gallery filter, 0.35 for the similar-faces list). Merging them would change results and is listed under follow-ups. The only change in edge behaviour: `buildSimilarFaceMatches` moves from `>= 0.35` to `> 0.35`, the same strict comparison used everywhere else.
- **D4 — Face crops are not synced in this plan.** They have never been synced (see finding 1), so remote faces arrive with embeddings, boxes and scores, but `crops: []`.

## Global Constraints

- No fallbacks: a missing or malformed analysis payload throws. "Variant object not yet arrived via CHUM" (`isMissingVersionedObject`) means the data is still pending, not a failure, and is handled the same way `findCompleteOriginalVariant` already handles it.
- Static imports only. No `await import()` in production code.
- Do not change anything under `../one/packages` (see `AGENTS.md`). Everything here is owned by fotos.
- Never run `git checkout`. Commit on the current feature branch.
- Commit messages carry no Claude attribution (user rule).
- `fotos.browser` consumes `@refinio/fotos.core` from `dist/`. After every `fotos.core` change, run `cd fotos.core && npm run build` before running browser tests.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `fotos.core/src/similarity.ts` | create | Model ids, named thresholds, `l2Normalize`, `cosineSimilarity`, `embeddingAt`, `faceEmbeddingRows`, `rankBySimilarity` |
| `fotos.core/src/similarity.test.ts` | create | Unit tests for the above |
| `fotos.core/src/embedding-set.ts` | create | `FEMB` v1 binary codec for a set of embeddings tagged with a model id |
| `fotos.core/src/embedding-set.test.ts` | create | Codec tests |
| `fotos.core/src/faces.ts` | modify | Re-export `l2Normalize` / `cosineSimilarity` from `similarity.ts`; delete local copies |
| `fotos.core/src/FaceClusterDimension.ts` | modify | Default threshold from `SIMILARITY_THRESHOLDS` |
| `fotos.core/src/index.ts` | modify | Export the new modules |
| `fotos.core/package.json` | modify | Add `./similarity` subpath export (worker-safe, no ONNX imports) |
| `fotos.ui/src/lib/gallery.ts` | modify | Use primitives; remove semantic→text fallback |
| `fotos.ui/src/lib/gallery.test.ts` | modify | Test that semantic results are not mixed with text matches |
| `fotos.browser/browser-ui/src/lib/cluster-gallery.ts` | modify | `buildSimilarFaceMatches` via `rankBySimilarity` |
| `fotos.browser/browser-ui/src/lib/BrowserMultimodalEmbeddingProvider.ts` | modify | Use shared `l2Normalize` and model id |
| `fotos.browser/browser-ui/src/lib/one-storage-errors.ts` | create | `isMissingVersionedObject`, moved out of `fotos-sync.ts` so both modules can share it without a circular import |
| `fotos.browser/browser-ui/src/lib/analysis-variants.ts` | create | Build, store, check and read analysis variants |
| `fotos.browser/browser-ui/src/lib/analysis-variants.test.ts` | create | Round-trip and failure tests |
| `fotos.browser/browser-ui/src/lib/fotos-sync.ts` | modify | Publish analysis variants; include them in the "already synced" check; delete `extractFaceDataFromEntry` and `writeFaceCropsToFilesystem` |
| `fotos.browser/browser-ui/src/lib/fotos-sync.test.ts` | modify | Publication test for analysis variants |
| `fotos.browser/browser-ui/src/hooks/useFolderAccess.ts` | modify | Materialize remote faces + semantic from variants; stop writing placeholder data |
| `fotos.core/src/recipes/FotosRecipes.ts`, `fotos.core/src/sync-rules.ts`, `fotos.browser/browser-ui/src/lib/fotosSyncRules.test.ts` | modify | Drop `faceEmbeddings` / `faceCrops` |
| `docs/fotos-media-model.md` | modify | Document analysis variants |

---

### Task 1: Similarity primitives in fotos.core

**Files:**
- Create: `fotos.core/src/similarity.ts`
- Create: `fotos.core/src/similarity.test.ts`
- Modify: `fotos.core/src/faces.ts:281-295` (delete `l2Normalize`, `cosineSimilarity`; re-export)
- Modify: `fotos.core/src/index.ts:82-87` (export block)
- Modify: `fotos.core/package.json` (`exports`)

**Interfaces:**
- Produces (exported from `@refinio/fotos.core` and `@refinio/fotos.core/similarity`):
  - `FACE_EMBEDDING_MODEL_ID: 'arcface-w600k-r50'`
  - `FACE_DETECTION_MODEL_ID: 'retinaface-det-10g'`
  - `SEMANTIC_EMBEDDING_MODEL_ID: 'clip-vit-base-patch32'`
  - `SIMILARITY_THRESHOLDS: {faceClusterAssignment: 0.55; faceIdentity: 0.99; faceSearchPhoto: 0.3; faceSearchMatch: 0.35; semanticSearch: 0.18}`
  - `l2Normalize(values: ArrayLike<number>): number[]`, which throws on a zero vector
  - `cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number`, which throws when the dimensions differ
  - `embeddingAt(flat: Float32Array, index: number, dimensions: number): Float32Array`
  - `faceEmbeddingRows<T>(owner: T, flat: Float32Array, count: number, dimensions: number): SimilarityCandidate<FaceRow<T>>[]`
  - `rankBySimilarity<T>(query: ArrayLike<number>, candidates: Iterable<SimilarityCandidate<T>>, threshold: number): SimilarityMatch<T>[]`
  - types `SimilarityCandidate<T> = {item: T; embedding: ArrayLike<number>}`, `SimilarityMatch<T> = {item: T; similarity: number}`, `FaceRow<T> = {owner: T; faceIndex: number}`

- [ ] **Step 1: Write the failing test**

`fotos.core/src/similarity.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {
    cosineSimilarity,
    embeddingAt,
    faceEmbeddingRows,
    l2Normalize,
    rankBySimilarity,
    SIMILARITY_THRESHOLDS,
} from './similarity.js';

describe('l2Normalize', () => {
    it('scales a vector to unit length', () => {
        expect(l2Normalize([3, 4])).toEqual([0.6, 0.8]);
    });

    it('rejects a zero vector instead of producing NaN', () => {
        expect(() => l2Normalize(new Float32Array(3))).toThrow('zero-length embedding');
    });
});

describe('cosineSimilarity', () => {
    it('is the dot product of normalized vectors', () => {
        expect(cosineSimilarity([1, 0], [0.6, 0.8])).toBeCloseTo(0.6);
    });

    it('rejects vectors of different dimensions', () => {
        expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('different dimensions: 2 vs 3');
    });
});

describe('embeddingAt', () => {
    const flat = new Float32Array([1, 2, 3, 4, 5, 6]);

    it('returns the row without copying', () => {
        const row = embeddingAt(flat, 1, 3);
        expect(Array.from(row)).toEqual([4, 5, 6]);
        expect(row.buffer).toBe(flat.buffer);
    });

    it('rejects a row outside the buffer', () => {
        expect(() => embeddingAt(flat, 2, 3)).toThrow('outside');
        expect(() => embeddingAt(flat, -1, 3)).toThrow('outside');
    });
});

describe('faceEmbeddingRows', () => {
    it('yields one candidate per face, tagged with owner and index', () => {
        const rows = faceEmbeddingRows('photo-a', new Float32Array([1, 0, 0, 1]), 2, 2);
        expect(rows.map(row => row.item)).toEqual([
            {owner: 'photo-a', faceIndex: 0},
            {owner: 'photo-a', faceIndex: 1},
        ]);
        expect(Array.from(rows[1].embedding)).toEqual([0, 1]);
    });

    it('rejects a buffer whose length does not match the face count', () => {
        expect(() => faceEmbeddingRows('photo-a', new Float32Array(3), 2, 2)).toThrow('2 faces but 3 values');
    });
});

describe('rankBySimilarity', () => {
    it('keeps candidates strictly above the threshold, best first', () => {
        const ranked = rankBySimilarity([1, 0], [
            {item: 'low', embedding: [0.2, 0.98]},
            {item: 'high', embedding: [0.9, 0.44]},
            {item: 'edge', embedding: [0.5, 0.87]},
            {item: 'mid', embedding: [0.7, 0.71]},
        ], 0.5);
        expect(ranked.map(match => match.item)).toEqual(['high', 'mid']);
        expect(ranked[0].similarity).toBeCloseTo(0.9);
    });
});

describe('SIMILARITY_THRESHOLDS', () => {
    it('keeps the values that were inline before this refactor', () => {
        expect(SIMILARITY_THRESHOLDS).toEqual({
            faceClusterAssignment: 0.55,
            faceIdentity: 0.99,
            faceSearchPhoto: 0.3,
            faceSearchMatch: 0.35,
            semanticSearch: 0.18,
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fotos.core && npx vitest run src/similarity.test.ts`
Expected: FAIL, `Failed to resolve import "./similarity.js"`

- [ ] **Step 3: Write the implementation**

`fotos.core/src/similarity.ts`:

```ts
/**
 * Similarity primitives shared by every fotos runtime.
 *
 * Embeddings are L2-normalized when they are created, so cosine similarity is a
 * dot product. Comparisons check dimensions and normalization rejects a zero
 * vector: a missing embedding must never be compared as if it existed.
 *
 * This module has no imports, so it is safe to load in web workers.
 */

export const FACE_EMBEDDING_MODEL_ID = 'arcface-w600k-r50';
export const FACE_DETECTION_MODEL_ID = 'retinaface-det-10g';
export const SEMANTIC_EMBEDDING_MODEL_ID = 'clip-vit-base-patch32';

export const SIMILARITY_THRESHOLDS = {
    /** FaceClusterDimension joins the nearest cluster at or above this. */
    faceClusterAssignment: 0.55,
    /** A search face this close to a clustered face is treated as that same face. */
    faceIdentity: 0.99,
    /** Gallery filter: the photo contains a face like the search face. */
    faceSearchPhoto: 0.3,
    /** Similar-faces list in the sidebar. */
    faceSearchMatch: 0.35,
    /** CLIP text-to-image search. */
    semanticSearch: 0.18,
} as const;

export interface SimilarityCandidate<T> {
    item: T;
    embedding: ArrayLike<number>;
}

export interface SimilarityMatch<T> {
    item: T;
    similarity: number;
}

export interface FaceRow<T> {
    owner: T;
    faceIndex: number;
}

export function l2Normalize(values: ArrayLike<number>): number[] {
    let norm = 0;
    for (let index = 0; index < values.length; index++) {
        norm += values[index] * values[index];
    }
    if (norm === 0) {
        throw new Error('Cannot normalize a zero-length embedding');
    }

    const scale = Math.sqrt(norm);
    const normalized = new Array<number>(values.length);
    for (let index = 0; index < values.length; index++) {
        normalized[index] = values[index] / scale;
    }
    return normalized;
}

/** Cosine similarity of two L2-normalized embeddings (= dot product). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length) {
        throw new Error(`Cannot compare embeddings of different dimensions: ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    for (let index = 0; index < a.length; index++) {
        dot += a[index] * b[index];
    }
    return dot;
}

/** Row `index` of a flat row-major embedding buffer, as a view (no copy). */
export function embeddingAt(flat: Float32Array, index: number, dimensions: number): Float32Array {
    const start = index * dimensions;
    const end = start + dimensions;
    if (index < 0 || end > flat.length) {
        throw new Error(`Embedding ${index} is outside a ${flat.length}-value buffer of ${dimensions}-dim embeddings`);
    }
    return flat.subarray(start, end);
}

/** One similarity candidate per face in a flat per-photo embedding buffer. */
export function faceEmbeddingRows<T>(
    owner: T,
    flat: Float32Array,
    count: number,
    dimensions: number,
): SimilarityCandidate<FaceRow<T>>[] {
    if (flat.length !== count * dimensions) {
        throw new Error(`Embedding buffer has ${count} faces but ${flat.length} values (expected ${count * dimensions})`);
    }
    const rows: SimilarityCandidate<FaceRow<T>>[] = [];
    for (let faceIndex = 0; faceIndex < count; faceIndex++) {
        rows.push({item: {owner, faceIndex}, embedding: embeddingAt(flat, faceIndex, dimensions)});
    }
    return rows;
}

/** Candidates scoring strictly above `threshold`, highest similarity first. */
export function rankBySimilarity<T>(
    query: ArrayLike<number>,
    candidates: Iterable<SimilarityCandidate<T>>,
    threshold: number,
): SimilarityMatch<T>[] {
    const matches: SimilarityMatch<T>[] = [];
    for (const candidate of candidates) {
        const similarity = cosineSimilarity(query, candidate.embedding);
        if (similarity > threshold) {
            matches.push({item: candidate.item, similarity});
        }
    }
    matches.sort((left, right) => right.similarity - left.similarity);
    return matches;
}
```

In `fotos.core/src/faces.ts`, delete the `l2Normalize` and `cosineSimilarity` functions (lines 281-295) and add this next to the other imports at the top:

```ts
import {cosineSimilarity, l2Normalize} from './similarity.js';
export {cosineSimilarity, l2Normalize};
```

(`faces.ts` keeps re-exporting them, so the `./faces` subpath keeps its public surface.)

In `fotos.core/src/index.ts`, remove `l2Normalize,` and `cosineSimilarity,` from the `./faces.js` export block (lines 85-86) and add:

```ts
export {
    FACE_DETECTION_MODEL_ID,
    FACE_EMBEDDING_MODEL_ID,
    SEMANTIC_EMBEDDING_MODEL_ID,
    SIMILARITY_THRESHOLDS,
    cosineSimilarity,
    embeddingAt,
    faceEmbeddingRows,
    l2Normalize,
    rankBySimilarity,
} from './similarity.js';
export type {FaceRow, SimilarityCandidate, SimilarityMatch} from './similarity.js';
```

In `fotos.core/package.json` `exports`, add after `"./faces"`:

```json
"./similarity": {
  "import": "./dist/similarity.js",
  "types": "./dist/similarity.d.ts"
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd fotos.core && npx vitest run src/similarity.test.ts src/faces.test.ts src/FaceClusterDimension.test.ts && npm run typecheck`
Expected: all PASS, no type errors. `faces.test.ts` must still pass; if it relied on `l2Normalize` returning `NaN` for zero input, that test was asserting the bug and must be changed to expect the throw.

- [ ] **Step 5: Commit**

```bash
git add fotos.core/src/similarity.ts fotos.core/src/similarity.test.ts fotos.core/src/faces.ts fotos.core/src/index.ts fotos.core/package.json
git commit -m "feat(fotos.core): shared similarity primitives with named thresholds"
```

---

### Task 2: Route every similarity caller through the primitives

**Files:**
- Modify: `fotos.core/src/FaceClusterDimension.ts:55`
- Modify: `fotos.ui/src/lib/gallery.ts:1-16, 71-136`
- Modify: `fotos.browser/browser-ui/src/lib/cluster-gallery.ts:1, 99-136`
- Modify: `fotos.browser/browser-ui/src/lib/BrowserMultimodalEmbeddingProvider.ts:1-25`
- Modify: `fotos.browser/browser-ui/src/workers/semantic.worker.ts:3-5`
- Test: existing `fotos.ui/src/lib/gallery.test.ts`, `fotos.browser/browser-ui/src/lib/cluster-gallery.test.ts`, `fotos.core/src/FaceClusterDimension.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: no new exports. Behaviour stays the same except decision D3 (`buildSimilarFaceMatches` now uses `>`).

This is a pure refactor, so the existing tests are the safety net. Step 1 adds one test that pins the photo-level ranking, which the rewrite in step 3 must keep.

- [ ] **Step 1: Pin face-search ranking order in `fotos.ui/src/lib/gallery.test.ts`**

Add inside the existing top-level `describe` (it already has a `makePhoto(hash, capturedAt, overrides)` helper):

```ts
it('ranks photos by their best-matching face and drops photos with no face above threshold', () => {
    const dim = EMBEDDING_DIM;
    const face = (hot: number, weight = 1) => {
        const v = new Float32Array(dim);
        v[0] = weight;
        v[hot] = Math.sqrt(1 - weight * weight);
        return v;
    };
    const flat = (...faces: Float32Array[]) => {
        const out = new Float32Array(faces.length * dim);
        faces.forEach((f, i) => out.set(f, i * dim));
        return out;
    };
    const faces = (embeddings: Float32Array, count: number) => ({
        count, bboxes: [], scores: [], embeddings, crops: [],
    });
    const photos = [
        makePhoto('weak', '2026-03-10T10:00:00.000Z', {faces: faces(flat(face(1, 0.4)), 1)}),
        makePhoto('strong', '2026-03-09T10:00:00.000Z', {faces: faces(flat(face(2, 0.1), face(3, 0.9)), 2)}),
        makePhoto('none', '2026-03-08T10:00:00.000Z', {faces: faces(flat(face(4, 0.2)), 1)}),
    ];
    const searchFace = face(5, 1);

    expect(filterGalleryPhotos(photos, {searchFace}).map(photo => photo.hash)).toEqual(['strong', 'weak']);
});
```

Add `import {EMBEDDING_DIM} from '@refinio/fotos.core';` to the test's imports (it has none from fotos.core today).

- [ ] **Step 2: Run it against the current code**

Run: `cd fotos.ui && npx vitest run src/lib/gallery.test.ts`
Expected: PASS (it pins today's behaviour).

- [ ] **Step 3: Rewrite the callers**

`fotos.core/src/FaceClusterDimension.ts`: replace `const DEFAULT_SIMILARITY_THRESHOLD = 0.55;` with

```ts
import {SIMILARITY_THRESHOLDS} from './similarity.js';

const DEFAULT_SIMILARITY_THRESHOLD = SIMILARITY_THRESHOLDS.faceClusterAssignment;
```

(Move the import up to join the other imports.)

`fotos.ui/src/lib/gallery.ts`: replace the import line and delete `const SEMANTIC_SIMILARITY_THRESHOLD = 0.18;`:

```ts
import {
    cosineSimilarity,
    EMBEDDING_DIM,
    embeddingAt,
    faceEmbeddingRows,
    rankBySimilarity,
    SIMILARITY_THRESHOLDS,
} from '@refinio/fotos.core';
```

Replace `findMatchingClusterId`, `scorePhotosByFaceSimilarity` and `scorePhotosBySemanticSimilarity` with:

```ts
function findMatchingClusterId(photos: PhotoEntry[], searchFace: Float32Array): string | undefined {
    for (const photo of photos) {
        const faces = photo.faces;
        if (!faces?.embeddings || !faces.clusterIds) {
            continue;
        }
        for (let index = 0; index < faces.count; index++) {
            const similarity = cosineSimilarity(searchFace, embeddingAt(faces.embeddings, index, EMBEDDING_DIM));
            if (similarity > SIMILARITY_THRESHOLDS.faceIdentity) {
                return faces.clusterIds[index];
            }
        }
    }
    return undefined;
}

function scorePhotosByFaceSimilarity(photos: PhotoEntry[], searchFace: Float32Array): PhotoEntry[] {
    const candidates = photos.flatMap(photo => photo.faces?.embeddings
        ? faceEmbeddingRows(photo, photo.faces.embeddings, photo.faces.count, EMBEDDING_DIM)
        : []);
    const ranked = rankBySimilarity(searchFace, candidates, SIMILARITY_THRESHOLDS.faceSearchPhoto);

    // Ranked best-first, so the first face seen per photo is that photo's best face.
    const seen = new Set<PhotoEntry>();
    const result: PhotoEntry[] = [];
    for (const {item} of ranked) {
        if (!seen.has(item.owner)) {
            seen.add(item.owner);
            result.push(item.owner);
        }
    }
    return result;
}

function scorePhotosBySemanticSimilarity(photos: PhotoEntry[], searchEmbedding: SemanticInfo): PhotoEntry[] {
    const candidates = photos.flatMap(photo => photo.semantic && photo.semantic.modelId === searchEmbedding.modelId
        ? [{item: photo, embedding: photo.semantic.embedding}]
        : []);
    return rankBySimilarity(searchEmbedding.embedding, candidates, SIMILARITY_THRESHOLDS.semanticSearch)
        .map(match => match.item);
}
```

`fotos.browser/browser-ui/src/lib/cluster-gallery.ts`: change the import to

```ts
import {EMBEDDING_DIM, faceEmbeddingRows, rankBySimilarity, SIMILARITY_THRESHOLDS} from '@refinio/fotos.core';
```

and replace `buildSimilarFaceMatches` with:

```ts
export function buildSimilarFaceMatches(
    photos: PhotoEntry[],
    searchFace: Float32Array,
    minSimilarity: number = SIMILARITY_THRESHOLDS.faceSearchMatch,
): SimilarFaceMatch[] {
    const candidates = photos.flatMap(photo => photo.faces?.embeddings
        ? faceEmbeddingRows(photo, photo.faces.embeddings, photo.faces.count, EMBEDDING_DIM)
        : []);

    return rankBySimilarity(searchFace, candidates, minSimilarity).map(({item, similarity}) => {
        const {owner: photo, faceIndex} = item;
        const faces = photo.faces!;
        return {
            photo,
            faceIndex,
            similarity,
            cropPath: faces.crops[faceIndex] || undefined,
            clusterId: faces.clusterIds?.[faceIndex],
            personId: faces.personIds?.[faceIndex]?.trim() || undefined,
            personName: faces.names?.[faceIndex],
        };
    });
}
```

If `cosineSimilarity` is no longer used in `cluster-gallery.ts` after this, remove it from the import.

`fotos.browser/browser-ui/src/lib/BrowserMultimodalEmbeddingProvider.ts`: delete the local `l2Normalize` function and the local `MultimodalEmbeddingModel` type, then add at the top:

```ts
import {l2Normalize, SEMANTIC_EMBEDDING_MODEL_ID} from '@refinio/fotos.core/similarity';

type MultimodalEmbeddingModel = typeof SEMANTIC_EMBEDDING_MODEL_ID;
```

Import from the `./similarity` subpath, not the package root. The worker bundle must not pull in `faces.ts` and its ONNX session code.

`fotos.browser/browser-ui/src/workers/semantic.worker.ts`: replace lines 3-5 with

```ts
import {SEMANTIC_EMBEDDING_MODEL_ID} from '@refinio/fotos.core/similarity';

type MultimodalEmbeddingModel = typeof SEMANTIC_EMBEDDING_MODEL_ID;

const MODEL_ID: MultimodalEmbeddingModel = SEMANTIC_EMBEDDING_MODEL_ID;
```

- [ ] **Step 4: Build core, then run all affected tests and typechecks**

```bash
cd fotos.core && npm run build && npx vitest run src/FaceClusterDimension.test.ts
```

```bash
cd fotos.ui && npx vitest run src/lib/gallery.test.ts && npm run typecheck
```

```bash
cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/cluster-gallery.test.ts && npm run typecheck && npm run build
```

Expected: all PASS. `npm run build` (vite) succeeding proves the worker resolves `@refinio/fotos.core/similarity`.

- [ ] **Step 5: Commit**

```bash
git add fotos.core/src/FaceClusterDimension.ts fotos.ui/src/lib/gallery.ts fotos.ui/src/lib/gallery.test.ts fotos.browser/browser-ui/src/lib/cluster-gallery.ts fotos.browser/browser-ui/src/lib/BrowserMultimodalEmbeddingProvider.ts fotos.browser/browser-ui/src/workers/semantic.worker.ts
git commit -m "refactor(fotos): route face and semantic similarity through fotos.core primitives"
```

---

### Task 3: Semantic search returns semantic results only (D1)

**Files:**
- Modify: `fotos.ui/src/lib/gallery.ts` (`filterGalleryPhotos`)
- Test: `fotos.ui/src/lib/gallery.test.ts`

**Interfaces:**
- Consumes: `scorePhotosBySemanticSimilarity` from Task 2.
- Produces: `filterGalleryPhotos(photos, {searchEmbedding})` returns exactly the semantic ranking, possibly `[]`.

- [ ] **Step 1: Write the failing test**

Add to `fotos.ui/src/lib/gallery.test.ts`:

```ts
it('returns no photos when a semantic query matches nothing, even if the text would match', () => {
    const photos = [
        makePhoto('a', '2026-03-10T10:00:00.000Z', {
            name: 'schuhe.jpg',
            semantic: {modelId: 'clip-vit-base-patch32', embedding: new Float32Array([0, 1, 0])},
        }),
        makePhoto('b', '2026-03-09T10:00:00.000Z', {name: 'schuhe-2.jpg'}),
    ];

    expect(filterGalleryPhotos(photos, {
        searchQuery: 'schuhe',
        searchEmbedding: {modelId: 'clip-vit-base-patch32', embedding: new Float32Array([1, 0, 0])},
    })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fotos.ui && npx vitest run src/lib/gallery.test.ts -t "matches nothing"`
Expected: FAIL, received `['a', 'b']` (the text fallback).

- [ ] **Step 3: Implement**

In `filterGalleryPhotos`, replace

```ts
    if (searchEmbedding) {
        const semanticMatches = scorePhotosBySemanticSimilarity(candidates, searchEmbedding);
        if (semanticMatches.length > 0) {
            return semanticMatches;
        }
    }
```

with

```ts
    if (searchEmbedding) {
        return scorePhotosBySemanticSimilarity(candidates, searchEmbedding);
    }
```

- [ ] **Step 4: Run tests**

Run: `cd fotos.ui && npx vitest run src/lib/gallery.test.ts`
Expected: all PASS, including the existing `'prefers semantic matches for text search…'` test.

- [ ] **Step 5: Commit**

```bash
git add fotos.ui/src/lib/gallery.ts fotos.ui/src/lib/gallery.test.ts
git commit -m "fix(fotos.ui): semantic search no longer falls back to text matches"
```

---

### Task 4: Embedding-set codec in fotos.core

**Files:**
- Create: `fotos.core/src/embedding-set.ts`
- Create: `fotos.core/src/embedding-set.test.ts`
- Modify: `fotos.core/src/index.ts`

**Interfaces:**
- Produces:
  - `FOTOS_EMBEDDING_SET_MIME = 'application/vnd.fotos.embedding-set'`
  - `interface EmbeddingSet {modelId: string; dimensions: number; values: Float32Array}`, where `values.length` is `count * dimensions` (row-major)
  - `encodeEmbeddingSet(set: EmbeddingSet): Uint8Array`
  - `decodeEmbeddingSet(bytes: ArrayBuffer | Uint8Array): EmbeddingSet`
  - `embeddingSetCount(set: EmbeddingSet): number`

Wire format v1, little-endian: `"FEMB"` (4 bytes) · version `u8 = 1` · modelId byte length `u8` · modelId UTF-8 · dimensions `u32` · count `u32` · `count × dimensions` float32 values.

- [ ] **Step 1: Write the failing test**

`fotos.core/src/embedding-set.test.ts`:

```ts
import {describe, expect, it} from 'vitest';
import {decodeEmbeddingSet, embeddingSetCount, encodeEmbeddingSet} from './embedding-set.js';

const sample = {
    modelId: 'clip-vit-base-patch32',
    dimensions: 3,
    values: new Float32Array([0.1, 0.2, 0.3, -1, 0, 1]),
};

describe('embedding set codec', () => {
    it('round-trips model id, dimensions and values', () => {
        const decoded = decodeEmbeddingSet(encodeEmbeddingSet(sample));
        expect(decoded.modelId).toBe(sample.modelId);
        expect(decoded.dimensions).toBe(3);
        expect(Array.from(decoded.values)).toEqual(Array.from(sample.values));
        expect(embeddingSetCount(decoded)).toBe(2);
    });

    it('decodes from an ArrayBuffer and from an offset Uint8Array view', () => {
        const encoded = encodeEmbeddingSet(sample);
        const padded = new Uint8Array(encoded.byteLength + 3);
        padded.set(encoded, 3);
        expect(decodeEmbeddingSet(encoded.slice().buffer).modelId).toBe(sample.modelId);
        expect(decodeEmbeddingSet(padded.subarray(3)).modelId).toBe(sample.modelId);
    });

    it('is deterministic', () => {
        expect(encodeEmbeddingSet(sample)).toEqual(encodeEmbeddingSet(sample));
    });

    it('rejects values that are not a whole number of rows', () => {
        expect(() => encodeEmbeddingSet({...sample, values: new Float32Array(4)})).toThrow('whole number of 3-dim rows');
    });

    it('rejects an empty set and an empty model id', () => {
        expect(() => encodeEmbeddingSet({...sample, values: new Float32Array(0)})).toThrow('empty');
        expect(() => encodeEmbeddingSet({...sample, modelId: ''})).toThrow('model id');
    });

    it('rejects bad magic, unknown version and truncated payloads', () => {
        const encoded = encodeEmbeddingSet(sample);
        const badMagic = encoded.slice(); badMagic[0] = 0;
        const badVersion = encoded.slice(); badVersion[4] = 2;
        expect(() => decodeEmbeddingSet(badMagic)).toThrow('not an embedding set');
        expect(() => decodeEmbeddingSet(badVersion)).toThrow('version 2');
        expect(() => decodeEmbeddingSet(encoded.subarray(0, encoded.byteLength - 1))).toThrow('length');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd fotos.core && npx vitest run src/embedding-set.test.ts`
Expected: FAIL, `Failed to resolve import "./embedding-set.js"`

- [ ] **Step 3: Implement**

`fotos.core/src/embedding-set.ts`:

```ts
/**
 * Self-describing binary container for a set of same-model embeddings.
 *
 * Used as the BLOB behind `analysis-output` FotosMediaVariants, so a receiver
 * can verify which model produced the vectors before comparing them.
 */

export const FOTOS_EMBEDDING_SET_MIME = 'application/vnd.fotos.embedding-set';

const MAGIC = [0x46, 0x45, 0x4d, 0x42]; // "FEMB"
const VERSION = 1;

export interface EmbeddingSet {
    modelId: string;
    dimensions: number;
    /** count × dimensions values, row-major */
    values: Float32Array;
}

export function embeddingSetCount(set: EmbeddingSet): number {
    return set.values.length / set.dimensions;
}

export function encodeEmbeddingSet(set: EmbeddingSet): Uint8Array {
    const modelId = new TextEncoder().encode(set.modelId);
    if (modelId.length === 0 || modelId.length > 255) {
        throw new Error(`Embedding set model id must be 1-255 bytes, got ${modelId.length}`);
    }
    if (!Number.isInteger(set.dimensions) || set.dimensions <= 0) {
        throw new Error(`Embedding set dimensions must be a positive integer, got ${set.dimensions}`);
    }
    if (set.values.length === 0) {
        throw new Error('Cannot encode an empty embedding set');
    }
    if (set.values.length % set.dimensions !== 0) {
        throw new Error(`Embedding set has ${set.values.length} values, not a whole number of ${set.dimensions}-dim rows`);
    }

    const count = set.values.length / set.dimensions;
    const headerLength = 4 + 1 + 1 + modelId.length + 4 + 4;
    const bytes = new Uint8Array(headerLength + set.values.length * 4);
    const view = new DataView(bytes.buffer);

    bytes.set(MAGIC, 0);
    view.setUint8(4, VERSION);
    view.setUint8(5, modelId.length);
    bytes.set(modelId, 6);
    let offset = 6 + modelId.length;
    view.setUint32(offset, set.dimensions, true);
    view.setUint32(offset + 4, count, true);
    offset += 8;
    for (let index = 0; index < set.values.length; index++) {
        view.setFloat32(offset + index * 4, set.values[index], true);
    }
    return bytes;
}

export function decodeEmbeddingSet(input: ArrayBuffer | Uint8Array): EmbeddingSet {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.byteLength < 6 || MAGIC.some((value, index) => bytes[index] !== value)) {
        throw new Error('Payload is not an embedding set');
    }
    const version = view.getUint8(4);
    if (version !== VERSION) {
        throw new Error(`Unsupported embedding set version ${version}`);
    }
    const modelIdLength = view.getUint8(5);
    const headerLength = 6 + modelIdLength + 8;
    if (bytes.byteLength < headerLength) {
        throw new Error(`Embedding set header truncated: length ${bytes.byteLength}`);
    }
    const modelId = new TextDecoder().decode(bytes.subarray(6, 6 + modelIdLength));
    const dimensions = view.getUint32(6 + modelIdLength, true);
    const count = view.getUint32(6 + modelIdLength + 4, true);
    const expectedLength = headerLength + dimensions * count * 4;
    if (bytes.byteLength !== expectedLength) {
        throw new Error(`Embedding set length ${bytes.byteLength} does not match header (expected ${expectedLength})`);
    }

    const values = new Float32Array(dimensions * count);
    for (let index = 0; index < values.length; index++) {
        values[index] = view.getFloat32(headerLength + index * 4, true);
    }
    return {modelId, dimensions, values};
}
```

In `fotos.core/src/index.ts` add:

```ts
export {
    FOTOS_EMBEDDING_SET_MIME,
    decodeEmbeddingSet,
    embeddingSetCount,
    encodeEmbeddingSet,
} from './embedding-set.js';
export type {EmbeddingSet} from './embedding-set.js';
```

- [ ] **Step 4: Run tests**

Run: `cd fotos.core && npx vitest run src/embedding-set.test.ts && npm run typecheck && npm run build`
Expected: PASS, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add fotos.core/src/embedding-set.ts fotos.core/src/embedding-set.test.ts fotos.core/src/index.ts
git commit -m "feat(fotos.core): versioned binary codec for embedding sets"
```

---

### Task 5: Publish analysis variants from browser sync

**Files:**
- Create: `fotos.browser/browser-ui/src/lib/one-storage-errors.ts`
- Create: `fotos.browser/browser-ui/src/lib/analysis-variants.ts`
- Create: `fotos.browser/browser-ui/src/lib/analysis-variants.test.ts`
- Modify: `fotos.browser/browser-ui/src/lib/fotos-sync.ts` (`isMissingVersionedObject` at :264, `isPhotoAlreadySynced` at :234, `storeFotosMediaState` at :637-651)
- Modify: `fotos.browser/browser-ui/src/lib/fotos-sync.test.ts`

**Interfaces:**
- Consumes: `encodeEmbeddingSet`, `FOTOS_EMBEDDING_SET_MIME` (Task 4); model ids (Task 1); `createFotosMediaVariant`, `EMBEDDING_DIM` from `@refinio/fotos.core`.
- Produces (from `analysis-variants.ts`):
  - `FACE_DETECTIONS_MIME = 'application/vnd.fotos.face-detections+json'`
  - `interface AnalysisPayload {modelId: string; mime: string; bytes: Uint8Array; digest: string}`
  - `buildAnalysisPayloads(photo: PhotoEntry): Promise<AnalysisPayload[]>`
  - `storeAnalysisVariants(photo: PhotoEntry, family: SHA256IdHash<FotosEntry>, original: SHA256IdHash<FotosMediaVariant>): Promise<StoredVariantRef[]>`
  - `hasCurrentAnalysisVariants(entry: FotosEntry, family: SHA256IdHash<FotosEntry>, photo: PhotoEntry): Promise<boolean>`
  - `loadEntryVariants(entry: FotosEntry): Promise<FotosMediaVariant[]>` (used by Task 6)
  - `interface StoredVariantRef {hash: SHA256Hash<FotosMediaVariant>; idHash: SHA256IdHash<FotosMediaVariant>}`
- Produces (from `one-storage-errors.ts`): `isMissingVersionedObject(error: unknown): boolean`

Face payloads come in pairs. A photo with `faces.count > 0` and `faces.embeddings` set produces one embedding set (label `FACE_EMBEDDING_MODEL_ID`) and one detections JSON (label `FACE_DETECTION_MODEL_ID`) holding the boxes and scores. A photo with `semantic` set produces one embedding set labelled with `semantic.modelId`. Variant `contentHash` is the SHA-256 hex of the payload bytes. The variant carries no `createdAt`, so it is fully determined by its content and the "already synced" check can recompute it.

- [ ] **Step 1: Move `isMissingVersionedObject`**

Create `fotos.browser/browser-ui/src/lib/one-storage-errors.ts` with the function body moved verbatim from `fotos-sync.ts:264-271`, exported:

```ts
/** A versioned object or blob that has not reached this instance (yet). */
export function isMissingVersionedObject(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = String((error as {name?: unknown}).name ?? '');
    const message = String((error as {message?: unknown}).message ?? '').toLowerCase();
    return name === 'FileNotFoundError'
        || message.includes('not found')
        || message.includes('sb-read2');
}
```

Delete it from `fotos-sync.ts` and add `import {isMissingVersionedObject} from './one-storage-errors.js';` there.

- [ ] **Step 2: Write the failing tests**

`fotos.browser/browser-ui/src/lib/analysis-variants.test.ts`:

```ts
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {blobs, objects, storeVersionedObjectMock, storeArrayBufferAsBlobMock, readBlobAsArrayBufferMock, getObjectWithTypeMock} = vi.hoisted(() => {
    const blobs = new Map<string, ArrayBuffer>();
    const objects = new Map<string, Record<string, unknown>>();
    return {
        blobs,
        objects,
        storeVersionedObjectMock: vi.fn(async (obj: Record<string, unknown>) => {
            const hash = `variant:${String(obj.contentHash)}`;
            objects.set(hash, obj);
            return {hash, idHash: `variant-id:${String(obj.contentHash)}`};
        }),
        storeArrayBufferAsBlobMock: vi.fn(async (buffer: ArrayBuffer) => {
            const hash = `blob:${blobs.size}`;
            blobs.set(hash, buffer);
            return {hash};
        }),
        readBlobAsArrayBufferMock: vi.fn(async (hash: string) => {
            const buffer = blobs.get(hash);
            if (!buffer) throw new Error(`blob ${hash} not found`);
            return buffer;
        }),
        getObjectWithTypeMock: vi.fn(async (hash: string) => {
            const obj = objects.get(hash);
            if (!obj) {
                const error = new Error('not found');
                error.name = 'FileNotFoundError';
                throw error;
            }
            return obj;
        }),
    };
});

vi.mock('@refinio/one.core/lib/storage-versioned-objects.js', () => ({storeVersionedObject: storeVersionedObjectMock}));
vi.mock('@refinio/one.core/lib/storage-blob.js', () => ({
    storeArrayBufferAsBlob: storeArrayBufferAsBlobMock,
    readBlobAsArrayBuffer: readBlobAsArrayBufferMock,
}));
vi.mock('@refinio/one.core/lib/storage-unversioned-objects.js', () => ({getObjectWithType: getObjectWithTypeMock}));

import {EMBEDDING_DIM, FACE_DETECTION_MODEL_ID, FACE_EMBEDDING_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID} from '@refinio/fotos.core';
import type {PhotoEntry} from '@/types/fotos';
import {buildAnalysisPayloads, hasCurrentAnalysisVariants, storeAnalysisVariants} from './analysis-variants';

const FAMILY = 'entry-id-hash' as any;
const ORIGINAL = 'original-variant-id-hash' as any;

function unit(dimensions: number, hot: number): Float32Array {
    const v = new Float32Array(dimensions);
    v[hot] = 1;
    return v;
}

function analysedPhoto(): PhotoEntry {
    const embeddings = new Float32Array(2 * EMBEDDING_DIM);
    embeddings.set(unit(EMBEDDING_DIM, 0), 0);
    embeddings.set(unit(EMBEDDING_DIM, 1), EMBEDDING_DIM);
    return {
        hash: 'photo-hash',
        name: 'photo.jpg',
        managed: 'metadata',
        tags: [],
        addedAt: '2026-11-08T00:00:00.000Z',
        size: 10,
        faces: {count: 2, bboxes: [[1, 2, 3, 4], [5, 6, 7, 8]], scores: [0.9, 0.8], embeddings, crops: []},
        semantic: {modelId: SEMANTIC_EMBEDDING_MODEL_ID, embedding: unit(4, 2)},
    };
}

beforeEach(() => {
    blobs.clear();
    objects.clear();
    vi.clearAllMocks();
});

describe('buildAnalysisPayloads', () => {
    it('produces face embeddings, face detections and semantic payloads with deterministic digests', async () => {
        const first = await buildAnalysisPayloads(analysedPhoto());
        const second = await buildAnalysisPayloads(analysedPhoto());
        expect(first.map(p => p.modelId)).toEqual([FACE_EMBEDDING_MODEL_ID, FACE_DETECTION_MODEL_ID, SEMANTIC_EMBEDDING_MODEL_ID]);
        expect(first.map(p => p.digest)).toEqual(second.map(p => p.digest));
        expect(first[0].digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces nothing for an unanalysed photo', async () => {
        const {faces: _faces, semantic: _semantic, ...photo} = analysedPhoto();
        expect(await buildAnalysisPayloads(photo)).toEqual([]);
    });

    it('rejects face data whose embeddings, boxes or scores disagree with the face count', async () => {
        const photo = analysedPhoto();
        await expect(buildAnalysisPayloads({...photo, faces: {...photo.faces!, count: 3}})).rejects.toThrow('photo.jpg');
        await expect(buildAnalysisPayloads({...photo, faces: {...photo.faces!, scores: [0.9]}})).rejects.toThrow('photo.jpg');
    });
});

describe('storeAnalysisVariants', () => {
    it('stores analysis-output variants derived from the original, labelled with the model id', async () => {
        const stored = await storeAnalysisVariants(analysedPhoto(), FAMILY, ORIGINAL);
        const variants = storeVersionedObjectMock.mock.calls.map(([obj]) => obj);
        const payloads = await buildAnalysisPayloads(analysedPhoto());

        expect(stored).toHaveLength(3);
        expect(variants).toEqual(payloads.map(payload => expect.objectContaining({
            $type$: 'FotosMediaVariant',
            contentHash: payload.digest,
            family: FAMILY,
            role: 'analysis-output',
            mime: payload.mime,
            byteSize: payload.bytes.byteLength,
            derivedFrom: ORIGINAL,
            label: payload.modelId,
        })));
        expect(variants.every(variant => !('createdAt' in variant))).toBe(true);
    });
});

describe('hasCurrentAnalysisVariants', () => {
    it('is true when the entry carries the current payloads and false after re-analysis', async () => {
        const stored = await storeAnalysisVariants(analysedPhoto(), FAMILY, ORIGINAL);
        const entry = {$type$: 'FotosEntry', contentHash: 'photo-hash', faceCount: 2, variants: new Set(stored.map(s => s.hash))} as any;

        expect(await hasCurrentAnalysisVariants(entry, FAMILY, analysedPhoto())).toBe(true);

        const reanalysed = {...analysedPhoto(), semantic: {modelId: SEMANTIC_EMBEDDING_MODEL_ID, embedding: unit(4, 3)}};
        expect(await hasCurrentAnalysisVariants(entry, FAMILY, reanalysed)).toBe(false);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/analysis-variants.test.ts`
Expected: FAIL, cannot resolve `./analysis-variants`.

- [ ] **Step 4: Implement `analysis-variants.ts` (writer half)**

```ts
/**
 * Per-photo analysis (face detections, face embeddings, CLIP embedding) as
 * `analysis-output` FotosMediaVariants derived from the original variant.
 *
 * Variant contentHash = SHA-256 of the payload bytes, and the variant has no
 * timestamp, so the same analysis always yields the same variant.
 */
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    createFotosMediaVariant,
    EMBEDDING_DIM,
    encodeEmbeddingSet,
    FACE_DETECTION_MODEL_ID,
    FACE_EMBEDDING_MODEL_ID,
    FOTOS_EMBEDDING_SET_MIME,
} from '@refinio/fotos.core';
import type {EmbeddingSet, FotosEntry, FotosMediaVariant} from '@refinio/fotos.core';
import type {PhotoEntry} from '@/types/fotos';
import {isMissingVersionedObject} from './one-storage-errors.js';

export const FACE_DETECTIONS_MIME = 'application/vnd.fotos.face-detections+json';

export interface AnalysisPayload {
    modelId: string;
    mime: string;
    bytes: Uint8Array;
    digest: string;
}

export interface StoredVariantRef {
    hash: SHA256Hash<FotosMediaVariant>;
    idHash: SHA256IdHash<FotosMediaVariant>;
}

interface FaceDetectionsDocument {
    modelId: string;
    faces: Array<{bbox: [number, number, number, number]; score: number}>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function payload(modelId: string, mime: string, bytes: Uint8Array): Promise<AnalysisPayload> {
    return {modelId, mime, bytes, digest: await sha256Hex(bytes)};
}

function embeddingPayload(set: EmbeddingSet): Promise<AnalysisPayload> {
    return payload(set.modelId, FOTOS_EMBEDDING_SET_MIME, encodeEmbeddingSet(set));
}

export async function buildAnalysisPayloads(photo: PhotoEntry): Promise<AnalysisPayload[]> {
    const payloads: AnalysisPayload[] = [];
    const faces = photo.faces;

    if (faces?.embeddings && faces.count > 0) {
        if (faces.embeddings.length !== faces.count * EMBEDDING_DIM
            || faces.bboxes.length !== faces.count
            || faces.scores.length !== faces.count) {
            throw new Error(
                `${photo.name}: face analysis is inconsistent (count ${faces.count}, `
                + `${faces.embeddings.length / EMBEDDING_DIM} embeddings, ${faces.bboxes.length} boxes, ${faces.scores.length} scores)`,
            );
        }
        payloads.push(await embeddingPayload({modelId: FACE_EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIM, values: faces.embeddings}));

        const detections: FaceDetectionsDocument = {
            modelId: FACE_DETECTION_MODEL_ID,
            faces: faces.bboxes.map((bbox, index) => ({bbox, score: faces.scores[index]})),
        };
        payloads.push(await payload(FACE_DETECTION_MODEL_ID, FACE_DETECTIONS_MIME, new TextEncoder().encode(JSON.stringify(detections))));
    }

    if (photo.semantic) {
        payloads.push(await embeddingPayload({
            modelId: photo.semantic.modelId,
            dimensions: photo.semantic.embedding.length,
            values: photo.semantic.embedding,
        }));
    }

    return payloads;
}

export async function storeAnalysisVariants(
    photo: PhotoEntry,
    family: SHA256IdHash<FotosEntry>,
    original: SHA256IdHash<FotosMediaVariant>,
): Promise<StoredVariantRef[]> {
    const stored: StoredVariantRef[] = [];
    for (const analysis of await buildAnalysisPayloads(photo)) {
        const blob = await storeArrayBufferAsBlob(analysis.bytes.slice().buffer);
        const variant = createFotosMediaVariant({
            contentHash: analysis.digest,
            family,
            role: 'analysis-output',
            mime: analysis.mime,
            byteSize: analysis.bytes.byteLength,
            blob: blob.hash,
            derivedFrom: original,
            label: analysis.modelId,
        });
        const result = await storeVersionedObject(variant as any);
        stored.push({
            hash: result.hash as SHA256Hash<FotosMediaVariant>,
            idHash: result.idHash as SHA256IdHash<FotosMediaVariant>,
        });
    }
    return stored;
}

/** Variants of an entry that have reached this instance; not-yet-arrived ones are skipped. */
export async function loadEntryVariants(entry: FotosEntry): Promise<FotosMediaVariant[]> {
    const variants: FotosMediaVariant[] = [];
    for (const hash of entry.variants ?? []) {
        try {
            variants.push(await getObjectWithType(hash, 'FotosMediaVariant') as FotosMediaVariant);
        } catch (error) {
            if (!isMissingVersionedObject(error)) throw error;
        }
    }
    return variants;
}

export async function hasCurrentAnalysisVariants(
    entry: FotosEntry,
    family: SHA256IdHash<FotosEntry>,
    photo: PhotoEntry,
): Promise<boolean> {
    const expected = (await buildAnalysisPayloads(photo)).map(analysis => analysis.digest);
    if (expected.length === 0) return true;

    const present = new Set(
        (await loadEntryVariants(entry))
            .filter(variant => variant.role === 'analysis-output' && String(variant.family) === String(family))
            .map(variant => variant.contentHash),
    );
    return expected.every(digest => present.has(digest));
}
```

Check that `EmbeddingSet`, `FotosEntry` and `FotosMediaVariant` are exported as types from `@refinio/fotos.core`'s index. `fotos-sync.ts` already imports `FotosMediaVariant` from there (line 46). Add any missing type export to `fotos.core/src/index.ts` and rebuild core.

- [ ] **Step 5: Run the tests**

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/analysis-variants.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing sync test**

In `fotos-sync.test.ts`, the `@refinio/fotos.core` mock only exposes `EMBEDDING_DIM` and `facesToDataAttrs`. Mock `./analysis-variants.js` instead of widening the core mock. Add to the hoisted block:

```ts
    storeAnalysisVariantsMock: vi.fn(async () => [
        {hash: 'analysis-variant-hash', idHash: 'analysis-variant-id-hash'},
    ]),
    hasCurrentAnalysisVariantsMock: vi.fn(async () => true),
```

(and destructure both names), then add next to the other `vi.mock` calls:

```ts
vi.mock('./analysis-variants.js', () => ({
    storeAnalysisVariants: storeAnalysisVariantsMock,
    hasCurrentAnalysisVariants: hasCurrentAnalysisVariantsMock,
}));
```

Add the resets to `beforeEach`:

```ts
        storeAnalysisVariantsMock.mockClear();
        hasCurrentAnalysisVariantsMock.mockReset().mockResolvedValue(true);
```

and the test:

```ts
    it('publishes analysis variants derived from the original variant and lists them on the entry', async () => {
        await syncPhotosToOneCore([{
            hash: 'photo-hash',
            name: 'photo.jpg',
            size: 4,
            managed: 'metadata',
            tags: [],
            addedAt: '2026-11-08T00:00:00.000Z',
        }], null, {claimAuthorship: false});

        expect(storeAnalysisVariantsMock).toHaveBeenCalledWith(
            expect.objectContaining({hash: 'photo-hash'}),
            'FotosEntry-id-hash',
            'FotosMediaVariant-id-hash',
        );
        const entry = storeVersionedObjectMock.mock.calls
            .map(([object]) => object)
            .find(object => object.$type$ === 'FotosEntry');
        expect([...(entry!.variants as Set<string>)]).toContain('analysis-variant-hash');
    });
```

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/fotos-sync.test.ts -t "analysis variants"`
Expected: FAIL, `storeAnalysisVariantsMock` not called.

- [ ] **Step 7: Wire into `fotos-sync.ts`**

Add the import:

```ts
import {hasCurrentAnalysisVariants, storeAnalysisVariants} from './analysis-variants.js';
```

In `storeFotosMediaState`, directly after
`variantIdHashes.add(originalVariantResult.idHash as SHA256IdHash<FotosMediaVariant>);` (line 651) insert:

```ts
    for (const analysis of await storeAnalysisVariants(
        photo,
        entryIdHash,
        originalVariantResult.idHash as SHA256IdHash<FotosMediaVariant>,
    )) {
        variants.add(analysis.hash);
        variantIdHashes.add(analysis.idHash);
    }
```

In `isPhotoAlreadySynced`, directly after `if (!originalVariant) return false;` (line 235) insert:

```ts
    if (!await hasCurrentAnalysisVariants(current, entryIdHash, photo)) return false;
```

- [ ] **Step 8: Run all sync tests**

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/fotos-sync.test.ts src/lib/analysis-variants.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add fotos.browser/browser-ui/src/lib/one-storage-errors.ts fotos.browser/browser-ui/src/lib/analysis-variants.ts fotos.browser/browser-ui/src/lib/analysis-variants.test.ts fotos.browser/browser-ui/src/lib/fotos-sync.ts fotos.browser/browser-ui/src/lib/fotos-sync.test.ts fotos.core/src/index.ts
git commit -m "feat(fotos.browser): publish face and semantic analysis as media variants"
```

---

### Task 6: Read remote analysis from variants; stop writing placeholder face data

**Files:**
- Modify: `fotos.browser/browser-ui/src/lib/analysis-variants.ts` (reader half)
- Modify: `fotos.browser/browser-ui/src/lib/analysis-variants.test.ts`
- Modify: `fotos.browser/browser-ui/src/lib/fotos-sync.ts` (delete `ExtractedFaceData`, `extractFaceDataFromEntry` :700-778, `writeFaceCropsToFilesystem` :803-827)
- Modify: `fotos.browser/browser-ui/src/hooks/useFolderAccess.ts` (imports :28-33, `buildFaceInfoFromExtractedEntry` :575, `buildFilesystemFaceInfoFromRemoteEntry` :613, `materializeRemoteFotosEntry` :656-710, remote merge :1880-1960)
- Modify: `fotos.browser/browser-ui/src/hooks/useFolderAccess.retention.test.ts:14` (mock list)

**Interfaces:**
- Consumes: `decodeEmbeddingSet`, `facesToDataAttrs`, `loadEntryVariants`, `FACE_DETECTIONS_MIME`.
- Produces (from `analysis-variants.ts`):
  - `interface RemoteFaceAnalysis {count: number; bboxes: Array<[number, number, number, number]>; scores: number[]; embeddings: Float32Array; dataAttrs: Record<string, string>}`
  - `interface RemoteAnalysis {faces?: RemoteFaceAnalysis; semantic?: SemanticInfo}`
  - `extractRemoteAnalysis(entry: FotosEntry, family: SHA256IdHash<FotosEntry>): Promise<RemoteAnalysis>`

Rules for the reader:
- A variant whose bytes or label are malformed throws.
- Two face-embedding variants, two face-detection variants or two semantic variants on one entry throw.
- A face embedding set whose row count differs from `entry.faceCount`, or from the detection count, throws.
- If one face variant has arrived and the other has not, `faces` stays `undefined` (still pending).

- [ ] **Step 1: Write the failing tests** (append to `analysis-variants.test.ts`, and add `extractRemoteAnalysis` to its import from `./analysis-variants`)

```ts
describe('extractRemoteAnalysis', () => {
    async function publishedEntry(photo = analysedPhoto()) {
        const stored = await storeAnalysisVariants(photo, FAMILY, ORIGINAL);
        return {$type$: 'FotosEntry', contentHash: 'photo-hash', faceCount: 2, variants: new Set(stored.map(s => s.hash))} as any;
    }

    it('round-trips faces and semantic embedding from published variants', async () => {
        const analysis = await extractRemoteAnalysis(await publishedEntry(), FAMILY);
        const photo = analysedPhoto();

        expect(analysis.faces?.count).toBe(2);
        expect(analysis.faces?.bboxes).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
        expect(analysis.faces?.scores).toEqual([0.9, 0.8]);
        expect(Array.from(analysis.faces!.embeddings)).toEqual(Array.from(photo.faces!.embeddings!));
        expect(analysis.faces?.dataAttrs['face-count']).toBe('2');
        expect(analysis.semantic?.modelId).toBe(SEMANTIC_EMBEDDING_MODEL_ID);
        expect(Array.from(analysis.semantic!.embedding)).toEqual([0, 0, 1, 0]);
    });

    it('leaves faces pending while one of the two face variants has not arrived', async () => {
        const entry = await publishedEntry();
        const detectionsHash = [...entry.variants].find((hash: string) => objects.get(hash)?.label === FACE_DETECTION_MODEL_ID);
        objects.delete(detectionsHash);

        const analysis = await extractRemoteAnalysis(entry, FAMILY);
        expect(analysis.faces).toBeUndefined();
        expect(analysis.semantic).toBeDefined();
    });

    it('throws when a payload was produced by a different model than its label claims', async () => {
        const entry = await publishedEntry();
        const semanticHash = [...entry.variants].find((hash: string) => objects.get(hash)?.label === SEMANTIC_EMBEDDING_MODEL_ID);
        objects.set(semanticHash, {...objects.get(semanticHash)!, label: 'other-model'});

        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('other-model');
    });

    it('throws when the face embedding count disagrees with the entry face count', async () => {
        const entry = {...await publishedEntry(), faceCount: 3};
        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('faceCount 3');
    });

    it('propagates blob read failures instead of substituting zeros', async () => {
        const entry = await publishedEntry();
        blobs.clear();
        await expect(extractRemoteAnalysis(entry, FAMILY)).rejects.toThrow('not found');
    });
});
```

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/analysis-variants.test.ts -t extractRemoteAnalysis`
Expected: FAIL, `extractRemoteAnalysis` is not exported.

- [ ] **Step 2: Implement the reader** (append to `analysis-variants.ts`; extend the imports with `readBlobAsArrayBuffer` from `@refinio/one.core/lib/storage-blob.js`, `decodeEmbeddingSet` and `facesToDataAttrs` from `@refinio/fotos.core`, and `SemanticInfo` from `@/types/fotos`)

```ts
export interface RemoteFaceAnalysis {
    count: number;
    bboxes: Array<[number, number, number, number]>;
    scores: number[];
    embeddings: Float32Array;
    /** Attributes for one/index.html, built from real detections only. */
    dataAttrs: Record<string, string>;
}

export interface RemoteAnalysis {
    faces?: RemoteFaceAnalysis;
    semantic?: SemanticInfo;
}

function requireSingle<T>(current: T | undefined, next: T, what: string, entry: FotosEntry): T {
    if (current !== undefined) {
        throw new Error(`FotosEntry ${entry.contentHash} carries more than one ${what} variant`);
    }
    return next;
}

export async function extractRemoteAnalysis(
    entry: FotosEntry,
    family: SHA256IdHash<FotosEntry>,
): Promise<RemoteAnalysis> {
    let faceEmbeddings: Float32Array | undefined;
    let detections: FaceDetectionsDocument | undefined;
    let semantic: SemanticInfo | undefined;

    for (const variant of await loadEntryVariants(entry)) {
        if (variant.role !== 'analysis-output' || String(variant.family) !== String(family)) continue;
        if (!variant.blob || !variant.label) {
            throw new Error(`Analysis variant ${variant.contentHash} has no blob or label`);
        }
        const bytes = await readBlobAsArrayBuffer(variant.blob);

        if (variant.mime === FACE_DETECTIONS_MIME) {
            const document = JSON.parse(new TextDecoder().decode(bytes)) as FaceDetectionsDocument;
            if (document.modelId !== variant.label || !Array.isArray(document.faces)) {
                throw new Error(`Face detections variant ${variant.contentHash} is malformed (model ${document.modelId}, label ${variant.label})`);
            }
            detections = requireSingle(detections, document, 'face detections', entry);
            continue;
        }

        if (variant.mime !== FOTOS_EMBEDDING_SET_MIME) {
            throw new Error(`Analysis variant ${variant.contentHash} has unknown mime ${variant.mime}`);
        }
        const set = decodeEmbeddingSet(bytes);
        if (set.modelId !== variant.label) {
            throw new Error(`Analysis variant ${variant.contentHash} is labelled ${variant.label} but contains ${set.modelId}`);
        }
        if (set.modelId === FACE_EMBEDDING_MODEL_ID) {
            if (set.dimensions !== EMBEDDING_DIM) {
                throw new Error(`Face embeddings for ${entry.contentHash} have ${set.dimensions} dimensions, expected ${EMBEDDING_DIM}`);
            }
            faceEmbeddings = requireSingle(faceEmbeddings, set.values, 'face embedding', entry);
        } else {
            semantic = requireSingle(semantic, {modelId: set.modelId, embedding: set.values}, 'semantic embedding', entry);
        }
    }

    const analysis: RemoteAnalysis = semantic ? {semantic} : {};
    if (!faceEmbeddings || !detections) {
        return analysis;
    }

    const count = faceEmbeddings.length / EMBEDDING_DIM;
    if (count !== entry.faceCount || detections.faces.length !== count) {
        throw new Error(
            `Face analysis for ${entry.contentHash} disagrees: faceCount ${entry.faceCount}, `
            + `${count} embeddings, ${detections.faces.length} detections`,
        );
    }

    const embeddings = faceEmbeddings;
    analysis.faces = {
        count,
        bboxes: detections.faces.map(face => face.bbox),
        scores: detections.faces.map(face => face.score),
        embeddings,
        dataAttrs: facesToDataAttrs({
            faces: detections.faces.map((face, index) => ({
                detection: {bbox: face.bbox, score: face.score, landmarks: []},
                embedding: Array.from(embeddings.subarray(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM)),
            })),
        }),
    };
    return analysis;
}
```

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/analysis-variants.test.ts`
Expected: PASS.

- [ ] **Step 3: Replace the old read path in `fotos-sync.ts`**

Delete `ExtractedFaceData`, `extractFaceDataFromEntry`, `writeFaceCropsToFilesystem` and their doc comments. Then delete any imports in `fotos-sync.ts` that are left unused (`facesToDataAttrs`, `readBlobAsArrayBuffer`, `FaceAnalysisResult`, `FaceResult` if nothing else uses them; `npm run typecheck` with `noUnusedLocals` or `eslint` will show which).

- [ ] **Step 4: Rewire `useFolderAccess.ts`**

Imports (lines 28-33): remove `extractFaceDataFromEntry` and `writeFaceCropsToFilesystem`, then add:

```ts
import {extractRemoteAnalysis} from '@/lib/analysis-variants';
import type {RemoteAnalysis, RemoteFaceAnalysis} from '@/lib/analysis-variants';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
```

(Skip the last line if `calculateIdHashOfObj` is already imported in this file.)

Replace both `buildFaceInfoFromExtractedEntry` and `buildFilesystemFaceInfoFromRemoteEntry` with one function:

```ts
/** FaceInfo for a remote entry: real detections when they have arrived, count-only while pending. */
function faceInfoFromRemoteAnalysis(entry: FotosEntry, faces: RemoteFaceAnalysis | undefined): FaceInfo | undefined {
    if (!entry.faceCount || entry.faceCount <= 0) {
        return undefined;
    }
    if (!faces) {
        return {count: entry.faceCount, bboxes: [], scores: [], embeddings: null, crops: []};
    }
    return {
        count: faces.count,
        bboxes: faces.bboxes,
        scores: faces.scores,
        embeddings: faces.embeddings,
        crops: [],
    };
}
```

In `materializeRemoteFotosEntry`:
- change the return type field `faceData: …` to `analysis: RemoteAnalysis;`
- replace `const faceData = await extractFaceDataFromEntry(entry);` with
  ```ts
  const analysis = await extractRemoteAnalysis(
      entry,
      await calculateIdHashOfObj(entry as any) as SHA256IdHash<FotosEntry>,
  );
  ```
- delete the `cropPaths` block (lines 670-675)
- set `faces: faceInfoFromRemoteAnalysis(entry, analysis.faces),` and add `...(analysis.semantic ? {semantic: analysis.semantic} : {}),` to the returned photo
- return `{photo, cacheEntries, analysis}`.

In the remote merge (around lines 1880-1960):
- `nextFaces`: replace the `rootHandle ? buildFilesystemFaceInfoFromRemoteEntry(...) : materialized.photo.faces` ternary with `materialized.photo.faces`.
- add `semantic: photo.semantic ?? materialized.photo.semantic,` to `nextPhoto`, and `|| nextPhoto.semantic !== photo.semantic` to `changed`.
- replace the flag block

  ```ts
  if (rootHandle && nextPhoto.faces !== photo.faces && materialized.faceData) {
      shouldWriteFilesystemFaces = true;
      filesystemPhoto = nextPhoto;
  }
  ```

  with

  ```ts
  if (rootHandle && nextPhoto.faces !== photo.faces && materialized.analysis.faces) {
      shouldWriteFilesystemFaces = true;
      filesystemPhoto = nextPhoto;
  }
  if (rootHandle && nextPhoto.semantic !== photo.semantic && nextPhoto.semantic) {
      shouldWriteFilesystemSemantic = true;
      filesystemPhoto = nextPhoto;
  }
  ```

  and declare `let shouldWriteFilesystemSemantic = false;` next to `shouldWriteFilesystemFaces`.
- in the write block, change the guard to `materialized.analysis.faces`, write `materialized.analysis.faces.dataAttrs` instead of `materialized.faceData.dataAttrs`, delete the `writeFaceCropsToFilesystem(...)` call, and add after it, still inside the existing `try`:

  ```ts
  if (shouldWriteFilesystemSemantic && photoForWrite.semantic) {
      await updateIndexHtmlSemanticData(rootHandle, photoForWrite, semanticToDataAttrs(photoForWrite.semantic));
  }
  ```

  Then make the block's outer condition `rootHandle && filesystemPhoto && (shouldWriteFilesystemFaces || shouldWriteFilesystemSemantic)`, and guard the face write inside it with `if (shouldWriteFilesystemFaces && materialized.analysis.faces)`.

In `useFolderAccess.retention.test.ts:14`, replace `extractFaceDataFromEntry: vi.fn(),` and `writeFaceCropsToFilesystem: vi.fn(),` in the `fotos-sync` mock: remove both, and add `vi.mock('@/lib/analysis-variants', () => ({extractRemoteAnalysis: vi.fn(async () => ({}))}));` next to it.

- [ ] **Step 5: Run the browser test suite and typecheck**

Run: `cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run && npm run typecheck`
Expected: all PASS. If a test still imports `extractFaceDataFromEntry`, it was testing the deleted zero-fill path; delete that test case.

- [ ] **Step 6: Two-device check**

Run the sync integration suite, which drives two browser instances:

```bash
cd fotos.browser/browser-ui && npm run test:integration:fotos-share
```

Expected: PASS. Then by hand: on device A open a folder, enable semantic search, let face and semantic passes finish; on device B, connected to A, open the shared gallery. The photo shows the right face count with real bounding boxes, the similar-face search finds it, and a semantic query finds it without B's semantic worker embedding that photo (watch the `Embedding images for semantic search` progress: the remote photo is not counted).

- [ ] **Step 7: Commit**

```bash
git add fotos.browser/browser-ui/src/lib/analysis-variants.ts fotos.browser/browser-ui/src/lib/analysis-variants.test.ts fotos.browser/browser-ui/src/lib/fotos-sync.ts fotos.browser/browser-ui/src/hooks/useFolderAccess.ts fotos.browser/browser-ui/src/hooks/useFolderAccess.retention.test.ts
git commit -m "fix(fotos.browser): materialize remote faces and semantic embeddings from analysis variants"
```

---

### Task 7: Drop the never-written `faceEmbeddings` / `faceCrops` fields

**Files:**
- Modify: `fotos.core/src/recipes/FotosRecipes.ts:53-54, 214-215`
- Modify: `fotos.core/src/sync-rules.ts:234-236`
- Modify: `fotos.browser/browser-ui/src/lib/fotosSyncRules.test.ts:76`

**Interfaces:**
- Produces: `FotosEntry` without `faceEmbeddings` / `faceCrops`.

- [ ] **Step 1: Confirm nothing references the fields**

Run: `grep -rn "faceEmbeddings\|faceCrops" --include=*.ts --include=*.tsx --include=*.mjs fotos.core/src fotos.browser/browser-ui/src fotos.ui/src fotos.expo fotos.headless fotos.gallery fotos.fire ../vger ../one/packages 2>/dev/null | grep -v node_modules`
Expected: only the recipe, `sync-rules.ts` and the test fixture.

- [ ] **Step 2: Remove them**

- `FotosRecipes.ts`: delete `faceEmbeddings?: SHA256Hash<BLOB>;` and `faceCrops?: SHA256Hash<BLOB>;` from the interface, and the two `itemprop` rules. `faceCount` stays, and its rule becomes the last element of the array, so remove the trailing comma if your lint requires it.
- `sync-rules.ts`: the face-count condition becomes the end of the expression:

  ```ts
          && (faceCount === undefined
              || (typeof faceCount === 'number'
                  && Number.isInteger(faceCount)
                  && faceCount >= 0
                  && faceCount <= MAX_FACE_COUNT));
  ```
- `fotosSyncRules.test.ts:76`: delete the `faceEmbeddings: 'embedding-hash',` line.

- [ ] **Step 3: Build and test**

```bash
cd fotos.core && npm run build && npx vitest run && npm run typecheck
```

```bash
cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run src/lib/fotosSyncRules.test.ts && npm run typecheck
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add fotos.core/src/recipes/FotosRecipes.ts fotos.core/src/sync-rules.ts fotos.browser/browser-ui/src/lib/fotosSyncRules.test.ts
git commit -m "refactor(fotos.core): remove unused FotosEntry face blob fields"
```

---

### Task 8: Document analysis variants

**Files:**
- Modify: `docs/fotos-media-model.md`

- [ ] **Step 1: Add a section after "### 3. Locators"**

```markdown
### 4. Analysis variants

Per-photo analysis is synced as `FotosMediaVariant` objects with role
`analysis-output`, `derivedFrom` the original variant:

| label (model id)        | mime                                          | payload |
|-------------------------|-----------------------------------------------|---------|
| `arcface-w600k-r50`     | `application/vnd.fotos.embedding-set`         | one 512-dim face embedding per detected face |
| `retinaface-det-10g`    | `application/vnd.fotos.face-detections+json`  | `{modelId, faces: [{bbox, score}]}`, same order |
| `clip-vit-base-patch32` | `application/vnd.fotos.embedding-set`         | one CLIP image embedding |

`contentHash` is the SHA-256 of the payload bytes and the variant carries no
timestamp, so identical analysis converges across devices and re-analysis
produces a new variant. The embedding-set format is defined in
[`embedding-set.ts`](../fotos.core/src/embedding-set.ts); readers reject a
payload whose embedded model id differs from the variant label.

Face crops are not synced yet. Similarity thresholds and model ids live in
[`similarity.ts`](../fotos.core/src/similarity.ts).
```

- [ ] **Step 2: Commit**

```bash
git add docs/fotos-media-model.md
git commit -m "docs(fotos): describe analysis-output variants"
```

---

## Final verification

```bash
cd fotos.core && npm run build && npx vitest run && npm run typecheck
```

```bash
cd fotos.ui && npx vitest run && npm run typecheck
```

```bash
cd fotos.browser/browser-ui && node ./scripts/run-vitest.mjs run && npm run typecheck && npm run build
```

```bash
cd fotos.browser/browser-ui && npm run test:integration:fotos-share
```

## Follow-ups (not in this plan)

- **Face crop sync** as `face-crop` variants. This needs a decision on how a device that only holds remote crop cache keys republishes them.
- **Expo and headless** producing analysis variants. Today only the browser computes faces and CLIP.
- **Merge the two face-search thresholds** (0.3 / 0.35) once someone has checked what users see with each.
- **HNSW-backed search.** All searches still compare against every photo. Measure at 50k photos before adding an index; `rankBySimilarity` is the single place to swap in.
- **Near-duplicate detection** (image-to-image CLIP similarity, or a perceptual hash) on top of `rankBySimilarity`.
- **Remaining swallowed errors next to this path:** `storeThumbnailBlob` / `storeEphemeralThumbnailBlob` return `undefined` on failure, and the remote face/semantic `index.html` write in `useFolderAccess` logs and continues.
