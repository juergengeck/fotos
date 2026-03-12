import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { SettingsPlan } from '@refinio/settings.core';
import { getDefaultSecretKeysAsBase64 } from '@refinio/one.core/lib/keychain/keychain.js';
import { sign, ensureSecretSignKey } from '@refinio/one.core/lib/crypto/sign.js';
import { getDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';
import { getPublicKeys } from '@refinio/one.core/lib/keychain/key-storage-public.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import {
  uint8arrayToHexString,
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import { fromByteArray as toBase64, toByteArray as fromBase64 } from 'base64-js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import { getLocalInstanceOfPerson } from '@refinio/one.models/lib/misc/instance.js';
import { GlueIdentityPlan, type GlueIdentityDeps } from '@vger/vger.glue/plans/GlueIdentityPlan.js';

async function getConfiguredGlueIdentity(
  settingsPlan: SettingsPlan,
): Promise<SHA256IdHash<Person>> {
  const { values } = await settingsPlan.getSection({ moduleId: 'glue' });
  const publicationIdentity =
    typeof values.publicationIdentity === 'string' ? values.publicationIdentity.trim() : '';

  if (!publicationIdentity) {
    throw new Error('No glue publication identity configured');
  }

  return publicationIdentity as SHA256IdHash<Person>;
}

async function getConfiguredGlueInstanceId(
  settingsPlan: SettingsPlan,
): Promise<string> {
  const publicationIdentity = await getConfiguredGlueIdentity(settingsPlan);
  return await getLocalInstanceOfPerson(publicationIdentity as any) as string;
}

function createGlueIdentityPlan(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
): GlueIdentityPlan {
  return new GlueIdentityPlan({
    leuteModel,
    settingsPlan,
    getDefaultSecretKeysAsBase64,
    getDefaultKeys,
    getPublicKeys,
    sign: sign as GlueIdentityDeps['sign'],
    ensureSecretSignKey,
    uint8arrayToHexString,
    calculateIdHashOfObj: calculateIdHashOfObj as GlueIdentityDeps['calculateIdHashOfObj'],
    fromBase64,
    toBase64,
    getInstanceIdHash: async () => await getConfiguredGlueInstanceId(settingsPlan),
    getInstanceKeys: async () => {
      const instanceIdHash = await getConfiguredGlueInstanceId(settingsPlan);
      const keysHash = await getDefaultKeys(instanceIdHash as any);
      const pubKeys = await getPublicKeys(keysHash);
      const { secretSignKey: secretBase64 } = await getDefaultSecretKeysAsBase64(instanceIdHash as any);
      return {
        publicEncryptionKey: pubKeys.publicEncryptionKey,
        publicSignKey: pubKeys.publicSignKey,
        secretSignKey: ensureSecretSignKey(fromBase64(secretBase64)),
      };
    },
    storeVersionedObject: async (obj: unknown) => {
      const result = await storeVersionedObject(obj as any);
      return { hash: result.hash as string, idHash: result.idHash as string };
    },
  });
}

function sanitizeDisplayName(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'anon';
}

function createLocalGlueIdentityEmail(displayName: string): string {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `glue-public+${sanitizeDisplayName(displayName)}-${suffix}@local.glue`;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const RECOVERABLE_CONFIGURED_IDENTITY_ERRORS = [
  'Specified profile version is not a version of the managed profile',
  'This identity is not managed by this someone object',
  'There are no local instances for that person',
] as const;

function isRecoverableConfiguredIdentityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RECOVERABLE_CONFIGURED_IDENTITY_ERRORS.some(fragment => message.includes(fragment));
}

async function clearConfiguredGlueIdentity(
  settingsPlan: SettingsPlan,
  glueDisplayName?: string | null,
): Promise<void> {
  await settingsPlan.updateSection({
    moduleId: 'glue',
    values: {
      publicationIdentity: '',
      ...(glueDisplayName ? { glueDisplayName } : {}),
    },
  });
}

async function validateConfiguredGlueIdentity(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
  configuredPublicationIdentity: SHA256IdHash<Person>,
  glueDisplayName?: string | null,
): Promise<SHA256IdHash<Person> | null> {
  try {
    await getLocalInstanceOfPerson(configuredPublicationIdentity as any);
    const me = await leuteModel.me() as {
      profiles: (identity: SHA256IdHash<Person>) => Promise<Array<any>>;
    };
    await me.profiles(configuredPublicationIdentity);
    return configuredPublicationIdentity;
  } catch (error) {
    if (!isRecoverableConfiguredIdentityError(error)) {
      throw error;
    }

    console.warn('[fotos.one] Resetting stale configured glue identity:', error);
    await clearConfiguredGlueIdentity(settingsPlan, glueDisplayName);
    return null;
  }
}

export function extractPrivateSigningKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Private key is required');
  }

  const parts = trimmed.split(';').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Private key is required');
  }

  return parts[parts.length - 1]!;
}

export async function createGlueProfileCredential(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
): Promise<void> {
  const plan = createGlueIdentityPlan(settingsPlan, leuteModel);
  const result = await plan.createProfileCredential();
  if (!result.success) {
    console.error('[glue.one] Failed to create GlueProfileCredential:', result.error);
  } else {
    console.log('[glue.one] GlueProfileCredential created:', result.vcId);
  }
}

export async function ensureConfiguredGlueIdentity(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
  displayName: string,
  ownerId: SHA256IdHash<Person> | null,
): Promise<{ personId: SHA256IdHash<Person>; created: boolean }> {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    throw new Error('Glue display name is required');
  }

  const { values } = await settingsPlan
    .getSection({ moduleId: 'glue' })
    .catch(() => ({ values: {} as Record<string, unknown> }));
  let configuredPublicationIdentity = asTrimmedString(values.publicationIdentity);
  if (configuredPublicationIdentity && configuredPublicationIdentity !== ownerId) {
    configuredPublicationIdentity = await validateConfiguredGlueIdentity(
      settingsPlan,
      leuteModel,
      configuredPublicationIdentity as SHA256IdHash<Person>,
      trimmedDisplayName,
    );
  }
  const needsFreshGlueIdentity =
    !configuredPublicationIdentity || configuredPublicationIdentity === ownerId;

  if (!needsFreshGlueIdentity) {
    if (values.glueDisplayName !== trimmedDisplayName) {
      await settingsPlan.updateSection({
        moduleId: 'glue',
        values: { glueDisplayName: trimmedDisplayName },
      });
    }
    // Ensure PersonName is on the glue Person's profile (retroactive fix + name changes)
    try {
      const me = await leuteModel.me();
      const glueProfiles = await me.profiles(configuredPublicationIdentity as SHA256IdHash<Person>);
      if (glueProfiles.length > 0) {
        const profile = glueProfiles[0];
        const hasName = profile.personDescriptions.some(
          (d: any) => d?.$type$ === 'PersonName' && d.name === trimmedDisplayName,
        );
        if (!hasName) {
          profile.personDescriptions = [
            ...profile.personDescriptions.filter((d: any) => d?.$type$ !== 'PersonName'),
            { $type$: 'PersonName' as const, name: trimmedDisplayName },
          ];
          await profile.saveAndLoad();
        }
      }
    } catch (err) {
      console.warn('[fotos.one] Failed to update glue profile PersonName:', err);
    }
    await createGlueProfileCredential(settingsPlan, leuteModel);
    return {
      personId: configuredPublicationIdentity as SHA256IdHash<Person>,
      created: false,
    };
  }

  const profile = await leuteModel.createCompleteIdentityForMyself(
    createLocalGlueIdentityEmail(trimmedDisplayName),
    'glue-public',
  );
  const publicationIdentity = profile.personId as SHA256IdHash<Person>;

  // Set PersonName on the glue Person's profile so sender name resolves correctly
  profile.personDescriptions = [
    ...profile.personDescriptions.filter((d: any) => d?.$type$ !== 'PersonName'),
    { $type$: 'PersonName' as const, name: trimmedDisplayName },
  ];
  await profile.saveAndLoad();

  await settingsPlan.updateSection({
    moduleId: 'glue',
    values: {
      publicationIdentity,
      glueDisplayName: trimmedDisplayName,
    },
  });

  await createGlueProfileCredential(settingsPlan, leuteModel);

  return {
    personId: publicationIdentity,
    created: true,
  };
}

export async function ensureStartupGlueIdentity(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
  ownerId: SHA256IdHash<Person> | null,
  fallbackDisplayName = 'anonymous',
): Promise<{ personId: SHA256IdHash<Person>; created: boolean; displayName: string | null }> {
  const glueSection = await settingsPlan
    .getSection({ moduleId: 'glue' })
    .catch(() => ({ values: {} as Record<string, unknown> }));
  const subscriptionSection = await settingsPlan
    .getSection({ moduleId: 'subscription' })
    .catch(() => ({ values: {} as Record<string, unknown> }));

  let configuredPublicationIdentity = asTrimmedString(glueSection.values.publicationIdentity);
  const storedGlueDisplayName = asTrimmedString(glueSection.values.glueDisplayName);
  const subscriptionDisplayName = asTrimmedString(subscriptionSection.values.displayName);

  let profileDisplayName: string | null = null;
  try {
    const me = await leuteModel.me() as {
      getMainProfileDisplayName?: () => Promise<string | null>;
    };
    if (typeof me.getMainProfileDisplayName === 'function') {
      profileDisplayName = asTrimmedString(await me.getMainProfileDisplayName());
    }
  } catch {
    profileDisplayName = null;
  }

  const preferredDisplayName =
    storedGlueDisplayName ??
    subscriptionDisplayName ??
    profileDisplayName;

  if (configuredPublicationIdentity && configuredPublicationIdentity !== ownerId) {
    configuredPublicationIdentity = await validateConfiguredGlueIdentity(
      settingsPlan,
      leuteModel,
      configuredPublicationIdentity as SHA256IdHash<Person>,
      preferredDisplayName,
    );
  }

  const needsFreshGlueIdentity =
    !configuredPublicationIdentity || configuredPublicationIdentity === ownerId;

  if (!needsFreshGlueIdentity && !preferredDisplayName) {
    await createGlueProfileCredential(settingsPlan, leuteModel);
    return {
      personId: configuredPublicationIdentity as SHA256IdHash<Person>,
      created: false,
      displayName: null,
    };
  }

  const fallbackName = asTrimmedString(fallbackDisplayName) ?? 'anonymous';
  const effectiveDisplayName = preferredDisplayName ?? fallbackName;
  const result = await ensureConfiguredGlueIdentity(
    settingsPlan,
    leuteModel,
    effectiveDisplayName,
    ownerId,
  );

  return {
    ...result,
    displayName: effectiveDisplayName,
  };
}

export async function getGluePrivateSigningKey(
  settingsPlan: SettingsPlan,
  leuteModel: LeuteModel,
): Promise<string> {
  const plan = createGlueIdentityPlan(settingsPlan, leuteModel);
  const result = await plan.getPrivateKey();
  if (!result.success || !result.privateKey) {
    throw new Error(result.error || 'No glue.one identity configured');
  }
  return result.privateKey;
}
