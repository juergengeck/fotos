import type { PhotoEntry } from '@/types/fotos';

export interface PhotoAnalyticsSnapshot {
  hash: string;
  name: string;
  managed: PhotoEntry['managed'];
  sourcePath?: string;
  folderPath?: string;
  mimeType?: string;
  sizeBytes: number;
  addedAt: string;
  capturedAt?: string;
  updatedAt?: string;
  tags: string[];
  analysisCoverage: {
    hasExif: boolean;
    hasFaces: boolean;
    hasSemanticEmbedding: boolean;
    labeledFaces: number;
  };
  exif?: {
    date?: string;
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    shutter?: string;
    iso?: number;
    width?: number;
    height?: number;
    gps?: {
      lat: number;
      lon: number;
    };
  };
  faces?: {
    count: number;
    cropCount: number;
    scores: number[];
    bboxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    clusterIds: string[];
    names: string[];
    personIds: string[];
  };
  semantic?: {
    modelId: string;
    embeddingDimensions: number;
  };
}

function roundNumber(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function uniqueStrings(values: Array<string | undefined> | undefined): string[] {
  if (!values) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function buildPhotoAnalyticsSnapshot(photo: PhotoEntry): PhotoAnalyticsSnapshot {
  const faces = photo.faces;
  const exif = photo.exif;
  const labeledFaces = uniqueStrings(faces?.names).length;

  return {
    hash: photo.hash,
    name: photo.name,
    managed: photo.managed,
    sourcePath: photo.sourcePath,
    folderPath: photo.folderPath,
    mimeType: photo.mimeType,
    sizeBytes: photo.size,
    addedAt: photo.addedAt,
    capturedAt: photo.capturedAt,
    updatedAt: photo.updatedAt,
    tags: [...photo.tags],
    analysisCoverage: {
      hasExif: Boolean(exif),
      hasFaces: Boolean(faces && faces.count > 0),
      hasSemanticEmbedding: Boolean(photo.semantic?.embedding),
      labeledFaces,
    },
    exif: exif ? {
      date: exif.date,
      camera: exif.camera,
      lens: exif.lens,
      focalLength: exif.focalLength,
      aperture: exif.aperture,
      shutter: exif.shutter,
      iso: exif.iso,
      width: exif.width,
      height: exif.height,
      gps: exif.gps ? {
        lat: roundNumber(exif.gps.lat, 6),
        lon: roundNumber(exif.gps.lon, 6),
      } : undefined,
    } : undefined,
    faces: faces ? {
      count: faces.count,
      cropCount: faces.crops.filter(Boolean).length,
      scores: faces.scores.slice(0, 12).map(score => roundNumber(score)),
      bboxes: faces.bboxes.slice(0, 12).map(([x, y, width, height]) => ({
        x: roundNumber(x),
        y: roundNumber(y),
        width: roundNumber(width),
        height: roundNumber(height),
      })),
      clusterIds: uniqueStrings(faces.clusterIds),
      names: uniqueStrings(faces.names),
      personIds: uniqueStrings(faces.personIds),
    } : undefined,
    semantic: photo.semantic ? {
      modelId: photo.semantic.modelId,
      embeddingDimensions: photo.semantic.embedding.length,
    } : undefined,
  };
}

export function buildPhotoAnalyticsComparisonPrompt(
  snapshot: PhotoAnalyticsSnapshot,
  options?: {
    customPrompt?: string;
    visionCapable?: boolean;
  },
): string {
  const opening = options?.customPrompt?.trim()
    || 'Review this photo ingestion snapshot and compare what the pipeline extracted against what a strong multimodal model should scrutinize.';
  const imageModeLine = options?.visionCapable
    ? 'The selected model is vision-capable, but this invocation currently includes the structured ingestion snapshot only. Call out anything that still needs pixel-level confirmation.'
    : 'This invocation only includes the structured ingestion snapshot. Do not pretend to see the image; point out where visual confirmation would still be required.';

  return [
    opening,
    imageModeLine,
    'Focus on practical auditing value for the fotos pipeline.',
    'Return four short sections titled exactly:',
    'Observed Signal',
    'Likely Gaps',
    'Better Tags Or Caption',
    'Pipeline Recommendations',
    'Be concrete, skeptical where needed, and keep it concise.',
    'Structured photo analytics snapshot:',
    JSON.stringify(snapshot, null, 2),
  ].join('\n\n');
}
