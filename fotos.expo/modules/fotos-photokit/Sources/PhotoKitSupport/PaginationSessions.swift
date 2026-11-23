import Foundation

enum PhotoKitPageDataset: Hashable {
    case assets
    case albums
    case albumMembers(String)
}

enum PhotoKitPageError: LocalizedError {
    case invalidCursor
    case capacity

    var errorDescription: String? {
        switch self {
        case .invalidCursor: return "The Photos page cursor is stale or does not match this dataset and offset"
        case .capacity: return "Too many active Photos page cursors; release an unused cursor before starting another page session"
        }
    }
}

struct PhotoKitCursorPage<Value> {
    let value: Value
    let nextOffset: Int?
    let cursor: String?
}

/// An opaque cursor owns one immutable snapshot and advances exactly once per
/// expected offset. New scans never replace another caller's retained snapshot.
final class PhotoKitPaginationSessions<Snapshot> {
    private struct Session {
        let dataset: PhotoKitPageDataset
        let snapshot: Snapshot
        var offset: Int
        var expiresAt: TimeInterval
    }

    private let lock = NSLock()
    private var sessions: [String: Session] = [:]
    private let capacity: Int
    private let lifetime: TimeInterval
    private let clock: () -> TimeInterval

    init(capacity: Int = 32, lifetime: TimeInterval = 300,
         clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        precondition(capacity > 0 && lifetime > 0)
        self.capacity = capacity
        self.lifetime = lifetime
        self.clock = clock
    }

    func read<Value>(dataset: PhotoKitPageDataset, offset: Int, cursor: String?,
                     create: () throws -> Snapshot,
                     page: (Snapshot) throws -> (value: Value, nextOffset: Int?)) throws -> PhotoKitCursorPage<Value> {
        lock.lock()
        defer { lock.unlock() }
        let now = clock()
        sessions = sessions.filter { $0.value.expiresAt > now }
        let snapshot: Snapshot
        if let cursor {
            guard let session = sessions[cursor], session.dataset == dataset, session.offset == offset, offset > 0 else {
                throw PhotoKitPageError.invalidCursor
            }
            snapshot = session.snapshot
        } else {
            guard offset == 0 else { throw PhotoKitPageError.invalidCursor }
            snapshot = try create()
        }
        let result = try page(snapshot)
        guard let nextOffset = result.nextOffset else {
            if let cursor { sessions.removeValue(forKey: cursor) }
            return PhotoKitCursorPage(value: result.value, nextOffset: nil, cursor: nil)
        }
        guard nextOffset > offset else { throw PhotoKitPageError.invalidCursor }
        if cursor == nil && sessions.count >= capacity { throw PhotoKitPageError.capacity }
        let id = cursor ?? UUID().uuidString
        sessions[id] = Session(dataset: dataset, snapshot: snapshot, offset: nextOffset, expiresAt: now + lifetime)
        return PhotoKitCursorPage(value: result.value, nextOffset: nextOffset, cursor: id)
    }

    /// Unknown, expired and already-completed cursors are safe to release.
    func release(_ id: String) {
        lock.lock()
        sessions.removeValue(forKey: id)
        lock.unlock()
    }
}
