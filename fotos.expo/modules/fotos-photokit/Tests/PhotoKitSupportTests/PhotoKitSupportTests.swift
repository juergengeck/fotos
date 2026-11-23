import Foundation
@testable import PhotoKitSupport
import XCTest

final class PhotoKitSupportTests: XCTestCase {
    private func read(_ sessions: PhotoKitPaginationSessions<[String]>, dataset: PhotoKitPageDataset = .assets,
                      offset: Int = 0, cursor: String? = nil, values: [String] = [], limit: Int = 1) throws -> PhotoKitCursorPage<[String]> {
        try sessions.read(dataset: dataset, offset: offset, cursor: cursor, create: { values }) { snapshot in
            let end = min(offset + limit, snapshot.count)
            return (Array(snapshot[offset..<end]), end < snapshot.count ? end : nil)
        }
    }

    func testIndependentStartsRetainTheirOwnSnapshotsAndDropExhaustedCursors() throws {
        let sessions = PhotoKitPaginationSessions<[String]>()
        let first = try read(sessions, values: ["first-0", "first-1", "first-2"])
        let second = try read(sessions, values: ["second-0", "second-1"])
        XCTAssertNotEqual(first.cursor, second.cursor)
        XCTAssertEqual(try read(sessions, offset: 1, cursor: first.cursor).value, ["first-1"])
        let secondEnd = try read(sessions, offset: 1, cursor: second.cursor)
        XCTAssertEqual(secondEnd.value, ["second-1"])
        XCTAssertNil(secondEnd.cursor)
        XCTAssertNil(secondEnd.nextOffset)
        let firstEnd = try read(sessions, offset: 2, cursor: first.cursor)
        XCTAssertEqual(firstEnd.value, ["first-2"])
        XCTAssertNil(firstEnd.cursor)
        XCTAssertThrowsError(try read(sessions, offset: 1, cursor: second.cursor))
    }

    func testCursorIsBoundToDatasetAlbumAndExpectedOffset() throws {
        let sessions = PhotoKitPaginationSessions<[String]>()
        let first = try read(sessions, dataset: .albumMembers("album-a"), values: ["a", "b", "c"])
        for dataset: PhotoKitPageDataset in [.assets, .albums, .albumMembers("album-b")] {
            XCTAssertThrowsError(try read(sessions, dataset: dataset, offset: 1, cursor: first.cursor))
        }
        XCTAssertThrowsError(try read(sessions, dataset: .albumMembers("album-a"), offset: 2, cursor: first.cursor))
        XCTAssertThrowsError(try read(sessions, offset: 1))
        XCTAssertThrowsError(try read(sessions, cursor: first.cursor))
        let next = try read(sessions, dataset: .albumMembers("album-a"), offset: 1, cursor: first.cursor)
        XCTAssertEqual(next.value, ["b"])
        XCTAssertEqual(next.cursor, first.cursor)
        XCTAssertThrowsError(try read(sessions, dataset: .albumMembers("album-a"), offset: 1, cursor: first.cursor))
    }

    func testCapacityExpiryAndIdempotentReleasePreserveActiveSessions() throws {
        var now: TimeInterval = 0
        let sessions = PhotoKitPaginationSessions<[String]>(capacity: 2, lifetime: 10, clock: { now })
        let first = try read(sessions, values: ["a", "b", "c"])
        let second = try read(sessions, values: ["d", "e"])
        XCTAssertThrowsError(try read(sessions, values: ["f", "g"]))
        XCTAssertEqual(try read(sessions, offset: 1, cursor: first.cursor).value, ["b"])
        sessions.release(try XCTUnwrap(second.cursor))
        sessions.release(try XCTUnwrap(second.cursor))
        sessions.release("unknown")
        _ = try read(sessions, values: ["f", "g"])
        now = 11
        XCTAssertThrowsError(try read(sessions, offset: 2, cursor: first.cursor))
        XCTAssertNotNil(try read(sessions, values: ["new", "session"]).cursor)
    }

    func testConcurrentStartsRemainIsolated() throws {
        let sessions = PhotoKitPaginationSessions<[String]>(capacity: 64)
        let resultsLock = NSLock()
        var results: [(Int, PhotoKitCursorPage<[String]>)] = []
        var failures: [Error] = []
        DispatchQueue.concurrentPerform(iterations: 32) { index in
            do {
                let result = try read(sessions, values: ["first-\(index)", "last-\(index)"])
                resultsLock.lock(); results.append((index, result)); resultsLock.unlock()
            } catch {
                resultsLock.lock(); failures.append(error); resultsLock.unlock()
            }
        }
        XCTAssertTrue(failures.isEmpty)
        XCTAssertEqual(Set(results.compactMap { $0.1.cursor }).count, 32)
        for (index, result) in results {
            XCTAssertEqual(try read(sessions, offset: 1, cursor: result.cursor).value, ["last-\(index)"])
        }
    }

    func testOneTimeTemporarySweepPreservesCurrentProcessFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let prior = root.appendingPathComponent("prior/nested")
        try FileManager.default.createDirectory(at: prior, withIntermediateDirectories: true)
        try Data([1]).write(to: prior.appendingPathComponent("orphan.jpg"))
        let directory = PhotoKitTemporaryDirectory(url: root)
        let current = try directory.makeURL(pathExtension: "jpg")
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("prior").path))
        try Data([2]).write(to: current)
        _ = try directory.prepare()
        let second = try directory.makeURL(pathExtension: "heic")
        try Data([3]).write(to: second)
        XCTAssertEqual(try Data(contentsOf: current), Data([2]))
        XCTAssertEqual(try Data(contentsOf: second), Data([3]))
    }

    func testTemporaryDirectoryCanBeRecreatedAfterSystemEviction() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = PhotoKitTemporaryDirectory(url: root)
        _ = try directory.prepare()
        try FileManager.default.removeItem(at: root)
        let file = try directory.makeURL(pathExtension: "jpg")
        try Data([1]).write(to: file)
        XCTAssertEqual(try Data(contentsOf: file), Data([1]))
    }
}
