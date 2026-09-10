import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {FOTOS_APP_BOOK_DEFINITION as appBook} from '../app-book.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_SOURCE_PREFIX = 'repo://fotos/';

function collectSourceRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourceRefs(item, refs);
    return refs;
  }
  if (value === null || typeof value !== 'object') return refs;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'sourceRefs') {
      assert.ok(Array.isArray(child), 'sourceRefs must be an array');
      refs.push(...child);
      continue;
    }
    collectSourceRefs(child, refs);
  }
  return refs;
}

function hasRunnableEvidence(binding) {
  return binding.status === 'active' && binding.evidence?.some(evidence => {
    if (typeof evidence.command !== 'string' || evidence.command.trim() === '') return false;
    if (typeof evidence.cwd !== 'string' || evidence.cwd.trim() === '') return false;
    return existsSync(resolve(REPOSITORY_ROOT, evidence.cwd));
  });
}

test('Fotos App Book has one stable app identity', () => {
  assert.equal(appBook.book.name, 'fotos.one');
  assert.equal(appBook.book.title, 'Fotos');
  assert.ok(Array.isArray(appBook.journeys));
});

test('every Fotos journey is complete product intent with honest evidence state', () => {
  const journeys = appBook.journeys;
  assert.ok(Array.isArray(journeys) && journeys.length > 0);

  for (const journey of journeys) {
    assert.ok(journey.id.startsWith('fotos.app.journey.'));
    assert.ok(
      appBook.book.entryIds.includes(journey.id),
      `journey missing from entryIds: ${journey.id}`,
    );
  }

  assert.equal(new Set(journeys.map(j => j.id)).size, journeys.length);

  const bindingIds = appBook.flowBindings.map(binding => binding.id);
  assert.equal(new Set(bindingIds).size, bindingIds.length);
  const journeyIdSet = new Set(journeys.map(j => j.id));
  for (const binding of appBook.flowBindings) {
    assert.ok(journeyIdSet.has(binding.flowId), `unknown flowId ${binding.flowId}`);
  }

  for (const journey of journeys) {
    assert.equal(typeof journey.implementationStatus, 'string');
    assert.ok(journey.implementationStatus.trim().length > 0);
    assert.ok(journey.actorRoles.length > 0);
    assert.ok(journey.steps.length >= 2);
    assert.ok(journey.outputContracts.length > 0);
    assert.ok(journey.verificationChecks.length > 0);
    assert.ok(journey.sourceRefs.length > 0);

    const bindings = appBook.flowBindings.filter(binding => binding.flowId === journey.id);
    if (journey.implementationStatus === 'unbound') {
      assert.equal(bindings.length, 0, `${journey.id} is unbound but has a flow binding`);
    } else {
      assert.ok(
        bindings.some(hasRunnableEvidence),
        `${journey.id} is ${journey.implementationStatus} but has no active runnable evidence`,
      );
    }
  }
});

test('the spatial disclosure journey keeps announcement separable from publication', () => {
  const journey = appBook.journeys.find(
    item => item.id === 'fotos.app.journey.choose-scope-spatial-disclosure',
  );
  assert.ok(journey, 'the spatial disclosure journey must exist');

  const stepIds = journey.steps.map(step => step.id);

  // Silence is the starting state, not an option reached by opting out.
  assert.equal(stepIds[0], 'default-silent');

  // Nothing may be disclosed before the publisher has been shown what it discloses.
  assert.ok(
    stepIds.indexOf('show-the-disclosure') < stepIds.indexOf('choose-precision'),
    'the exposure must be shown before a precision is chosen',
  );
  assert.ok(
    stepIds.indexOf('choose-precision') < stepIds.indexOf('announce'),
    'a precision must be chosen before anything is announced',
  );

  // Withdrawal is part of the journey, not a follow-up someone may forget.
  assert.ok(stepIds.includes('withdraw'));

  const checks = journey.verificationChecks.join('\n');
  assert.match(checks, /announces no spatial facet/i, 'the default must be stated as a check');
  assert.match(checks, /exifGpsLat/, 'derivation from EXIF must be constrained by a check');
  assert.match(checks, /revoked/i, 'revoked scopes must be covered by a check');
  assert.match(checks, /TTL/, 'withdrawal must state its propagation bound');
});

test('every repository source reference resolves from the Fotos repository root', () => {
  const sourceRefs = collectSourceRefs(appBook);

  assert.ok(sourceRefs.length > 0);
  for (const ref of new Set(sourceRefs)) {
    assert.equal(typeof ref, 'string', 'source references must be strings');
    assert.ok(ref.trim().length > 0, 'source references must not be empty');
    if (!ref.startsWith(REPOSITORY_SOURCE_PREFIX)) continue;

    const relativePath = ref.slice(REPOSITORY_SOURCE_PREFIX.length);
    assert.ok(relativePath.length > 0, `empty repository source reference: ${ref}`);

    const target = resolve(REPOSITORY_ROOT, relativePath);
    assert.ok(
      target === REPOSITORY_ROOT || target.startsWith(`${REPOSITORY_ROOT}/`),
      `repository source reference escapes the repository: ${ref}`,
    );
    assert.ok(existsSync(target), `missing repository source reference: ${ref}`);
  }
});

test('every distinct active flow evidence command passes', () => {
  const commands = new Map();

  for (const binding of appBook.flowBindings) {
    if (binding.status !== 'active') continue;
    for (const evidence of binding.evidence ?? []) {
      if (typeof evidence.command !== 'string' || evidence.command.trim() === '') continue;
      if (typeof evidence.cwd !== 'string' || evidence.cwd.trim() === '') continue;
      commands.set(`${evidence.cwd}::${evidence.command}`, evidence);
    }
  }

  for (const evidence of commands.values()) {
    const cwd = resolve(REPOSITORY_ROOT, evidence.cwd);
    assert.ok(existsSync(cwd), `evidence cwd does not exist: ${evidence.cwd}`);
    const result = spawnSync('sh', ['-c', evidence.command], {cwd, encoding: 'utf8'});
    assert.equal(
      result.status,
      0,
      `evidence command failed: ${evidence.command}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
});
