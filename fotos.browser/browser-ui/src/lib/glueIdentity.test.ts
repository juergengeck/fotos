import '@refinio/one.core/lib/system/load-nodejs.js';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsPlan } from '@refinio/settings.core';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { updateGlueIdentityBinding } from '@glueone/glue.core';
import { recordAdmittedNativeGlueOwner } from './glueIdentityState.js';
import { ensureConfiguredGlueIdentity } from './glueIdentity.js';

vi.mock('@vger/vger.glue/plans/GlueIdentityPlan.js', () => ({
  GlueIdentityPlan: class {
    async createProfileCredential() { return { success: true, vcId: 'local-test-credential' }; }
  },
}));

function fixture() {
  const owner = 'a'.repeat(64) as SHA256IdHash<Person>;
  let values = updateGlueIdentityBinding({}, owner);
  const settingsPlan = {
    getSection: vi.fn(async () => ({ values })),
    updateSection: vi.fn(async (request: { values: Record<string, unknown> }) => { values = { ...values, ...request.values }; }),
  };
  const leuteModel = {
    me: vi.fn(async () => ({ profiles: async () => [] })),
    createCompleteIdentityForMyself: vi.fn(),
  };
  return { owner, settingsPlan, leuteModel };
}

describe('admitted native Glue identity settings', () => {
  it('keeps the admitted native Person when its display name changes', async () => {
    const { owner, settingsPlan, leuteModel } = fixture();
    recordAdmittedNativeGlueOwner(settingsPlan, owner);
    const result = await ensureConfiguredGlueIdentity(settingsPlan as unknown as SettingsPlan,
      leuteModel as unknown as LeuteModel, 'Gecko', owner);
    expect(result).toEqual({ personId: owner, created: false });
    expect(leuteModel.createCompleteIdentityForMyself).not.toHaveBeenCalled();
    expect(settingsPlan.updateSection).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ publicationIdentity: owner }) }));
  });

  it('retains legacy visitor behavior when owner equality has no admission evidence', async () => {
    const { owner, settingsPlan, leuteModel } = fixture();
    const expected = new Error('test stops before a new identity is created');
    leuteModel.createCompleteIdentityForMyself.mockRejectedValue(expected);
    await expect(ensureConfiguredGlueIdentity(settingsPlan as unknown as SettingsPlan,
      leuteModel as unknown as LeuteModel, 'Visitor', owner)).rejects.toBe(expected);
    expect(leuteModel.createCompleteIdentityForMyself).toHaveBeenCalledWith(expect.stringMatching(/^glue-public\+visitor-/), 'glue-public');
  });
});
