import Foundation

/// One instance represents one process. Its first use sweeps prior-process
/// files; later library/module instances must retain files returned to callers.
final class PhotoKitTemporaryDirectory {
    static let currentProcess = PhotoKitTemporaryDirectory(
        url: FileManager.default.temporaryDirectory.appendingPathComponent("fotos-photokit", isDirectory: true))

    private let url: URL
    private let lock = NSLock()
    private var preparation: Result<URL, Error>?

    init(url: URL) { self.url = url }

    @discardableResult
    func prepare() throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        if let preparation { return try preparation.get() }
        let result = Result<URL, Error> {
            let manager = FileManager.default
            if manager.fileExists(atPath: url.path) {
                for child in try manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                    try manager.removeItem(at: child)
                }
            }
            try manager.createDirectory(at: url, withIntermediateDirectories: true)
            return url
        }
        preparation = result
        return try result.get()
    }

    func makeURL(pathExtension: String) throws -> URL {
        let folder = try prepare()
        // iOS can clear tmp while the app is inactive. Recreate the directory,
        // without sweeping any current-process files that survived.
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(pathExtension)
    }
}
