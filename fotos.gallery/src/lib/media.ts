export function isVideoMimeType(mimeType: string | undefined): boolean {
  return mimeType?.trim().toLowerCase().startsWith('video/') ?? false
}
