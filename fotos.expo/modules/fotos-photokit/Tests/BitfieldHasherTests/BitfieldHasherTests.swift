import BitfieldHasher
import Foundation
import XCTest

final class BitfieldHasherTests: XCTestCase {
    private struct Fixture: Decodable {
        let file: String
        let contentHash: String
    }

    func testSharedGoldenHashes() throws {
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../../fotos.core/test/fixtures/content-hash").standardizedFileURL
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: folder.appendingPathComponent("hashes.json")))
        for fixture in fixtures {
            let data = try Data(contentsOf: folder.appendingPathComponent(fixture.file))
            XCTAssertEqual(BitfieldHasher.contentHash(data), fixture.contentHash, fixture.file)
        }
    }
}
