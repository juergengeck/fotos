import Foundation

/// Keep encoded image data in file ranges; only canonical control words allocate.
enum HEIFHashChunk {
    case bytes(Data)
    case range(Range<Int>)
}
private enum HEIFInvalid: Error { case structure }
private struct HEIFBox { let type: String; let payload: Range<Int> }
private struct HEIFReader {
    let bytes: UnsafeRawBufferPointer
    var offset: Int
    let end: Int
    mutating func uint(_ width: Int) throws -> UInt64 {
        guard (0...8).contains(width), offset <= end, width <= end - offset else { throw HEIFInvalid.structure }
        var value: UInt64 = 0
        for _ in 0..<width { value = (value << 8) | UInt64(bytes[offset]); offset += 1 }
        // Match JavaScript's exact integer domain for shared parser parity.
        guard value <= 0x1fffffffffffff else { throw HEIFInvalid.structure }
        return value
    }
    mutating func int(_ width: Int) throws -> Int {
        let value = try uint(width)
        guard value <= UInt64(Int.max) else { throw HEIFInvalid.structure }
        return Int(value)
    }
    mutating func fourcc() throws -> String {
        guard offset <= end, end - offset >= 4 else { throw HEIFInvalid.structure }
        defer { offset += 4 }
        return String(decoding: bytes[offset..<(offset + 4)], as: UTF8.self)
    }
    mutating func finish() throws {
        guard offset == end else { throw HEIFInvalid.structure }
    }
}
private struct HEIFItem { let type: String; let protection: UInt64 }
private struct HEIFExtent { let offset: UInt64; let length: UInt64 }
private struct HEIFLocation {
    let construction: UInt64
    let dataReference: UInt64
    let base: UInt64
    let extents: [HEIFExtent]
}
private struct HEIFAssociation { let index: Int; let essential: Bool }
private struct HEIFNode {
    let type: String
    let properties: [HEIFBox]
    let payload: [Range<Int>]
    let payloadLength: Int
    let children: [Int]
}

/// Unsupported structures preserve their exact raw-byte hash.
enum HEIFCanonical {
    static func chunks(_ bytes: UnsafeRawBufferPointer) -> [HEIFHashChunk]? {
        do { return try HEIFParser(bytes: bytes).canonical() } catch { return nil }
    }
}

private final class HEIFParser {
    private let bytes: UnsafeRawBufferPointer
    private var items: [Int: HEIFItem] = [:]
    private var locations: [Int: HEIFLocation] = [:]
    private var associations: [Int: [HEIFAssociation]] = [:]
    private var properties: [HEIFBox] = []
    private var references: [Int: [Int]] = [:]
    private var mediaData: [Range<Int>] = []
    private var itemData: Range<Int>?
    private var output: [HEIFHashChunk] = []
    private var outputCount = 0
    private let outputLimit: Int
    private let ignoredProperties: Set<String> = [
        "colr", "pixi", "pasp", "auxC", "rloc", "lsel", "mdcv", "clli", "amve", "udes", "clap", "imir", "irot",
    ]

    init(bytes: UnsafeRawBufferPointer) throws {
        self.bytes = bytes
        guard bytes.count <= (Int.max - 1024) / 2 else { throw HEIFInvalid.structure }
        outputLimit = bytes.count * 2 + 1024
    }
    private func reader(_ range: Range<Int>) -> HEIFReader {
        HEIFReader(bytes: bytes, offset: range.lowerBound, end: range.upperBound)
    }
    private func boxes(_ range: Range<Int>) throws -> [HEIFBox] {
        var r = reader(range)
        var result: [HEIFBox] = []
        while r.offset < r.end {
            let start = r.offset
            let shortSize = try r.uint(4)
            let type = try r.fourcc()
            let size: Int
            if shortSize == 1 { size = try r.int(8) }
            else if shortSize == 0 { size = r.end - start }
            else { size = Int(shortSize) }
            guard size >= r.offset - start, size <= r.end - start else { throw HEIFInvalid.structure }
            let end = start + size
            result.append(HEIFBox(type: type, payload: r.offset..<end))
            r.offset = end
        }
        return result
    }
    private func singleton(_ type: String, _ boxes: [HEIFBox], required: Bool = false) throws -> HEIFBox? {
        let matching = boxes.filter { $0.type == type }
        guard matching.count <= 1, !required || matching.count == 1 else { throw HEIFInvalid.structure }
        return matching.first
    }
    private func fullBox(_ box: HEIFBox, versions: ClosedRange<Int>, allowedFlags: UInt64 = 0) throws -> (HEIFReader, Int, UInt64) {
        var r = reader(box.payload)
        let version = try r.int(1), flags = try r.uint(3)
        guard versions.contains(version), flags & ~allowedFlags == 0 else { throw HEIFInvalid.structure }
        return (r, version, flags)
    }
    func canonical() throws -> [HEIFHashChunk] {
        guard bytes.count >= 16 else { throw HEIFInvalid.structure }
        var firstHeader = reader(4..<bytes.count)
        guard ["ftyp", "free", "skip", "wide", "mdat", "meta", "uuid"].contains(try firstHeader.fourcc())
        else { throw HEIFInvalid.structure }
        let top = try boxes(0..<bytes.count)
        let ftyp = try singleton("ftyp", top, required: true)!
        var brands = reader(ftyp.payload)
        guard ftyp.payload.count >= 8, (ftyp.payload.count - 8) % 4 == 0 else { throw HEIFInvalid.structure }
        let major = try brands.fourcc()
        _ = try brands.uint(4)
        let supported: Set<String> = ["mif1", "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "avif"]
        var recognized = supported.contains(major)
        while brands.offset < brands.end { recognized = supported.contains(try brands.fourcc()) || recognized }
        guard recognized else { throw HEIFInvalid.structure }
        mediaData = top.filter { $0.type == "mdat" }.map(\.payload)
        let meta = try singleton("meta", top, required: true)!
        let (metaReader, _, _) = try fullBox(meta, versions: 0...0)
        let children = try boxes(metaReader.offset..<metaReader.end)
        let pitm = try singleton("pitm", children, required: true)!
        var (primaryReader, primaryVersion, _) = try fullBox(pitm, versions: 0...1)
        let primary = try primaryReader.int(primaryVersion == 0 ? 2 : 4)
        try primaryReader.finish()
        try parseItemInfo(singleton("iinf", children, required: true)!)
        try parseLocations(singleton("iloc", children, required: true)!)
        try parseProperties(singleton("iprp", children, required: true)!)
        if let iref = try singleton("iref", children) { try parseReferences(iref) }
        itemData = try singleton("idat", children)?.payload
        let prefix = Data("FOTOS-HEIF-1\0".utf8)
        try append(.bytes(prefix), count: prefix.count)
        try emit(node(primary, allowGrid: true))
        return output
    }
    private func parseItemInfo(_ box: HEIFBox) throws {
        var (r, version, _) = try fullBox(box, versions: 0...1)
        let count = try r.int(version == 0 ? 2 : 4)
        let entries = try boxes(r.offset..<r.end)
        guard entries.count == count, entries.allSatisfy({ $0.type == "infe" }) else { throw HEIFInvalid.structure }
        for entry in entries {
            var info = reader(entry.payload)
            let version = try info.int(1)
            _ = try info.uint(3)
            guard version == 2 || version == 3 else { continue }
            let id = try info.int(version == 2 ? 2 : 4), protection = try info.uint(2)
            let type = try info.fourcc()
            guard items[id] == nil else { throw HEIFInvalid.structure }
            items[id] = HEIFItem(type: type, protection: protection)
        }
    }
    private func parseLocations(_ box: HEIFBox) throws {
        var (r, version, _) = try fullBox(box, versions: 0...2)
        let widths = try r.int(1), otherWidths = try r.int(1)
        let offsetSize = widths >> 4, lengthSize = widths & 15, baseSize = otherWidths >> 4
        let indexSize = version == 0 ? 0 : otherWidths & 15
        guard offsetSize <= 8, lengthSize <= 8, baseSize <= 8, indexSize <= 8 else { throw HEIFInvalid.structure }
        let count = try r.int(version < 2 ? 2 : 4)
        guard count <= bytes.count else { throw HEIFInvalid.structure }
        for _ in 0..<count {
            let id = try r.int(version < 2 ? 2 : 4)
            let construction: UInt64 = version == 0 ? 0 : try r.uint(2)
            let dataReference = try r.uint(2), base = try r.uint(baseSize)
            let extentCount = try r.int(2)
            let recordWidth = indexSize + offsetSize + lengthSize
            guard locations[id] == nil, extentCount == 0 || (recordWidth > 0 && extentCount <= (r.end - r.offset) / recordWidth)
            else { throw HEIFInvalid.structure }
            var extents: [HEIFExtent] = []
            for _ in 0..<extentCount {
                if version != 0 { _ = try r.uint(indexSize) }
                let offset = try r.uint(offsetSize), length = try r.uint(lengthSize)
                extents.append(HEIFExtent(offset: offset, length: length))
            }
            locations[id] = HEIFLocation(construction: construction, dataReference: dataReference, base: base, extents: extents)
        }
        try r.finish()
    }
    private func parseProperties(_ box: HEIFBox) throws {
        let children = try boxes(box.payload)
        properties = try boxes(singleton("ipco", children, required: true)!.payload)
        let ipmas = children.filter { $0.type == "ipma" }
        guard !ipmas.isEmpty else { throw HEIFInvalid.structure }
        var seenHeaders: Set<Int> = []
        for ipma in ipmas {
            var (r, version, flags) = try fullBox(ipma, versions: 0...1, allowedFlags: 1)
            guard seenHeaders.insert(version * 2 + Int(flags)).inserted else { throw HEIFInvalid.structure }
            let count = try r.int(4)
            guard count <= bytes.count else { throw HEIFInvalid.structure }
            for _ in 0..<count {
                let id = try r.int(version == 0 ? 2 : 4), associationCount = try r.int(1)
                guard associations[id] == nil else { throw HEIFInvalid.structure }
                var item: [HEIFAssociation] = []
                for _ in 0..<associationCount {
                    let value = try r.int(flags & 1 == 0 ? 1 : 2)
                    let essentialMask = flags & 1 == 0 ? 0x80 : 0x8000
                    let index = value & (essentialMask - 1)
                    if index != 0 {
                        guard index <= properties.count else { throw HEIFInvalid.structure }
                        item.append(HEIFAssociation(index: index, essential: value & essentialMask != 0))
                    }
                }
                associations[id] = item
            }
            try r.finish()
        }
    }
    private func parseReferences(_ box: HEIFBox) throws {
        let (r, version, _) = try fullBox(box, versions: 0...1)
        for reference in try boxes(r.offset..<r.end) {
            guard reference.type == "dimg" else { continue }
            var ref = reader(reference.payload)
            let from = try ref.int(version == 0 ? 2 : 4), count = try ref.int(2)
            var ids: [Int] = []
            for _ in 0..<count { ids.append(try ref.int(version == 0 ? 2 : 4)) }
            try ref.finish()
            guard references[from] == nil else { throw HEIFInvalid.structure }
            references[from] = ids
        }
    }
    private func node(_ id: Int, allowGrid: Bool) throws -> HEIFNode {
        guard let item = items[id], item.protection == 0,
              item.type == "hvc1" || item.type == "av01" || (allowGrid && item.type == "grid"),
              let location = locations[id], location.dataReference == 0, location.construction <= 1,
              !location.extents.isEmpty, let itemAssociations = associations[id] else { throw HEIFInvalid.structure }
        var selected: [String: HEIFBox] = [:]
        let codec = item.type == "hvc1" ? "hvcC" : item.type == "av01" ? "av1C" : ""
        for association in itemAssociations {
            let property = properties[association.index - 1]
            if property.type == "ispe" || property.type == codec {
                guard selected[property.type] == nil else { throw HEIFInvalid.structure }
                selected[property.type] = property
            } else if association.essential && !ignoredProperties.contains(property.type) { throw HEIFInvalid.structure }
        }
        guard let ispe = selected["ispe"], ispe.payload.count == 12 else { throw HEIFInvalid.structure }
        var dimensions = reader(ispe.payload)
        guard try dimensions.uint(4) == 0, try dimensions.uint(4) != 0, try dimensions.uint(4) != 0 else { throw HEIFInvalid.structure }
        if !codec.isEmpty {
            guard let config = selected[codec], config.payload.count >= (codec == "hvcC" ? 23 : 4),
                  bytes[config.payload.lowerBound] == (codec == "hvcC" ? 1 : 0x81) else { throw HEIFInvalid.structure }
        }
        var ranges: [Range<Int>] = []
        var payloadLength = 0
        for extent in location.extents {
            let (startValue, overflow) = location.base.addingReportingOverflow(extent.offset)
            guard !overflow, extent.length > 0, startValue <= UInt64(bytes.count), extent.length <= UInt64(bytes.count) else { throw HEIFInvalid.structure }
            let start: Int
            if location.construction == 0 { start = Int(startValue) }
            else {
                guard let idat = itemData, startValue <= UInt64(idat.count) else { throw HEIFInvalid.structure }
                start = idat.lowerBound + Int(startValue)
            }
            guard Int(extent.length) <= bytes.count - start else { throw HEIFInvalid.structure }
            let end = start + Int(extent.length)
            let contained = location.construction == 0 ? isInMediaData(start: start, end: end)
                : itemData.map { start >= $0.lowerBound && end <= $0.upperBound } ?? false
            guard contained, payloadLength <= Int(UInt32.max) - Int(extent.length) else { throw HEIFInvalid.structure }
            payloadLength += Int(extent.length)
            ranges.append(start..<end)
        }
        var childIDs: [Int] = []
        if item.type == "grid" {
            guard payloadLength == 8 || payloadLength == 12 else { throw HEIFInvalid.structure }
            let payload = ranges.flatMap { Array(bytes[$0]) }
            guard payload[0] == 0, payload[1] & 0xfe == 0, payload.count == (payload[1] & 1 == 0 ? 8 : 12),
                  let ids = references[id], (Int(payload[2]) + 1) * (Int(payload[3]) + 1) == ids.count else { throw HEIFInvalid.structure }
            let dimensionSize = payload[1] & 1 == 0 ? 2 : 4
            for start in [4, 4 + dimensionSize] {
                guard payload[start..<(start + dimensionSize)].contains(where: { $0 != 0 }) else { throw HEIFInvalid.structure }
            }
            childIDs = ids
        } else if references[id] != nil { throw HEIFInvalid.structure }
        return HEIFNode(type: item.type, properties: selected.values.sorted { $0.type < $1.type },
                        payload: ranges, payloadLength: payloadLength, children: childIDs)
    }
    private func isInMediaData(start: Int, end: Int) -> Bool {
        // Top-level boxes are ordered and disjoint; avoid an extent-by-box scan.
        var lower = 0
        var upper = mediaData.count
        while lower < upper {
            let middle = lower + (upper - lower) / 2
            if mediaData[middle].lowerBound <= start { lower = middle + 1 }
            else { upper = middle }
        }
        return lower > 0 && end <= mediaData[lower - 1].upperBound
    }

    private func append(_ chunk: HEIFHashChunk, count: Int) throws {
        guard count >= 0, count <= outputLimit - outputCount else { throw HEIFInvalid.structure }
        outputCount += count
        output.append(chunk)
    }
    private func word(_ value: Int) throws {
        guard value >= 0, value <= Int(UInt32.max) else { throw HEIFInvalid.structure }
        let n = UInt32(value)
        try append(.bytes(Data([UInt8(n >> 24), UInt8((n >> 16) & 255), UInt8((n >> 8) & 255), UInt8(n & 255)])), count: 4)
    }
    private func emit(_ node: HEIFNode) throws {
        try append(.bytes(Data(node.type.utf8)), count: 4)
        try word(node.properties.count)
        for property in node.properties {
            try append(.bytes(Data(property.type.utf8)), count: 4)
            try word(property.payload.count)
            try append(.range(property.payload), count: property.payload.count)
        }
        try word(node.payloadLength)
        for range in node.payload { try append(.range(range), count: range.count) }
        try word(node.children.count)
        var childCodec: String?
        for id in node.children {
            let child = try self.node(id, allowGrid: false)
            guard childCodec == nil || childCodec == child.type else { throw HEIFInvalid.structure }
            childCodec = child.type
            try emit(child)
        }
    }
}
