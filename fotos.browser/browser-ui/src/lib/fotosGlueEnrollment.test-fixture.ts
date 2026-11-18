import '@refinio/one.core/lib/system/load-nodejs.js';
import nacl from 'tweetnacl';
import { fromByteArray } from 'base64-js';
import type { GlueEnrollmentReceipt } from '@glueone/auth.core';
import { CORE_RECIPES } from '@refinio/one.core/lib/recipes.js';
import { addRecipeToRuntime, hasRecipe } from '@refinio/one.core/lib/object-recipes.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';

/** Local custody fixture only; no registrar authentication or valid authority is implied. */
export async function createFotosEnrollmentFixture(): Promise<GlueEnrollmentReceipt> {
  for (const recipe of CORE_RECIPES.filter(value => ['Person', 'Instance'].includes(value.name))) {
    if (!hasRecipe(recipe.name)) addRecipeToRuntime(recipe);
  }
  const hex = (value: Uint8Array) => Buffer.from(value).toString('hex');
  const personEncryption = nacl.box.keyPair();
  const personSigning = nacl.sign.keyPair();
  const instanceEncryption = nacl.box.keyPair();
  const instanceSigning = nacl.sign.keyPair();
  const person = { $type$: 'Person' as const, email: 'gecko@glue.one' };
  const personId = await calculateIdHashOfObj(person);
  const instanceName = 'fotos-enrollment-test';
  const instanceId = await calculateIdHashOfObj({ $type$: 'Instance', owner: personId, name: instanceName });
  return {
    person, personId, instanceId, identity: 'gecko@glue.one',
    creds: { email: person.email, instanceName, secret: 'private-local-encryption-secret' },
    request: { instanceName, personEncryptionKey: hex(personEncryption.publicKey), personSigningKey: hex(personSigning.publicKey),
      instanceEncryptionKey: hex(instanceEncryption.publicKey), instanceSigningKey: hex(instanceSigning.publicKey) },
    keys: { personSecretEncryptionKey: fromByteArray(personEncryption.secretKey), personSecretSignKey: fromByteArray(personSigning.secretKey),
      instanceSecretEncryptionKey: fromByteArray(instanceEncryption.secretKey), instanceSecretSignKey: fromByteArray(instanceSigning.secretKey) },
    cert: {}, authorityCertificate: {}, instanceAuthorization: { person: personId, instance: instanceId, identity: 'gecko@glue.one' },
  } as GlueEnrollmentReceipt;
}
