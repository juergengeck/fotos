import Foundation
import Photos
import UIKit

/// PhotoKit may report degraded and final results; cancellation/finalization must
/// still resume the async caller exactly once.
private final class PhotoKitThumbnailRequest {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<UIImage?, Error>?
    private var outcome: Result<UIImage?, Error>?
    private var request: PHImageRequestID?

    func install(_ continuation: CheckedContinuation<UIImage?, Error>) {
        lock.lock()
        if let outcome {
            lock.unlock()
            continuation.resume(with: outcome)
        } else {
            self.continuation = continuation
            lock.unlock()
        }
    }

    func setRequest(_ request: PHImageRequestID) {
        lock.lock()
        self.request = request
        let completed = outcome != nil
        lock.unlock()
        if completed { PHImageManager.default().cancelImageRequest(request) }
    }

    func finish(_ result: Result<UIImage?, Error>) {
        lock.lock()
        guard outcome == nil else { lock.unlock(); return }
        outcome = result
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    func cancel() {
        finish(.failure(CancellationError()))
        lock.lock()
        let request = request
        lock.unlock()
        if let request { PHImageManager.default().cancelImageRequest(request) }
    }
}

func requestPhotoKitThumbnail(_ asset: PHAsset, edge: Int, allowNetworkAccess: Bool) async throws -> UIImage? {
    let state = PhotoKitThumbnailRequest()
    let options = PHImageRequestOptions()
    options.version = .original
    options.deliveryMode = allowNetworkAccess ? .highQualityFormat : .fastFormat
    options.resizeMode = .exact
    options.isNetworkAccessAllowed = allowNetworkAccess
    return try await withTaskCancellationHandler(operation: {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            state.install(continuation)
            let request = PHImageManager.default().requestImage(for: asset,
                targetSize: CGSize(width: edge, height: edge), contentMode: .aspectFit, options: options) { image, info in
                if (info?[PHImageCancelledKey] as? Bool) == true {
                    state.finish(.failure(CancellationError()))
                } else if let error = info?[PHImageErrorKey] as? Error {
                    let photoError = error as NSError
                    let isMissingPreview = photoError.domain == PHPhotosErrorDomain
                        && photoError.code == PHPhotosError.Code.missingResource.rawValue
                    state.finish(isNetworkRequired(error) || isMissingPreview ? .success(nil) : .failure(error))
                } else if allowNetworkAccess && (info?[PHImageResultIsDegradedKey] as? Bool) == true {
                    return
                } else if let image {
                    state.finish(.success(image))
                } else if !allowNetworkAccess && (info?[PHImageResultIsInCloudKey] as? Bool) == true {
                    state.finish(.success(nil))
                } else {
                    state.finish(.failure(FotosPhotoKitError.invalidThumbnail))
                }
            }
            state.setRequest(request)
        }
    }, onCancel: { state.cancel() })
}
