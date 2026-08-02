import { describe, expect, it } from 'vitest';

import {
  FotosOneCoreRecipes,
  FotosReverseMaps,
  mergeReverseMapDefinitions,
} from './fotosOneCoreConfig';

describe('Fotos ONE.core runtime configuration', () => {
  it('registers the connection projection recipes used by pairing', () => {
    const recipeNames = new Set(FotosOneCoreRecipes.map(recipe => recipe.name));

    expect(recipeNames).toContain('IomRouteObservation');
    expect(recipeNames).toContain('CurrentInstanceConnection');
  });

  it('keeps every property when reverse-map packages overlap', () => {
    const merged = mergeReverseMapDefinitions(
      new Map([['SharedType', new Set(['subject'])]]),
      new Map([['SharedType', new Set(['issuer'])]]),
    );

    expect([...merged.get('SharedType') ?? []].sort()).toEqual(['issuer', 'subject']);
    expect(FotosReverseMaps.get('FotosShareCertificate')).toEqual(new Set(['subject', 'issuer']));
    expect(FotosReverseMaps.get('FotosShareCertificateChain')).toEqual(new Set(['subject', 'issuer']));
  });
});
