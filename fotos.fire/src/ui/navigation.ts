import type {FirePhoto} from './types';

/** A thumbnail alone is not the full-resolution image offered by the viewer. */
export function canShowPhoto(photo: FirePhoto): boolean {
  return Boolean(photo.mediaUri) && (!photo.mimeType || photo.mimeType.startsWith('image/'));
}

export function adjacentPhotoId(
  photos: readonly FirePhoto[],
  currentId: string,
  direction: -1 | 1,
  imagesOnly = false,
): string | null {
  if (photos.length === 0) return null;
  const index = photos.findIndex(photo => photo.id === currentId);
  // A removed selection should restart from the first remaining image.
  const start = index === -1 ? (direction === 1 ? -1 : 0) : index;
  for (let offset = 1; offset <= photos.length; offset += 1) {
    const candidate = photos[(start + direction * offset + photos.length) % photos.length];
    if (!imagesOnly || canShowPhoto(candidate)) return candidate.id;
  }
  return null;
}
