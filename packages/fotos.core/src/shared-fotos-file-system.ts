import type {OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import {calculateHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {createCryptoHash} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {projectReceivedFotosShares} from './received-shares.js';
import {readFotosOriginal} from './fotos-file-system.js';
import type {FotosEntry} from './recipes/FotosRecipes.js';
export {FotosRecipes} from './recipes/FotosRecipes.js';

/** Certificate lookup is recipient-scoped; never enumerate an entire photo library. */
export const FotosShareReverseMaps = new Map<OneObjectTypeNames, Set<string>>([
  ['FotosShareCertificateChain', new Set(['issuer', 'subject'])]
]);
/** Storage events that change received collection membership or its authorization. */
export const FOTOS_SHARE_TYPES = ['FotosShareManifest', 'FotosShareCertificateChain', 'FotosShareCertificate'] as const;

type Photo = {path: string; entry: FotosEntry; hash: string};
type Tree = {directories: Set<string>; photos: Photo[]; version: string};
type TreeGeneration = {generation: number; promise: Promise<Tree>};
export type SharedFotosFileSystemDiagnostics = {
  buildCount: number;
  cacheHitCount: number;
  invalidationCount: number;
  totalBuildMs: number;
  maxBuildMs: number;
  signatureVerificationCount: number;
  signatureVerificationCacheHitCount: number;
  totalSignatureVerificationMs: number;
  maxSignatureVerificationMs: number;
};
export type SharedFotosFileSystemInvalidation = {trustChanged?: boolean};
export type SharedFotosFileSystemDependencies = {
  project?: typeof projectReceivedFotosShares;
  readOriginal?: typeof readFotosOriginal;
  hashEntry?: (entry: FotosEntry) => Promise<string>;
  hashTree?: (value: string) => Promise<string>;
};
/** Surface the filesystem failure without converting missing originals into empty files. */
function failure(code: number, message: string): never { throw Object.assign(new Error(message), {code}); }
/** Validate virtual paths before selecting a shared collection. */
function canonical(value: string): string {
  if (value === '/') return value;
  if (!value.startsWith('/') || value.includes('\\') || value.includes('\0') ||
      value.slice(1).split('/').some(part => !part || part === '.' || part === '..')) failure(-22, 'Invalid Fotos path');
  return value;
}
/** Stable collection address includes its issuer to distinguish independently shared collections. */
export function getSharedFotosCollectionPath(scopeId: string, issuer: string): string {
  return `/${encodeURIComponent(scopeId).replace(/\./g, '%2E')} (${issuer})`;
}

/** Read-only collection folders reached through verified Fotos sharing certificates. */
export class SharedFotosFileSystem {
  private readonly observed = new Set<string>(['/Fotos']);
  private generation = 0;
  private currentTree?: TreeGeneration;
  private disposed = false;
  private buildCount = 0;
  private cacheHitCount = 0;
  private invalidationCount = 0;
  private totalBuildMs = 0;
  private maxBuildMs = 0;
  private trustGeneration = 0;
  private signatureVerificationCount = 0;
  private signatureVerificationCacheHitCount = 0;
  private totalSignatureVerificationMs = 0;
  private maxSignatureVerificationMs = 0;
  private readonly signatureVerifications = new Map<string, {
    trustGeneration: number;
    promise: Promise<boolean>;
  }>();
  private readonly project: typeof projectReceivedFotosShares;
  private readonly readOriginal: typeof readFotosOriginal;
  private readonly hashEntry: (entry: FotosEntry) => Promise<string>;
  private readonly hashTree: (value: string) => Promise<string>;

  /** Directories already seen by a native enumerator need invalidation after commits. */
  getObservedContainers(): string[] { return ['root', ...this.observed]; }
  /** Bounded evidence for projection build cost and cache effectiveness. */
  getDiagnostics(): SharedFotosFileSystemDiagnostics {
    return {
      buildCount: this.buildCount,
      cacheHitCount: this.cacheHitCount,
      invalidationCount: this.invalidationCount,
      totalBuildMs: this.totalBuildMs,
      maxBuildMs: this.maxBuildMs,
      signatureVerificationCount: this.signatureVerificationCount,
      signatureVerificationCacheHitCount: this.signatureVerificationCacheHitCount,
      totalSignatureVerificationMs: this.totalSignatureVerificationMs,
      maxSignatureVerificationMs: this.maxSignatureVerificationMs,
    };
  }
  constructor(private readonly subject: string,
    private readonly verifySignature: (signature: unknown) => Promise<boolean>,
    dependencies: SharedFotosFileSystemDependencies = {}) {
    this.project = dependencies.project ?? projectReceivedFotosShares;
    this.readOriginal = dependencies.readOriginal ?? readFotosOriginal;
    this.hashEntry = dependencies.hashEntry ?? (entry => calculateHashOfObj(entry));
    this.hashTree = dependencies.hashTree ?? (value => createCryptoHash(value));
  }

  /** Drop the verified projection synchronously when one of its owners changes. */
  invalidate(change: SharedFotosFileSystemInvalidation = {}): void {
    if (this.disposed) return;
    this.invalidationCount += 1;
    this.generation += 1;
    this.currentTree = undefined;
    if (change.trustChanged) {
      this.trustGeneration += 1;
      this.signatureVerifications.clear();
    }
  }

  /** Prevent late in-flight reads from publishing data after runtime shutdown. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.currentTree = undefined;
    this.signatureVerifications.clear();
    this.observed.clear();
  }

  /** Verify an immutable Signature once for the current trust projection. */
  private async verify(signature: unknown, signatureHash?: string): Promise<boolean> {
    if (!signatureHash) return this.profileSignatureVerification(signature);
    const trustGeneration = this.trustGeneration;
    const cached = this.signatureVerifications.get(signatureHash);
    if (cached?.trustGeneration === trustGeneration) {
      this.signatureVerificationCacheHitCount += 1;
      return cached.promise;
    }
    const promise = this.profileSignatureVerification(signature);
    const verification = {trustGeneration, promise};
    this.signatureVerifications.set(signatureHash, verification);
    void promise.catch(() => {
      if (this.signatureVerifications.get(signatureHash) === verification) {
        this.signatureVerifications.delete(signatureHash);
      }
    });
    return promise;
  }

  /** Record actual verifier work separately from projection traversal. */
  private async profileSignatureVerification(signature: unknown): Promise<boolean> {
    this.signatureVerificationCount += 1;
    const startedAt = Date.now();
    try {
      return await this.verifySignature(signature);
    } finally {
      const durationMs = Date.now() - startedAt;
      this.totalSignatureVerificationMs += durationMs;
      this.maxSignatureVerificationMs = Math.max(this.maxSignatureVerificationMs, durationMs);
    }
  }

  /** Read the sender's current collection snapshot only while its certificate is active. */
  private async buildTree(): Promise<Tree> {
    const scopes = (await this.project(this.subject, this.verify.bind(this))).filter(scope =>
      scope.scope.kind === 'collection' && scope.verified && scope.status === 'active');
    const directories = new Set(['/']);
    const photos: Photo[] = [];
    for (const scope of scopes) {
      const root = getSharedFotosCollectionPath(scope.scope.id, scope.issuer);
      directories.add(root);
      for (const entry of scope.entries) {
        if (!entry.sourcePath) failure(-22, 'Shared Fotos entry has no source path');
        const path = canonical(`${root}/${entry.sourcePath}`);
        if (photos.some(photo => photo.path === path)) failure(-17, 'Conflicting paths in a shared Fotos collection');
        photos.push({path, entry, hash: await this.hashEntry(entry)});
        let parent = path.slice(0, path.lastIndexOf('/'));
        while (parent !== root) { directories.add(parent); parent = parent.slice(0, parent.lastIndexOf('/')); }
      }
    }
    if (photos.some(photo => directories.has(photo.path))) failure(-17, 'Shared Fotos file conflicts with a directory');
    const version = await this.hashTree(JSON.stringify({
      shares: scopes.map(scope => [scope.certificateIdHash, scope.certificateHash]).sort(),
      photos: photos.map(photo => [photo.path, photo.hash]).sort()
    }));
    return {directories, photos, version};
  }

  /** Profile every owning build, including a stale or failed generation. */
  private createTreeGeneration(generation: number): TreeGeneration {
    this.buildCount += 1;
    const startedAt = Date.now();
    const promise = this.buildTree().finally(() => {
      const durationMs = Date.now() - startedAt;
      this.totalBuildMs += durationMs;
      this.maxBuildMs = Math.max(this.maxBuildMs, durationMs);
    });
    return {generation, promise};
  }

  /** Share one immutable verified tree until an explicit owner event advances its generation. */
  private async tree(): Promise<{tree: Tree; generation: number}> {
    for (;;) {
      if (this.disposed) failure(-5, 'Shared Fotos filesystem is disposed');
      const generation = this.generation;
      let current = this.currentTree;
      if (!current || current.generation !== generation) {
        current = this.createTreeGeneration(generation);
        this.currentTree = current;
      } else this.cacheHitCount += 1;
      const tree = await current.promise;
      if (this.disposed) failure(-5, 'Shared Fotos filesystem is disposed');
      if (this.generation === generation && this.currentTree === current) {
        return {tree, generation};
      }
    }
  }
  /** List only immediate descendants of verified collection folders. */
  async readDir(value: string) {
    const target = canonical(value);
    if (this.disposed) failure(-5, 'Shared Fotos filesystem is disposed');
    this.observed.add(target === '/' ? '/Fotos' : `/Fotos${target}`);
    const {tree} = await this.tree();
    if (!tree.directories.has(target)) failure(-2, 'Shared Fotos directory does not exist');
    const prefix = target === '/' ? '/' : `${target}/`;
    return {children: [...tree.directories, ...tree.photos.map(photo => photo.path)]
      .filter(path => path.startsWith(prefix) && path !== target && !path.slice(prefix.length).includes('/'))
      .map(path => path.slice(prefix.length)).sort()};
  }
  /** Content versions follow the selected entry and current authorized membership. */
  async stat(value: string) {
    const target = canonical(value);
    const {tree} = await this.tree();
    const photo = tree.photos.find(photo => photo.path === target);
    if (photo) return {mode: 0o100444, size: photo.entry.size, contentHash: photo.entry.contentHash,
      metadataHash: photo.hash, mimeType: photo.entry.mime};
    if (!tree.directories.has(target)) failure(-2, 'Shared Fotos item does not exist');
    return {mode: 0o40555, size: 0, contentHash: tree.version, metadataHash: tree.version};
  }
  /** Recheck current sharing state before exposing an original BLOB. */
  async readFile(value: string) {
    const target = canonical(value);
    for (;;) {
      const {tree, generation} = await this.tree();
      const photo = tree.photos.find(photo => photo.path === target);
      if (!photo) failure(tree.directories.has(target) ? -21 : -2, 'Shared Fotos file does not exist');
      const original = await this.readOriginal(photo.entry);
      if (this.disposed) failure(-5, 'Shared Fotos filesystem is disposed');
      if (this.generation === generation) return original;
    }
  }
  /** Materialize bounded original ranges through the same authorized entry. */
  async readFileInChunks(value: string, length: number, position: number) {
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) failure(-22, 'Invalid Fotos range');
    return {content: (await this.readFile(value)).content.slice(position, position + length)};
  }
  /** Native providers can hydrate the original in ranges. */
  supportsChunkedReading(): boolean { return true; }
  /** Collections are maintained by their fotos.one sender. */
  async createFile(): Promise<void> { failure(-30, 'Shared Fotos collections are read-only'); }
  /** Collections are maintained by their fotos.one sender. */
  async createDir(): Promise<void> { failure(-30, 'Shared Fotos collections are read-only'); }
  /** Collections are maintained by their fotos.one sender. */
  async unlink(): Promise<number> { return failure(-30, 'Shared Fotos collections are read-only'); }
  /** Collections are maintained by their fotos.one sender. */
  async rmdir(): Promise<number> { return failure(-30, 'Shared Fotos collections are read-only'); }
  /** Collections are maintained by their fotos.one sender. */
  async rename(): Promise<number> { return failure(-30, 'Shared Fotos collections are read-only'); }
  /** Collection permissions follow the share certificate. */
  async chmod(): Promise<number> { return failure(-30, 'Shared Fotos permissions are fixed'); }
  /** Original entries do not expose symbolic links. */
  async readlink(): Promise<{content: ArrayBuffer}> { return failure(-22, 'Not a symbolic link'); }
  /** Original entries do not expose symbolic links. */
  async symlink(): Promise<void> { failure(-30, 'Shared Fotos collections are read-only'); }
}
