// Canonical HEIF image bytes shared with HEIFCanonical.swift.

const IMAGE_BRANDS = new Set(['mif1', 'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'avif']);
const BOX_HEADERS = new Set(['ftyp', 'free', 'skip', 'wide', 'mdat', 'meta', 'uuid']);
const METADATA_PROPERTIES = new Set([
    'colr', 'pixi', 'pasp', 'auxC', 'rloc', 'lsel', 'mdcv', 'clli', 'amve', 'udes', 'clap', 'imir', 'irot',
]);
const PREFIX = new Uint8Array([70, 79, 84, 79, 83, 45, 72, 69, 73, 70, 45, 49, 0]); // FOTOS-HEIF-1\0

interface Box {
    type: string;
    start: number;
    end: number;
}

class InvalidHeif extends Error {}

function requireHeif(valid: unknown): asserts valid {
    if (!valid) throw new InvalidHeif();
}

class Reader {
    constructor(
        readonly bytes: Uint8Array,
        private offset = 0,
        private readonly end = bytes.length,
    ) {}

    get remaining(): number { return this.end - this.offset; }

    uint(width: number): number {
        requireHeif(width <= 8 && width <= this.remaining);
        let value = 0;
        for (let index = 0; index < width; index++) {
            value = value * 256 + this.bytes[this.offset++];
        }
        requireHeif(Number.isSafeInteger(value));
        return value;
    }

    fourcc(): string {
        requireHeif(this.remaining >= 4);
        const offset = this.offset;
        this.offset += 4;
        return String.fromCharCode(
            this.bytes[offset], this.bytes[offset + 1], this.bytes[offset + 2], this.bytes[offset + 3],
        );
    }

    fullBox(): {version: number; flags: number} {
        return {version: this.uint(1), flags: this.uint(3)};
    }

    boxes(): Box[] {
        const boxes: Box[] = [];
        while (this.remaining) {
            const start = this.offset;
            let size = this.uint(4);
            const type = this.fourcc();
            const toEnd = size === 0;
            if (size === 1) size = this.uint(8);
            const end = toEnd ? this.end : start + size;
            requireHeif(end >= this.offset && end <= this.end);
            boxes.push({type, start: this.offset, end});
            this.offset = end;
        }
        return boxes;
    }
}

function singleBox(boxes: readonly Box[], type: string): Box | undefined {
    let found: Box | undefined;
    for (const box of boxes) {
        if (box.type !== type) continue;
        requireHeif(!found);
        found = box;
    }
    return found;
}

function requiredBox(boxes: readonly Box[], type: string): Box {
    const box = singleBox(boxes, type);
    requireHeif(box);
    return box;
}

function boxReader(bytes: Uint8Array, box: Box): Reader {
    return new Reader(bytes, box.start, box.end);
}

function hasHeifBrand(reader: Reader): boolean {
    const major = reader.fourcc();
    reader.uint(4); // minor version
    let hasBrand = IMAGE_BRANDS.has(major);
    while (reader.remaining) {
        if (IMAGE_BRANDS.has(reader.fourcc())) hasBrand = true;
    }
    return hasBrand;
}

function readPrimaryId(reader: Reader): number {
    const {version, flags} = reader.fullBox();
    requireHeif(version <= 1 && flags === 0);
    const id = reader.uint(version === 0 ? 2 : 4);
    requireHeif(reader.remaining === 0);
    return id;
}

interface ItemInfo {
    type: string;
    protection: number;
}

function readItemInfo(reader: Reader): Map<number, ItemInfo> {
    const {version, flags} = reader.fullBox();
    requireHeif(version <= 1 && flags === 0);
    const count = reader.uint(version === 0 ? 2 : 4);
    const boxes = reader.boxes();
    requireHeif(boxes.length === count);
    const items = new Map<number, ItemInfo>();
    for (const box of boxes) {
        requireHeif(box.type === 'infe');
        const entry = boxReader(reader.bytes, box);
        const {version} = entry.fullBox();
        if (version !== 2 && version !== 3) continue;
        const id = entry.uint(version === 2 ? 2 : 4);
        const protection = entry.uint(2);
        const type = entry.fourcc();
        requireHeif(!items.has(id));
        items.set(id, {type, protection});
    }
    return items;
}

interface Extent { offset: number; length: number }
interface Location {
    method: number;
    dataReference: number;
    baseOffset: number;
    extents: Extent[];
}

function readLocations(reader: Reader): Map<number, Location> {
    const {version, flags} = reader.fullBox();
    requireHeif(version <= 2 && flags === 0);
    const offsetAndLength = reader.uint(1);
    const baseAndIndex = reader.uint(1);
    const offsetWidth = offsetAndLength >> 4;
    const lengthWidth = offsetAndLength & 15;
    const baseWidth = baseAndIndex >> 4;
    const indexWidth = version === 0 ? 0 : baseAndIndex & 15;
    requireHeif([offsetWidth, lengthWidth, baseWidth, indexWidth].every(width => width <= 8));
    const idWidth = version === 2 ? 4 : 2;
    const count = reader.uint(idWidth);
    const locations = new Map<number, Location>();
    for (let item = 0; item < count; item++) {
        const id = reader.uint(idWidth);
        const method = version === 0 ? 0 : reader.uint(2);
        const dataReference = reader.uint(2);
        const baseOffset = reader.uint(baseWidth);
        const extentCount = reader.uint(2);
        const extentWidth = indexWidth + offsetWidth + lengthWidth;
        requireHeif(extentCount === 0 || (extentWidth > 0 && extentCount * extentWidth <= reader.remaining));
        const extents: Extent[] = [];
        for (let extent = 0; extent < extentCount; extent++) {
            reader.uint(indexWidth);
            extents.push({offset: reader.uint(offsetWidth), length: reader.uint(lengthWidth)});
        }
        requireHeif(!locations.has(id));
        locations.set(id, {method, dataReference, baseOffset, extents});
    }
    requireHeif(reader.remaining === 0);
    return locations;
}

function readGridReferences(reader: Reader): Map<number, number[]> {
    const {version, flags} = reader.fullBox();
    requireHeif(version <= 1 && flags === 0);
    const idWidth = version === 0 ? 2 : 4;
    const references = new Map<number, number[]>();
    for (const box of reader.boxes()) {
        if (box.type !== 'dimg') continue;
        const entry = boxReader(reader.bytes, box);
        const source = entry.uint(idWidth);
        const count = entry.uint(2);
        requireHeif(!references.has(source) && entry.remaining === count * idWidth);
        references.set(source, Array.from({length: count}, () => entry.uint(idWidth)));
    }
    return references;
}

interface Association { box: Box; essential: boolean }

function readAssociations(reader: Reader): Map<number, Association[]> {
    const boxes = reader.boxes();
    const properties = boxReader(reader.bytes, requiredBox(boxes, 'ipco')).boxes();
    const associations = new Map<number, Association[]>();
    const formats = new Set<number>();
    for (const box of boxes) {
        if (box.type !== 'ipma') continue;
        const entry = boxReader(reader.bytes, box);
        const {version, flags} = entry.fullBox();
        const format = version * 2 + flags;
        requireHeif(version <= 1 && flags <= 1 && !formats.has(format));
        formats.add(format);
        const essentialBit = flags ? 0x8000 : 0x80;
        const count = entry.uint(4);
        for (let item = 0; item < count; item++) {
            const id = entry.uint(version ? 4 : 2);
            const associationCount = entry.uint(1);
            const values: Association[] = [];
            for (let property = 0; property < associationCount; property++) {
                const association = entry.uint(flags ? 2 : 1);
                const index = association & (essentialBit - 1);
                if (index === 0) continue;
                const propertyBox = properties[index - 1];
                requireHeif(propertyBox);
                values.push({box: propertyBox, essential: (association & essentialBit) !== 0});
            }
            requireHeif(!associations.has(id));
            associations.set(id, values);
        }
        requireHeif(entry.remaining === 0);
    }
    return associations;
}

function codecProperty(type: string): 'hvcC' | 'av1C' | undefined {
    if (type === 'hvc1') return 'hvcC';
    if (type === 'av01') return 'av1C';
    return undefined;
}

function selectedProperties(bytes: Uint8Array, type: string, associations: Association[]): Box[] {
    const selection = new Map<string, Box>();
    const codec = codecProperty(type);
    for (const {box, essential} of associations) {
        const length = box.end - box.start;
        switch (box.type) {
            case 'ispe': {
                const reader = boxReader(bytes, box);
                requireHeif(length === 12 && reader.uint(4) === 0 && reader.uint(4) > 0 && reader.uint(4) > 0);
                break;
            }
            default:
                if (box.type !== codec) {
                    requireHeif(!essential || METADATA_PROPERTIES.has(box.type));
                    continue;
                }
                if (codec === 'hvcC') requireHeif(length >= 23 && bytes[box.start] === 1);
                if (codec === 'av1C') requireHeif(length >= 4 && bytes[box.start] === 0x81);
        }
        requireHeif(!selection.has(box.type));
        selection.set(box.type, box);
    }
    requireHeif(selection.has('ispe') && (!codec || selection.has(codec)));
    return [...selection.keys()].sort().map(key => selection.get(key)!);
}

class CanonicalBytes {
    private readonly chunks: Uint8Array[] = [];
    private size = 0;

    constructor(private readonly limit: number) {}

    append(bytes: Uint8Array): void {
        this.size += bytes.length;
        requireHeif(this.size <= this.limit);
        this.chunks.push(bytes);
    }

    fourcc(type: string): void {
        this.append(Uint8Array.from(type, character => character.charCodeAt(0)));
    }

    uint32(value: number): void {
        requireHeif(value <= 0xffffffff);
        this.append(Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value));
    }

    assemble(): Uint8Array {
        const bytes = new Uint8Array(this.size);
        let offset = 0;
        for (const chunk of this.chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        return bytes;
    }
}

function readGridTileCount(payload: Uint8Array): number {
    const reader = new Reader(payload);
    requireHeif(reader.uint(1) === 0);
    const flags = reader.uint(1);
    requireHeif(flags <= 1);
    const rows = reader.uint(1) + 1;
    const columns = reader.uint(1) + 1;
    const width = flags ? 4 : 2;
    requireHeif(reader.uint(width) > 0 && reader.uint(width) > 0 && reader.remaining === 0);
    return rows * columns;
}

interface HeifImage {
    bytes: Uint8Array;
    items: Map<number, ItemInfo>;
    locations: Map<number, Location>;
    references: Map<number, number[]>;
    associations: Map<number, Association[]>;
    idat?: Box;
    mediaData: Box[];
}

function containsMediaExtent(boxes: Box[], start: number, end: number): boolean {
    let low = 0;
    let high = boxes.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const box = boxes[middle];
        if (start < box.start) high = middle;
        else if (start >= box.end) low = middle + 1;
        else return end <= box.end;
    }
    return false;
}

function imageExtents(image: HeifImage, location: Location): Uint8Array[] {
    requireHeif(location.dataReference === 0 && location.extents.length > 0 && location.method <= 1);
    const idat = image.idat;
    return location.extents.map(({offset, length}) => {
        const relativeStart = location.baseOffset + offset;
        const start = relativeStart + (location.method === 1 ? idat?.start ?? -1 : 0);
        const end = start + length;
        requireHeif(length > 0 && Number.isSafeInteger(start) && Number.isSafeInteger(end) && end <= image.bytes.length);
        const containingBox = location.method === 1
            ? idat && start >= idat.start && end <= idat.end
            : containsMediaExtent(image.mediaData, start, end);
        requireHeif(containingBox);
        return image.bytes.subarray(start, end);
    });
}

function appendItem(out: CanonicalBytes, image: HeifImage, id: number): void {
    const item = image.items.get(id);
    const location = image.locations.get(id);
    const associations = image.associations.get(id);
    requireHeif(item && item.protection === 0 && location && associations);
    requireHeif(item.type === 'grid' || codecProperty(item.type));
    const properties = selectedProperties(image.bytes, item.type, associations);

    out.fourcc(item.type);
    out.uint32(properties.length);
    for (const property of properties) {
        out.fourcc(property.type);
        out.uint32(property.end - property.start);
        out.append(image.bytes.subarray(property.start, property.end));
    }

    const extents = imageExtents(image, location);
    const length = extents.reduce((sum, extent) => sum + extent.length, 0);
    out.uint32(length);
    for (const extent of extents) out.append(extent);

    const tiles = image.references.get(id);
    if (item.type !== 'grid') {
        requireHeif(!tiles);
        out.uint32(0);
        return;
    }
    requireHeif(tiles && (length === 8 || length === 12));
    const descriptor = new Uint8Array(length);
    let offset = 0;
    for (const extent of extents) {
        descriptor.set(extent, offset);
        offset += extent.length;
    }
    requireHeif(tiles.length === readGridTileCount(descriptor));
    const tileType = image.items.get(tiles[0])?.type;
    requireHeif(tileType && codecProperty(tileType));
    out.uint32(tiles.length);
    for (const tile of tiles) {
        requireHeif(image.items.get(tile)?.type === tileType);
        appendItem(out, image, tile);
    }
}

/** Resolve encoded primary items and ordered grid tiles, leaving container metadata out of the digest. */
export function canonicalHeifBytes(bytes: Uint8Array): Uint8Array | undefined {
    if (bytes.length < 16 || !BOX_HEADERS.has(new Reader(bytes, 4).fourcc())) return undefined;
    try {
        const top = new Reader(bytes).boxes();
        const fileType = singleBox(top, 'ftyp');
        if (!fileType || !hasHeifBrand(boxReader(bytes, fileType))) return undefined;
        const meta = boxReader(bytes, requiredBox(top, 'meta'));
        requireHeif(meta.uint(4) === 0);
        const boxes = meta.boxes();
        const primary = readPrimaryId(boxReader(bytes, requiredBox(boxes, 'pitm')));
        const iref = singleBox(boxes, 'iref');
        const image: HeifImage = {
            bytes,
            items: readItemInfo(boxReader(bytes, requiredBox(boxes, 'iinf'))),
            locations: readLocations(boxReader(bytes, requiredBox(boxes, 'iloc'))),
            references: iref ? readGridReferences(boxReader(bytes, iref)) : new Map(),
            associations: readAssociations(boxReader(bytes, requiredBox(boxes, 'iprp'))),
            idat: singleBox(boxes, 'idat'),
            mediaData: top.filter(box => box.type === 'mdat'),
        };
        const output = new CanonicalBytes(bytes.length * 2 + 1024);
        output.append(PREFIX);
        appendItem(output, image, primary);
        return output.assemble();
    } catch (error) {
        if (error instanceof InvalidHeif) return undefined;
        throw error;
    }
}
