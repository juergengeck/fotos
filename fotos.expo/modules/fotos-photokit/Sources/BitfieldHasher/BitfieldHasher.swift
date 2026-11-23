import CryptoKit
import Foundation

public enum BitfieldHasher {
    public enum FileHashError: Error { case invalidChunkSize, sizeOverflow }

    /// Videos use their unmodified encoded bytes, not image canonicalization.
    /// Bound memory to one chunk even for multi-GB resources.
    public static func rawFileContentHash(_ url: URL, chunkSize: Int = 1_048_576) throws -> (contentHash: String, byteSize: Int64) {
        guard chunkSize > 0 else { throw FileHashError.invalidChunkSize }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        var size: Int64 = 0
        while true {
            let count = try autoreleasepool {
                let chunk = try handle.read(upToCount: chunkSize) ?? Data()
                hash.update(data: chunk)
                return chunk.count
            }
            if count == 0 { break }
            let (nextSize, overflow) = size.addingReportingOverflow(Int64(count))
            guard !overflow else { throw FileHashError.sizeOverflow }
            size = nextSize
        }
        return (hash.finalize().map { String(format: "%02x", $0) }.joined(), size)
    }

    /// Match the canonical byte ranges in @refinio/media.core/bitfield-hash.
    public static func contentHash(_ data: Data) -> String {
        let digest = data.withUnsafeBytes { bytes in
            var hash = SHA256()
            let ranges: [Range<Int>]
            if bytes.count >= 2 && bytes[0] == 0xff && bytes[1] == 0xd8 {
                ranges = jpegRanges(bytes)
            } else if pngSignature.elementsEqual(bytes.prefix(pngSignature.count)),
                      let png = pngRanges(bytes) {
                ranges = png
            } else if let heif = HEIFCanonical.chunks(bytes) {
                for chunk in heif {
                    switch chunk {
                    case .bytes(let data): hash.update(data: data)
                    case .range(let range):
                        hash.update(bufferPointer: UnsafeRawBufferPointer(rebasing: bytes[range]))
                    }
                }
                return hash.finalize()
            } else {
                ranges = [0..<bytes.count]
            }
            for range in ranges {
                hash.update(bufferPointer: UnsafeRawBufferPointer(rebasing: bytes[range]))
            }
            return hash.finalize()
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func jpegRanges(_ bytes: UnsafeRawBufferPointer) -> [Range<Int>] {
        var ranges = [0..<2]
        var offset = 2
        while offset < bytes.count - 1 && bytes[offset] == 0xff {
            let marker = bytes[offset + 1]
            if marker == 0xd9 {
                ranges.append(offset..<(offset + 2))
                break
            }
            if marker == 0xda {
                ranges.append(offset..<bytes.count)
                break
            }
            if (0xd0...0xd7).contains(marker) || marker == 0x01 {
                ranges.append(offset..<(offset + 2))
                offset += 2
                continue
            }
            guard offset + 3 < bytes.count else { break }
            let length = (Int(bytes[offset + 2]) << 8) | Int(bytes[offset + 3])
            let end = offset + 2 + length
            if !(0xe0...0xef).contains(marker) && marker != 0xfe {
                ranges.append(offset..<min(end, bytes.count))
            }
            offset = end
        }
        return ranges
    }

    private static let pngSignature: [UInt8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    private static let pngImageChunks: Set<String> = ["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "acTL", "fcTL", "fdAT"]
    private static let pngCrcTable: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 {
            value = (value >> 1) ^ (value & 1 == 1 ? 0xedb88320 : 0)
        }
        return value
    }

    private static func uint32(_ bytes: UnsafeRawBufferPointer, _ offset: Int) -> UInt32 {
        (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16)
            | (UInt32(bytes[offset + 2]) << 8) | UInt32(bytes[offset + 3])
    }

    private static func validPngCrc(_ bytes: UnsafeRawBufferPointer, start: Int, end: Int, expected: UInt32) -> Bool {
        var crc: UInt32 = 0xffffffff
        for offset in start..<end {
            crc = (crc >> 8) ^ pngCrcTable[Int((crc ^ UInt32(bytes[offset])) & 0xff)]
        }
        return (crc ^ 0xffffffff) == expected
    }

    private static func isUppercaseLetter(_ byte: UInt8) -> Bool { (65...90).contains(byte) }

    private static func isLetter(_ byte: UInt8) -> Bool {
        isUppercaseLetter(byte) || (97...122).contains(byte)
    }

    private static func pngRanges(_ bytes: UnsafeRawBufferPointer) -> [Range<Int>]? {
        var offset = pngSignature.count
        var ranges = [0..<offset]
        var previous = ""
        var sawData = false
        var sawPalette = false
        var sawTransparency = false
        var colorType: UInt8 = 0

        while offset + 12 <= bytes.count {
            let length = Int(uint32(bytes, offset))
            let data = offset + 8
            let crcOffset = data + length
            let end = crcOffset + 4
            guard length <= 0x7fffffff, end <= bytes.count,
                  isLetter(bytes[offset + 4]), isLetter(bytes[offset + 5]),
                  isUppercaseLetter(bytes[offset + 6]), isLetter(bytes[offset + 7]),
                  validPngCrc(bytes, start: offset + 4, end: crcOffset, expected: uint32(bytes, crcOffset))
            else { return nil }
            let type = String(decoding: bytes[(offset + 4)..<data], as: UTF8.self)
            guard pngImageChunks.contains(type) || !isUppercaseLetter(bytes[offset + 4]) else { return nil }

            switch type {
            case "IHDR":
                guard previous.isEmpty, length == 13, uint32(bytes, data) != 0, uint32(bytes, data + 4) != 0
                else { return nil }
                colorType = bytes[data + 9]
            case "PLTE":
                guard !sawData, !sawPalette, !sawTransparency, (1...768).contains(length), length % 3 == 0
                else { return nil }
                sawPalette = true
            case "tRNS":
                guard !sawData, !sawTransparency, colorType != 3 || sawPalette else { return nil }
                sawTransparency = true
            case "IDAT":
                guard !sawData || previous == "IDAT", colorType != 3 || sawPalette else { return nil }
                sawData = true
            case "IEND":
                guard sawData, length == 0, end == bytes.count else { return nil }
            default:
                break
            }
            if previous.isEmpty && type != "IHDR" { return nil }
            if pngImageChunks.contains(type) { ranges.append(offset..<end) }
            previous = type
            offset = end
        }
        return previous == "IEND" ? ranges : nil
    }
}
