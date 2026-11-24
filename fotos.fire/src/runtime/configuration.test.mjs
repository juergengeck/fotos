import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const requireNativePackages = createRequire(new URL('../../package.json', import.meta.url));
const compiled = await build({
  stdin: {
    contents: `${readFileSync(new URL('./recipes.ts', import.meta.url), 'utf8')}\nexport {fotosContentRules as domainRules} from '@refinio/fotos.core/sync-rules';`,
    resolveDir: packageRoot, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{name: 'native-package-graph', setup(builder) {
    // Metro uses the same Fotos domain source aliases and the app's installed
    // archives. Resolve the recipe composition against that exact package set.
    builder.onResolve({filter: /^@refinio\/fotos.core\/(one-core-config|sync-rules)$/}, args => ({
      path: fileURLToPath(new URL(`../../../fotos.core/src/${args.path.split('/').pop()}.ts`, import.meta.url)),
    }));
    builder.onResolve({filter: /^[^./]/}, args => args.pluginData?.nativePackages ? undefined
      : builder.resolve(args.path, {kind: args.kind, resolveDir: packageRoot, pluginData: {nativePackages: true}}));
  }}],
});
const evaluated = {exports: {}};
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(
  evaluated, evaluated.exports, requireNativePackages);
const {fireOneCoreConfig: config, domainRules} = evaluated.exports;

test('the installed native graph provides each retained owner schema without duplicate recipes', () => {
  const names = config.recipes.map(recipe => recipe.name);
  assert.equal(names.length, new Set(names).size);
  for (const name of ['Profile', 'Signature', 'AppSettings', 'Plan', 'Story', 'Assembly', 'Device',
    'Certificate', 'IssuerKeyLifecycleState', 'EffectiveIssuerKeyHead', 'PersonalTrustState',
    'OwnerCredentialTrustProjection', 'OwnerCredentialTrustState',
    'FotosEntry', 'FotosMediaVariant', 'FotosShareCertificate', 'FotosShareCertificateChain', 'FotosShareManifest']) {
    assert.equal(names.includes(name), true, `Missing current runtime schema: ${name}`);
  }
});

test('received-share authority indexes and Fotos-owned rules come from the public domain configuration', () => {
  for (const type of ['FotosShareCertificate', 'FotosShareCertificateChain']) {
    assert.deepEqual(config.reverseMaps.get(type), new Set(['subject', 'issuer']));
  }
  assert.deepEqual(config.reverseMaps.get('FotosSharePinProof'), new Set(['sender', 'prover']));
  for (const type of ['FotosShareCertificate', 'FotosShareCertificateChain', 'FotosShareManifest', 'FotosEntry']) {
    assert.equal(domainRules.has(type), true, `Missing Fotos-owned sync rule: ${type}`);
    assert.equal(config.syncRules.get(type), domainRules.get(type));
  }
  assert.equal(config.reverseMaps.has('OwnerCredentialTrustProjection'), true);
});
