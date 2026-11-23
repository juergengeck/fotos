import Foundation
import Photos

/// PhotoKit delivers ordered chunks on a serial queue. Keep only the current chunk
/// in memory, and close/unlink the partially written file on every failure.
private final class PhotoKitResourceWriter {
    let url: URL
    private let handle: FileHandle
    private let lock = NSLock()
    private var request: PHAssetResourceDataRequestID?
    private var cancelled = false
    private var closed = false
    private var writeError: Error?

    init(url: URL) throws {
        self.url = url
        guard FileManager.default.createFile(atPath: url.path, contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
            throw FotosPhotoKitError.io("Could not create a temporary original file")
        }
        do { handle = try FileHandle(forWritingTo: url) }
        catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    func setRequest(_ request: PHAssetResourceDataRequestID) {
        lock.lock()
        self.request = request
        let shouldCancel = cancelled || writeError != nil || closed
        lock.unlock()
        if shouldCancel { PHAssetResourceManager.default().cancelDataRequest(request) }
    }

    func write(_ data: Data) {
        lock.lock()
        if !closed && !cancelled && writeError == nil {
            do { try handle.write(contentsOf: data) }
            catch { writeError = error }
        }
        let failedRequest = writeError == nil ? nil : request
        lock.unlock()
        if let request = failedRequest { PHAssetResourceManager.default().cancelDataRequest(request) }
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let request = request
        lock.unlock()
        if let request { PHAssetResourceManager.default().cancelDataRequest(request) }
    }

    func complete(_ error: Error?) -> Result<URL, Error> {
        lock.lock()
        defer { lock.unlock() }
        if !closed {
            do { try handle.close() }
            catch { if writeError == nil { writeError = error } }
            closed = true
        }
        let failure = writeError ?? (cancelled ? CancellationError() : error)
        if let failure {
            try? FileManager.default.removeItem(at: url)
            return .failure(failure)
        }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard let size = attributes[.size] as? NSNumber, size.uint64Value > 0 else {
                throw FotosPhotoKitError.io("PhotoKit returned an empty original resource")
            }
            return .success(url)
        } catch {
            try? FileManager.default.removeItem(at: url)
            return .failure(error)
        }
    }

    func discard() {
        cancel()
        lock.lock()
        if !closed { try? handle.close(); closed = true }
        try? FileManager.default.removeItem(at: url)
        lock.unlock()
    }
}

func writePhotoKitResource(_ resource: PHAssetResource, to url: URL, allowNetworkAccess: Bool) async throws -> URL {
    let writer = try PhotoKitResourceWriter(url: url)
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = allowNetworkAccess
    do {
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let request = PHAssetResourceManager.default().requestData(for: resource, options: options,
                    dataReceivedHandler: { writer.write($0) },
                    completionHandler: { continuation.resume(with: writer.complete($0)) })
                writer.setRequest(request)
            }
        }, onCancel: { writer.cancel() })
    } catch {
        writer.discard()
        throw error
    }
}
