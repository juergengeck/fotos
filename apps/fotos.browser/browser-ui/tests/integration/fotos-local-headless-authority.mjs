import {generateKeyPairSync, sign} from 'node:crypto';
import {glueAuthorityCertificateSigningPayload} from '@glueone/glue.core/registration';

async function requireJson(response, action) {
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    throw new Error(`${action} failed (${response.status}): ${body.error ?? 'unknown error'}`);
  }
  return body;
}

/** Install a signed authority delegation for a fresh, local test registrar. */
export async function provisionLocalHeadlessAuthority(baseUrl, email, password) {
  const authority = await requireJson(
    await fetch(`${baseUrl}/api/registration/authority/publicKey`),
    'Read local Glue authority identity',
  );
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password}),
  });
  await requireJson(loginResponse, 'Log in to local headless');
  const cookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Local headless owner login returned no session cookie');

  const root = generateKeyPairSync('ed25519');
  const certificate = {
    $type$: 'GlueAuthorityCertificate',
    id: 'glue-authority-certificate',
    scope: 'glue.one/authority',
    authorityPublicKey: authority.data.publicKey,
    authorityOwnerId: authority.data.ownerId,
    issuer: 'refinio',
    issuerPublicKey: root.publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('hex'),
    issuedAt: Date.now() - 1_000,
    signature: '',
  };
  certificate.signature = sign(
    null,
    Buffer.from(glueAuthorityCertificateSigningPayload(certificate)),
    root.privateKey,
  ).toString('hex');
  await requireJson(
    await fetch(`${baseUrl}/api/registration/authority/certificate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Cookie: cookie},
      body: JSON.stringify({certificate}),
    }),
    'Install local Glue authority certificate',
  );
  return certificate;
}
