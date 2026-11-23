# Shared media identity fixtures

TypeScript and Swift both read `hashes.json`. The HEIC and AVIF fixtures
encode synthetic color swatches with macOS ImageIO. The grid fixtures assemble
four encoded HEVC tiles and an `idat` grid descriptor.

The repacked grid keeps the encoded image and tile order while changing item
IDs, extent boundaries, property order, and box placement. It adds EXIF, XMP,
padding, and an embedded thumbnail. A second repack adds crop, rotation, and
mirroring properties while retaining the same encoded image. The changed-tile
fixture replaces only the last tile. The missing-tile and truncated files
exercise exact-byte hashing when the primary image cannot be resolved.
