#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function loadConfig() {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const headlessDir = path.resolve(scriptDir, '..');
  const defaultConfigPath = path.join(headlessDir, 'config', 'batch.env');
  const env = {};
  if (process.env.FOTOS_HEADLESS_BATCH_CONFIG && await fileExists(process.env.FOTOS_HEADLESS_BATCH_CONFIG)) {
    Object.assign(env, parseEnvFile(await fs.readFile(process.env.FOTOS_HEADLESS_BATCH_CONFIG, 'utf8')));
  } else if (await fileExists(defaultConfigPath)) {
    Object.assign(env, parseEnvFile(await fs.readFile(defaultConfigPath, 'utf8')));
  }
  Object.assign(env, process.env);
  const limit = Number.parseInt(String(env.TEST_BATCH_LIMIT || '6'), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`TEST_BATCH_LIMIT must be a positive integer, got ${env.TEST_BATCH_LIMIT}`);
  }
  return {
    SCHWEIZ_HOST: String(env.SCHWEIZ_HOST || 'schweiz').trim(),
    SCHWEIZ_SOURCE_DIR: String(env.SCHWEIZ_SOURCE_DIR || '/volume2/homes/gecko/Photos/Photos').trim(),
    SCHWEIZ_TEST_BATCH_DIR: String(env.SCHWEIZ_TEST_BATCH_DIR || '/volume2/homes/gecko/Photos/TestBatches/fotos-headless').trim(),
    SCHWEIZ_HEADLESS_BASE_URL: String(env.SCHWEIZ_HEADLESS_BASE_URL || '').trim(),
    SPARK_EMBED_BASE_URL: String(env.SPARK_EMBED_BASE_URL || 'http://192.168.178.117:8103').trim().replace(/\/$/, ''),
    SPARK_EMBED_MODEL: String(env.SPARK_EMBED_MODEL || 'gemma-4-e4b-it-vllm').trim(),
    TEST_BATCH_NAME: String(env.TEST_BATCH_NAME || 'fotos-headless-semantic-smoke').trim(),
    TEST_BATCH_PROMPT: String(env.TEST_BATCH_PROMPT || 'Represent the given image.').trim(),
    TEST_BATCH_LIMIT: limit,
    TEST_BATCH_EXTENSIONS: String(env.TEST_BATCH_EXTENSIONS || '.jpg,.jpeg,.png,.webp,.heic,.heif')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  };
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function listRemoteSampleFiles(config) {
  const walker = `
import json
import os
import sys

root = sys.argv[1]
limit = int(sys.argv[2])
extensions = {value.strip().lower() for value in sys.argv[3].split(",") if value.strip()}
matches = []

for current_root, dirnames, filenames in os.walk(root):
    dirnames.sort()
    dirnames[:] = [name for name in dirnames if name != "@eaDir"]
    filenames.sort()
    for name in filenames:
        if os.path.splitext(name)[1].lower() not in extensions:
            continue
        absolute_path = os.path.join(current_root, name)
        matches.append(os.path.relpath(absolute_path, root))
        if len(matches) >= limit:
            print(json.dumps(matches))
            raise SystemExit(0)

print(json.dumps(matches))
`;
  const remoteCommand = [
    'python3',
    '-c',
    walker,
    config.SCHWEIZ_SOURCE_DIR,
    String(config.TEST_BATCH_LIMIT),
    config.TEST_BATCH_EXTENSIONS.join(','),
  ].map(shellQuote).join(' ');
  const { stdout } = await runCommand('ssh', [
    config.SCHWEIZ_HOST,
    remoteCommand,
  ]);
  const files = JSON.parse(stdout);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`No embeddable files found under ${config.SCHWEIZ_SOURCE_DIR}`);
  }
  return files;
}

async function extractRemoteFiles(config, relativePaths, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const remoteCommand = `tar -czf - -C ${shellQuote(config.SCHWEIZ_SOURCE_DIR)} -T -`;
  await new Promise((resolve, reject) => {
    const ssh = spawn('ssh', [config.SCHWEIZ_HOST, remoteCommand], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const untar = spawn('tar', ['-xzf', '-', '-C', targetDir], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    ssh.stderr.on('data', chunk => {
      stderr += chunk;
    });
    untar.stderr.on('data', chunk => {
      stderr += chunk;
    });
    ssh.on('error', reject);
    untar.on('error', reject);
    ssh.stdout.pipe(untar.stdin);
    ssh.stdin.end(`${relativePaths.join('\n')}\n`);

    let sshCode = null;
    let untarCode = null;
    const maybeFinish = () => {
      if (sshCode === null || untarCode === null) {
        return;
      }
      if (sshCode === 0 && untarCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to extract remote sample: ${stderr}`));
    };
    ssh.on('close', code => {
      sshCode = code;
      maybeFinish();
    });
    untar.on('close', code => {
      untarCode = code;
      maybeFinish();
    });
  });
}

function sanitizeSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'photo';
}

function portableFileName(relativePath, index) {
  const originalExtension = path.extname(relativePath);
  const extension = originalExtension.toLowerCase();
  const originalBaseName = path.basename(relativePath);
  const stem = originalExtension
    ? originalBaseName.slice(0, originalBaseName.length - originalExtension.length)
    : originalBaseName;
  const baseName = sanitizeSegment(stem);
  const parent = sanitizeSegment(path.dirname(relativePath).split(path.sep).filter(Boolean).slice(-2).join('-'));
  const prefix = String(index + 1).padStart(3, '0');
  return `${prefix}-${parent}-${baseName}${extension}`;
}

function detectMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    default:
      return 'application/octet-stream';
  }
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

function decodeBase64Float32(value) {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Invalid base64 float payload');
  }
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}

function normalizeFloat32(values) {
  let magnitude = 0;
  for (let index = 0; index < values.length; index += 1) {
    magnitude += values[index] * values[index];
  }
  const scale = Math.sqrt(magnitude);
  if (!Number.isFinite(scale) || scale === 0) {
    throw new Error('Cannot normalize a zero-length embedding');
  }
  const normalized = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = values[index] / scale;
  }
  return normalized;
}

function encodeFloat32Base64(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64');
}

function normalizeEmbeddingPayload(payload) {
  if (typeof payload?.embeddings?.base64?.[0] === 'string') {
    return encodeFloat32Base64(normalizeFloat32(decodeBase64Float32(payload.embeddings.base64[0])));
  }
  if (Array.isArray(payload?.embeddings?.float?.[0])) {
    return encodeFloat32Base64(normalizeFloat32(Float32Array.from(payload.embeddings.float[0])));
  }
  throw new Error(`Spark embed response did not include a supported embedding payload: ${JSON.stringify(payload)}`);
}

async function embedImage(config, filePath, mimeType) {
  const fileBytes = await fs.readFile(filePath);
  const dataUrl = `data:${mimeType};base64,${fileBytes.toString('base64')}`;
  const response = await fetch(`${config.SPARK_EMBED_BASE_URL}/v2/embed`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.SPARK_EMBED_MODEL,
      inputs: [
        {
          content: [
            { type: 'text', text: config.TEST_BATCH_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      embedding_types: ['base64', 'float'],
    }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Spark embed request failed (${response.status}): ${text}`);
  }
  return {
    modelId: String(payload.model || config.SPARK_EMBED_MODEL),
    embedding: normalizeEmbeddingPayload(payload),
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / (1024 ** power);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[power]}`;
}

function formatDate(epochMs) {
  return new Date(epochMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function renderIndexHtml(batchName, entries, scannedAt) {
  const scannedIso = new Date(scannedAt).toISOString();
  const entryRows = entries.map(entry => {
    const attrs = Object.entries(entry.data).map(([key, value]) => {
      return ` data-${escapeHtml(key)}="${escapeHtml(value)}"`;
    }).join('');
    return `        <tr class="fs-entry" data-mime="${escapeHtml(entry.mime)}" data-hash="${escapeHtml(entry.contentHash)}"${attrs}>
            <td class="fs-icon">&#128444;</td>
            <td class="fs-name"><a href="../${escapeHtml(entry.name)}" target="_blank">${escapeHtml(entry.name)}</a></td>
            <td class="fs-faces"></td>
            <td class="fs-size">${formatSize(entry.size)}</td>
            <td class="fs-date">${formatDate(entry.mtimeMs)}</td>
            <td class="fs-path">${escapeHtml(entry.sourcePath)}</td>
        </tr>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="fotos.headless semantic batch">
<title>${escapeHtml(batchName)}</title>
<style>
:root{--fs-bg:#0e0e0e;--fs-fg:#d4d4d4;--fs-muted:#666;--fs-border:#222;--fs-accent:#4a9eff;--fs-row-hover:rgba(255,255,255,0.03)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--fs-bg);color:var(--fs-fg);line-height:1.5}
.fs-node{max-width:960px;margin:0 auto;padding:24px 20px}
.fs-header{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--fs-border)}
.fs-title{font-size:1.4em;font-weight:600}
.fs-meta{display:flex;gap:16px;margin-top:6px;font-size:0.85em;color:var(--fs-muted)}
.fs-table{width:100%;border-collapse:collapse;font-size:0.9em}
.fs-table th{text-align:left;padding:8px 12px;font-size:0.75em;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--fs-muted);border-bottom:1px solid var(--fs-border)}
.fs-table td{padding:6px 12px;border-bottom:1px solid var(--fs-border);white-space:nowrap}
.fs-table tr:hover td{background:var(--fs-row-hover)}
.fs-icon{width:28px;text-align:center}
.fs-name{font-weight:500;white-space:normal}
.fs-name a{color:var(--fs-accent);text-decoration:none}
.fs-name a:hover{text-decoration:underline}
.fs-size{text-align:right;color:var(--fs-muted);font-variant-numeric:tabular-nums;width:80px}
.fs-date{color:var(--fs-muted);width:100px}
.fs-path{color:var(--fs-muted);font-family:ui-monospace,monospace;font-size:0.85em;max-width:360px;overflow:hidden;text-overflow:ellipsis}
@media(max-width:640px){.fs-path{display:none}.fs-date{display:none}}
</style>
</head>
<body>
<article class="fs-node" data-path="${escapeHtml(batchName)}" data-scanned="${escapeHtml(scannedIso)}">
    <header class="fs-header">
        <h1 class="fs-title">${escapeHtml(batchName)}</h1>
        <div class="fs-meta"><span class="fs-summary">${entries.length} files</span></div>
    </header>
    <table class="fs-table">
        <thead><tr><th></th><th>Name</th><th>People</th><th>Size</th><th>Modified</th><th>Path</th></tr></thead>
        <tbody>
${entryRows}
        </tbody>
    </table>
</article>
</body>
</html>`;
}

async function uploadBatch(config, localBatchDir) {
  const parentDir = path.dirname(localBatchDir);
  const batchName = path.basename(localBatchDir);
  const remoteRoot = config.SCHWEIZ_TEST_BATCH_DIR;
  await runCommand('ssh', [
    config.SCHWEIZ_HOST,
    `mkdir -p ${shellQuote(remoteRoot)}`,
  ]);
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', '-', '-C', parentDir, batchName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ssh = spawn('ssh', [
      config.SCHWEIZ_HOST,
      `tar -xzf - -C ${shellQuote(remoteRoot)}`,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    tar.stderr.on('data', chunk => {
      stderr += chunk;
    });
    ssh.stderr.on('data', chunk => {
      stderr += chunk;
    });
    tar.on('error', reject);
    ssh.on('error', reject);
    tar.stdout.pipe(ssh.stdin);
    let tarCode = null;
    let sshCode = null;
    const maybeFinish = () => {
      if (tarCode === null || sshCode === null) {
        return;
      }
      if (tarCode === 0 && sshCode === 0) {
        resolve(path.posix.join(remoteRoot, batchName));
        return;
      }
      reject(new Error(`Failed to upload batch to schweiz: ${stderr}`));
    };
    tar.on('close', code => {
      tarCode = code;
      maybeFinish();
    });
    ssh.on('close', code => {
      sshCode = code;
      maybeFinish();
    });
  });
  return path.posix.join(remoteRoot, batchName);
}

async function verifyRemoteBatch(config, remoteBatchDir) {
  await runCommand('ssh', [
    config.SCHWEIZ_HOST,
    `[ -f ${shellQuote(path.posix.join(remoteBatchDir, 'one/index.html'))} ]`,
  ]);
  if (config.SCHWEIZ_HEADLESS_BASE_URL) {
    const response = await fetch(`${config.SCHWEIZ_HEADLESS_BASE_URL.replace(/\/$/, '')}/health`);
    if (!response.ok) {
      throw new Error(`Schweiz headless health check failed with ${response.status}`);
    }
  }
}

async function main() {
  const config = await loadConfig();
  const batchStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const batchName = `${config.TEST_BATCH_NAME}-${batchStamp}`;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fotos-headless-batch-'));
  const extractedDir = path.join(tempRoot, 'extracted');
  const localBatchDir = path.join(tempRoot, batchName);
  const oneDir = path.join(localBatchDir, 'one');
  await fs.mkdir(extractedDir, { recursive: true });
  await fs.mkdir(localBatchDir, { recursive: true });
  await fs.mkdir(oneDir, { recursive: true });

  console.log(`[fotos.headless] listing sample media on ${config.SCHWEIZ_HOST}:${config.SCHWEIZ_SOURCE_DIR}`);
  const remoteFiles = await listRemoteSampleFiles(config);
  console.log(`[fotos.headless] selected ${remoteFiles.length} files`);

  console.log('[fotos.headless] pulling sample media from schweiz');
  await extractRemoteFiles(config, remoteFiles, extractedDir);

  const entries = [];
  for (let index = 0; index < remoteFiles.length; index += 1) {
    const relativePath = remoteFiles[index];
    const sourceFile = path.join(extractedDir, relativePath);
    const targetName = portableFileName(relativePath, index);
    const targetFile = path.join(localBatchDir, targetName);
    const mime = detectMimeType(sourceFile);
    await fs.copyFile(sourceFile, targetFile);
    const stats = await fs.stat(targetFile);
    const contentHash = await sha256File(targetFile);
    console.log(`[fotos.headless] embedding ${index + 1}/${remoteFiles.length}: ${relativePath}`);
    const semantic = await embedImage(config, targetFile, mime);
    entries.push({
      name: targetName,
      sourcePath: relativePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mime,
      contentHash,
      data: {
        'content-hash': contentHash,
        'semantic-model-id': semantic.modelId,
        'semantic-embedding': semantic.embedding,
      },
    });
  }

  const indexHtml = renderIndexHtml(batchName, entries, Date.now());
  await fs.writeFile(path.join(oneDir, 'index.html'), indexHtml, 'utf8');

  const summary = {
    batchName,
    selectedCount: entries.length,
    sparkEmbedBaseUrl: config.SPARK_EMBED_BASE_URL,
    sparkEmbedModel: config.SPARK_EMBED_MODEL,
    schweizSourceDir: config.SCHWEIZ_SOURCE_DIR,
    schweizTestBatchDir: config.SCHWEIZ_TEST_BATCH_DIR,
    selectedFiles: remoteFiles,
    localBatchDir,
  };
  await fs.writeFile(
    path.join(localBatchDir, 'batch-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log('[fotos.headless] uploading semantic smoke batch back to schweiz');
  const remoteBatchDir = await uploadBatch(config, localBatchDir);
  await verifyRemoteBatch(config, remoteBatchDir);

  const result = {
    ...summary,
    remoteBatchDir,
    localTempRoot: tempRoot,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
