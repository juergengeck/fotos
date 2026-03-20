// index-html.ts — Shared index.html renderer and parser for fotos.one ingest
import type { FsEntry, FolderMetadata } from './types.js';

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatDate(mtime: number): string {
    return new Date(mtime).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

function renderFacesCell(data: Record<string, string> | undefined): string {
    if (!data) return '';
    const count = parseInt(data['face-count'] ?? '0', 10);
    if (count === 0) return '';

    const crops = data['face-crops']?.split(';') ?? [];
    const names = data['face-names']?.split(';') ?? [];
    const clusterIds = data['face-cluster-hashes']?.split(';') ?? [];

    const faces: string[] = [];
    for (let i = 0; i < count; i++) {
        const name = names[i] && names[i] !== 'Unknown' ? escapeHtml(names[i]) : '';
        const cropSrc = crops[i] ? `<img class="fs-face-crop" src="${escapeHtml(crops[i])}" loading="lazy" alt="${name}">` : '';
        const nameLabel = name ? `<span class="fs-face-name">${name}</span>` : '';
        const clusterId = clusterIds[i];
        if (clusterId && name) {
            faces.push(`<a class="fs-face" data-cluster="${escapeHtml(clusterId)}">${cropSrc}${nameLabel}</a>`);
        } else {
            faces.push(`<span class="fs-face">${cropSrc}${nameLabel}</span>`);
        }
    }
    return faces.join('');
}

function computeArticleMeta(entries: FsEntry[], children: FolderMetadata[]): Omit<FolderMetadata, 'path' | 'name'> {
    const localCount = entries.length;
    const childPhotoSum = children.reduce((s, c) => s + c.photoCount, 0);
    const photoCount = localCount + childPhotoSum;
    const childCount = children.length;

    // Collect all date strings: entry exif dates + child date ranges
    const dates: string[] = [];
    for (const e of entries) {
        const d = e.data?.['exif-date'];
        if (d) dates.push(d);
    }
    for (const c of children) {
        if (c.dateRangeStart) dates.push(c.dateRangeStart);
        if (c.dateRangeEnd) dates.push(c.dateRangeEnd);
    }
    dates.sort();

    return {
        photoCount,
        localCount,
        dateRangeStart: dates.length > 0 ? dates[0] : undefined,
        dateRangeEnd: dates.length > 0 ? dates[dates.length - 1] : undefined,
        childCount,
    };
}

export function renderIndexHtml(
    dirPath: string,
    entries: FsEntry[],
    children: FolderMetadata[],
    scannedAt: number
): string {
    const title = dirPath || 'root';
    const scanned = new Date(scannedAt).toISOString();
    const meta = computeArticleMeta(entries, children);

    const childRows = children.map(c => {
        const dateRange = c.dateRangeStart && c.dateRangeEnd
            ? `<span itemprop="dateRangeStart">${escapeHtml(c.dateRangeStart)}</span> &ndash; <span itemprop="dateRangeEnd">${escapeHtml(c.dateRangeEnd)}</span>`
            : c.dateRangeStart
                ? `<span itemprop="dateRangeStart">${escapeHtml(c.dateRangeStart)}</span>`
                : '';
        return `        <tr class="fs-child" itemscope itemtype="//fotos.one/FolderMetadata">
            <td class="fs-icon">\u{1F4C1}</td>
            <td class="fs-name"><a href="${escapeHtml(c.path)}/one/index.html" itemprop="path">${escapeHtml(c.name)}</a></td>
            <td class="fs-faces"></td>
            <td class="fs-size" itemprop="photoCount">${c.photoCount}</td>
            <td class="fs-date">${dateRange}</td>
            <td class="fs-path"></td>
        </tr>`;
    }).join('\n');

    const entryRows = entries.map(e => {
        let attrs = ` data-mime="${escapeHtml(e.mime)}"`;
        if (e.contentHash) attrs += ` data-hash="${escapeHtml(e.contentHash)}"`;
        if (e.data) {
            for (const [key, value] of Object.entries(e.data)) {
                attrs += ` data-${escapeHtml(key)}="${escapeHtml(value)}"`;
            }
        }
        const thumbSrc = e.data?.thumb;
        const imgLink = `<a href="../${escapeHtml(e.name)}" target="_blank">`;
        const nameContent = thumbSrc
            ? `${imgLink}<img class="fs-thumb" src="${escapeHtml(thumbSrc)}" loading="lazy" alt=""></a>${imgLink}${escapeHtml(e.name)}</a>`
            : `${imgLink}${escapeHtml(e.name)}</a>`;

        const facesHtml = renderFacesCell(e.data);

        return `        <tr class="fs-entry"${attrs}>
            <td class="fs-icon">\u{1F5BC}</td>
            <td class="fs-name">${nameContent}</td>
            <td class="fs-faces">${facesHtml}</td>
            <td class="fs-size">${formatSize(e.size)}</td>
            <td class="fs-date">${formatDate(e.mtime)}</td>
            <td class="fs-path">${escapeHtml(e.path)}</td>
        </tr>`;
    }).join('\n');

    const summary = `${entries.length} files, ${children.length} folders`;

    // Article-level meta tags
    const metaTags: string[] = [];
    metaTags.push(`    <meta itemprop="photoCount" content="${meta.photoCount}">`);
    metaTags.push(`    <meta itemprop="localCount" content="${meta.localCount}">`);
    if (meta.dateRangeStart) metaTags.push(`    <meta itemprop="dateRangeStart" content="${escapeHtml(meta.dateRangeStart)}">`);
    if (meta.dateRangeEnd) metaTags.push(`    <meta itemprop="dateRangeEnd" content="${escapeHtml(meta.dateRangeEnd)}">`);
    metaTags.push(`    <meta itemprop="childCount" content="${meta.childCount}">`);
    const metaBlock = metaTags.join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="fotos.one browser-ingest">
<title>${escapeHtml(title)}</title>
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
.fs-icon{width:28px;text-align:center}.fs-name{font-weight:500;white-space:normal}
.fs-thumb{width:40px;height:40px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:8px}
.fs-name a{color:var(--fs-accent);text-decoration:none}.fs-name a:hover{text-decoration:underline}.fs-thumb:hover{opacity:0.8}
.fs-size{text-align:right;color:var(--fs-muted);font-variant-numeric:tabular-nums;width:80px}
.fs-date{color:var(--fs-muted);width:100px}
.fs-path{color:var(--fs-muted);font-family:ui-monospace,monospace;font-size:0.85em;max-width:300px;overflow:hidden;text-overflow:ellipsis}
.fs-footer{max-width:960px;margin:24px auto 0;padding:16px 20px;border-top:1px solid var(--fs-border);text-align:right}
.fs-footer a{color:var(--fs-muted);text-decoration:none;font-size:0.75em;display:inline-flex;align-items:center;gap:4px}
.fs-footer a:hover{color:var(--fs-fg)}
.fs-faces{white-space:normal;min-width:60px}
.fs-face{display:inline-flex;flex-direction:column;align-items:center;margin:2px 4px;vertical-align:top;text-decoration:none;color:var(--fs-fg)}
.fs-face-crop{width:32px;height:32px;object-fit:cover;border-radius:50%;border:1px solid var(--fs-border)}
.fs-face-name{font-size:0.7em;color:var(--fs-muted);max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
a.fs-face:hover .fs-face-name{color:var(--fs-accent)}
@media(max-width:640px){.fs-path{display:none}.fs-date{display:none}}
</style>
</head>
<body>
<article class="fs-node" itemscope itemtype="//fotos.one/FolderIndex" data-path="${escapeHtml(dirPath)}" data-scanned="${scanned}">
${metaBlock}
    <header class="fs-header">
        <h1 class="fs-title">${escapeHtml(title)}</h1>
        <div class="fs-meta"><span class="fs-summary">${summary}</span></div>
    </header>
    <table class="fs-table">
        <thead><tr><th></th><th>Name</th><th>People</th><th>Size</th><th>Modified</th><th>Path</th></tr></thead>
        <tbody>
${childRows}${entryRows}
        </tbody>
    </table>
</article>
<footer class="fs-footer">
    <a href="https://fotos.one" target="_blank" rel="noopener">fotos.one</a>
</footer>
</body>
</html>`;
}

// -- Parser (server-side, regex-based -- no DOMParser) ---------------------

function getAttr(attrs: string, name: string): string | undefined {
    const regex = new RegExp(`${name}="([^"]*)"`, 'i');
    const match = attrs.match(regex);
    return match?.[1];
}

function extractTextContent(html: string, className: string): string {
    // Find the td with the given class and extract all content until </td>
    const tdRegex = new RegExp(`class="${className}"[^>]*>(.*?)</td>`, 'is');
    const tdMatch = html.match(tdRegex);
    if (!tdMatch) return '';
    // Strip all HTML tags and return trimmed text
    const stripped = tdMatch[1].replace(/<[^>]*>/g, '').trim();
    // For fs-name, the filename appears as the last text node (after thumbnail img)
    // Return the last non-empty segment
    const parts = stripped.split(/\s{2,}/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : stripped;
}

function parseSize(text: string): number {
    const match = text.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const mult: Record<string, number> = {B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776};
    return Math.round(val * (mult[unit] ?? 1));
}

export interface ParsedPhotoEntry {
    name: string;
    hash: string;
    contentHash: string;
    streamId: string;
    sourcePath: string;
    thumb?: string;
    mime: string;
    size: number;
    tags: string[];
    addedAt: string;
    exif?: {
        date?: string; camera?: string; lens?: string; focalLength?: string;
        aperture?: string; shutter?: string; iso?: number;
        gps?: { lat: number; lon: number }; width?: number; height?: number;
    };
    faceData?: Record<string, string>;
}

export interface ParsedFolderIndex {
    meta: FolderMetadata;
    children: FolderMetadata[];
    entries: ParsedPhotoEntry[];
}

/**
 * Parse ONLY the article-level meta tags from an index.html file.
 * Fast — does not parse any entry rows or child rows.
 */
export function parseFolderMeta(html: string): FolderMetadata {
    const articleRegex = /<article[^>]*class="fs-node"[^>]*>/i;
    const articleMatch = html.match(articleRegex);
    const articleAttrs = articleMatch?.[0] ?? '';

    const path = getAttr(articleAttrs, 'data-path') ?? '';
    const segments = path.split('/').filter(Boolean);
    const name = segments.length > 0 ? segments[segments.length - 1] : path || 'root';

    // Detect legacy format: no itemprop="photoCount" meta tag
    const hasNewFormat = /itemprop="photoCount"/.test(html);

    if (hasNewFormat) {
        // New format: extract meta itemprop tags within the article (before the table)
        const articleStart = articleMatch?.index ?? 0;
        const tableStart = html.indexOf('<table', articleStart);
        const metaSection = html.slice(articleStart, tableStart > 0 ? tableStart : undefined);

        function getMetaProp(prop: string): string | undefined {
            const re = new RegExp(`<meta\\s+itemprop="${prop}"\\s+content="([^"]*)"`, 'i');
            const m = metaSection.match(re);
            return m?.[1];
        }

        return {
            path,
            name,
            photoCount: parseInt(getMetaProp('photoCount') ?? '0', 10),
            localCount: parseInt(getMetaProp('localCount') ?? '0', 10),
            dateRangeStart: getMetaProp('dateRangeStart'),
            dateRangeEnd: getMetaProp('dateRangeEnd'),
            childCount: parseInt(getMetaProp('childCount') ?? '0', 10),
        };
    }

    // Legacy format: synthesize metadata from entry and child rows
    const entryMatches = html.match(/<tr\s+class="fs-entry"/g);
    const localCount = entryMatches?.length ?? 0;

    const childMatches = html.match(/<tr\s+class="fs-child"/g);
    const childCount = childMatches?.length ?? 0;

    // Extract min/max data-exif-date from entry rows
    const dates: string[] = [];
    const dateRegex = /data-exif-date="([^"]*)"/g;
    let dateMatch;
    while ((dateMatch = dateRegex.exec(html)) !== null) {
        if (dateMatch[1]) dates.push(dateMatch[1]);
    }
    dates.sort();

    return {
        path,
        name,
        photoCount: localCount, // legacy has no nested info, so photoCount = localCount
        localCount,
        dateRangeStart: dates.length > 0 ? dates[0] : undefined,
        dateRangeEnd: dates.length > 0 ? dates[dates.length - 1] : undefined,
        childCount,
    };
}

/**
 * Full parse: returns folder meta, child folder metadata, and photo entries.
 */
export function parseFolderIndex(html: string, relPath: string): ParsedFolderIndex {
    const meta = parseFolderMeta(html);
    const children = parseChildFolders(html);
    const entries = parseIndexHtml(html, relPath);
    return { meta, children, entries };
}

function parseChildFolders(html: string): FolderMetadata[] {
    // Detect format: new format has itemtype="//fotos.one/FolderMetadata" on child rows
    const hasNewFormat = /itemtype="\/\/fotos\.one\/FolderMetadata"/.test(html);

    if (hasNewFormat) {
        return parseChildFoldersNew(html);
    }
    return parseChildFoldersLegacy(html);
}

function parseChildFoldersNew(html: string): FolderMetadata[] {
    const children: FolderMetadata[] = [];
    const rowRegex = /<tr\s+class="fs-child"[^>]*itemtype="\/\/fotos\.one\/FolderMetadata"[^>]*>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const rowStart = match.index;
        const rowEnd = html.indexOf('</tr>', rowStart);
        if (rowEnd < 0) continue;
        const rowHtml = html.slice(rowStart, rowEnd + 5);

        // Extract path from <a itemprop="path" href="...">name</a>
        const pathMatch = rowHtml.match(/<a\s+href="([^"]*)"[^>]*itemprop="path"[^>]*>([^<]*)<\/a>/i)
            ?? rowHtml.match(/<a\s+[^>]*itemprop="path"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i);
        // href is "childPath/one/index.html", extract childPath
        const href = pathMatch?.[1] ?? '';
        const childPath = href.replace(/\/one\/index\.html$/, '');
        const childName = pathMatch?.[2] ?? childPath;

        // Extract photoCount from <td ... itemprop="photoCount">N</td>
        const photoCountMatch = rowHtml.match(/itemprop="photoCount"[^>]*>(\d+)/i);
        const photoCount = photoCountMatch ? parseInt(photoCountMatch[1], 10) : 0;

        // Extract dateRangeStart and dateRangeEnd from <span itemprop="...">value</span>
        const startMatch = rowHtml.match(/itemprop="dateRangeStart"[^>]*>([^<]*)</i);
        const endMatch = rowHtml.match(/itemprop="dateRangeEnd"[^>]*>([^<]*)</i);

        children.push({
            path: childPath,
            name: childName,
            photoCount,
            localCount: 0,  // not stored in child rows, only in child's own article meta
            dateRangeStart: startMatch?.[1] || undefined,
            dateRangeEnd: endMatch?.[1] || undefined,
            childCount: 0,  // not stored in child rows, only in child's own article meta
        });
    }

    return children;
}

function parseChildFoldersLegacy(html: string): FolderMetadata[] {
    const children: FolderMetadata[] = [];
    const rowRegex = /<tr\s+class="fs-child"[^>]*>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const rowStart = match.index;
        const rowEnd = html.indexOf('</tr>', rowStart);
        if (rowEnd < 0) continue;
        const rowHtml = html.slice(rowStart, rowEnd + 5);

        // Extract child name from <a href="childPath/one/index.html">name/</a>
        const linkMatch = rowHtml.match(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/i);
        if (!linkMatch) continue;
        const href = linkMatch[1];
        const childPath = href.replace(/\/one\/index\.html$/, '');
        // Name text may have trailing slash (e.g. "vacation/"), strip it
        const childName = linkMatch[2].replace(/\/$/, '') || childPath;

        children.push({
            path: childPath,
            name: childName,
            photoCount: 0,  // legacy format has no count info in child rows
            localCount: 0,
            childCount: 0,
        });
    }

    return children;
}

/**
 * Parse a .one/index.html file (the source of truth on disk) back into photo entries.
 */
export function parseIndexHtml(html: string, relPath: string): ParsedPhotoEntry[] {
    const entries: ParsedPhotoEntry[] = [];
    const rowRegex = /<tr\s+class="fs-entry"([^>]*)>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const attrs = match[1];
        const mime = getAttr(attrs, 'data-mime');
        if (!mime || (!mime.startsWith('image/') && !mime.startsWith('video/'))) continue;

        const rowStart = match.index;
        const rowEnd = html.indexOf('</tr>', rowStart);
        const rowHtml = html.slice(rowStart, rowEnd);

        const name = extractTextContent(rowHtml, 'fs-name');
        const streamId = getAttr(attrs, 'data-stream-id') ?? '';
        const contentHash = getAttr(attrs, 'data-content-hash') ?? getAttr(attrs, 'data-hash') ?? '';
        const thumb = getAttr(attrs, 'data-thumb');
        const sizeText = extractTextContent(rowHtml, 'fs-size');

        const entry: ParsedPhotoEntry = {
            hash: streamId || contentHash,
            name,
            contentHash,
            streamId,
            sourcePath: relPath ? `${relPath}/${name}` : name,
            thumb: thumb ? (relPath ? `${relPath}/.one/${thumb}` : `.one/${thumb}`) : undefined,
            mime,
            size: parseSize(sizeText),
            tags: relPath ? [relPath.split('/')[0]] : [],
            addedAt: getAttr(attrs, 'data-exif-date') ?? new Date().toISOString(),
        };

        // EXIF
        const exif: NonNullable<ParsedPhotoEntry['exif']> = {};
        const exifDate = getAttr(attrs, 'data-exif-date');
        if (exifDate) { exif.date = exifDate; entry.addedAt = exifDate; }
        if (getAttr(attrs, 'data-exif-camera')) exif.camera = getAttr(attrs, 'data-exif-camera');
        if (getAttr(attrs, 'data-exif-lens')) exif.lens = getAttr(attrs, 'data-exif-lens');
        if (getAttr(attrs, 'data-exif-focal')) exif.focalLength = getAttr(attrs, 'data-exif-focal');
        if (getAttr(attrs, 'data-exif-aperture')) exif.aperture = getAttr(attrs, 'data-exif-aperture');
        if (getAttr(attrs, 'data-exif-shutter')) exif.shutter = getAttr(attrs, 'data-exif-shutter');
        const iso = getAttr(attrs, 'data-exif-iso');
        if (iso) exif.iso = Number(iso);
        const gps = getAttr(attrs, 'data-exif-gps');
        if (gps) {
            const [lat, lon] = gps.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lon)) exif.gps = { lat, lon };
        }
        const w = getAttr(attrs, 'data-exif-width');
        const h = getAttr(attrs, 'data-exif-height');
        if (w) exif.width = Number(w);
        if (h) exif.height = Number(h);
        if (Object.keys(exif).length > 0) entry.exif = exif;

        // Face data
        const faceCount = getAttr(attrs, 'data-face-count');
        if (faceCount && parseInt(faceCount, 10) > 0) {
            entry.faceData = {
                'face-count': faceCount,
                'face-bboxes': getAttr(attrs, 'data-face-bboxes') ?? '',
                'face-scores': getAttr(attrs, 'data-face-scores') ?? '',
                'face-embeddings': getAttr(attrs, 'data-face-embeddings') ?? '',
                'face-crops': getAttr(attrs, 'data-face-crops') ?? '',
            };
        }

        entries.push(entry);
    }

    return entries;
}
