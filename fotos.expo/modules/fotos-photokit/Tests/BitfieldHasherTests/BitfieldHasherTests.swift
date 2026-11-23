import BitfieldHasher
import CryptoKit
import Foundation
import XCTest

final class BitfieldHasherTests: XCTestCase {
    private struct Fixture: Decodable {
        let file: String
        let contentHash: String
    }

    private struct GeneratedFixtures: Decodable {
        struct Pair: Decodable {
            let original: String
            let rewritten: String
            let contentHash: String
        }
        let pairs: [Pair]
    }

    private let sharedFixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../one/packages/media.core/test/fixtures/bitfield-hash")
        .standardizedFileURL

    func testSharedGoldenHashes() throws {
        let fixtures = try JSONDecoder().decode([Fixture].self,
            from: Data(contentsOf: sharedFixtures.appendingPathComponent("hashes.json")))
        for fixture in fixtures {
            let data = try Data(contentsOf: sharedFixtures.appendingPathComponent(fixture.file))
            XCTAssertEqual(BitfieldHasher.contentHash(data), fixture.contentHash, fixture.file)
        }
    }

    func testMetadataRewritesKeepTheSharedIdentity() throws {
        let fixtures = try JSONDecoder().decode(GeneratedFixtures.self,
            from: Data(contentsOf: sharedFixtures.appendingPathComponent("generated-pairs.json")))
        for pair in fixtures.pairs {
            let original = try Data(contentsOf: sharedFixtures.appendingPathComponent(pair.original))
            let rewritten = try Data(contentsOf: sharedFixtures.appendingPathComponent(pair.rewritten))
            XCTAssertNotEqual(original.count, rewritten.count, pair.rewritten)
            XCTAssertEqual(BitfieldHasher.contentHash(original), pair.contentHash, pair.original)
            XCTAssertEqual(BitfieldHasher.contentHash(rewritten), pair.contentHash, pair.rewritten)
        }
    }
    func testRawFileHashCrossesDefaultVideoChunkBoundaries() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let bytes = Data((0..<(2 * 1_048_576 + 17)).map { UInt8($0 % 251) })
        try bytes.write(to: file)
        let expected = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let result = try BitfieldHasher.rawFileContentHash(file)
        XCTAssertEqual(result.contentHash, expected)
        XCTAssertEqual(result.byteSize, Int64(bytes.count))
    }

    func testRawFileHashHandlesPartialChunksAndEmptyFiles() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        for size in [0, 1, 63, 64, 65, 8193] {
            let bytes = Data((0..<size).map { UInt8($0 % 251) })
            try bytes.write(to: file)
            let expected = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            for chunkSize in [1, 64, 1024] {
                let result = try BitfieldHasher.rawFileContentHash(file, chunkSize: chunkSize)
                XCTAssertEqual(result.contentHash, expected, "size \(size), chunk \(chunkSize)")
                XCTAssertEqual(result.byteSize, Int64(size))
            }
        }
        XCTAssertThrowsError(try BitfieldHasher.rawFileContentHash(file, chunkSize: 0))
    }
}
