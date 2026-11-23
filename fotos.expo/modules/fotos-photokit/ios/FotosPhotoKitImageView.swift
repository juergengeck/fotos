import ExpoModulesCore
import Photos
import UIKit

/// Direct PhotoKit rendering for recycled gallery cells and contained lightboxes.
/// No original-file export or network request is needed to display local previews.
final class FotosPhotoKitImageView: ExpoView {
    private struct Request: Equatable {
        let assetId: String
        let width: Int
        let height: Int
        let cover: Bool
        let allowNetworkAccess: Bool
    }

    var assetId = "" {
        didSet {
            guard assetId != oldValue else { return }
            cancelRequest()
            imageView.image = nil
            hasFinalImage = false
            setNeedsLayout()
        }
    }

    var resizeMode = "cover" {
        didSet {
            guard resizeMode != oldValue else { return }
            imageView.contentMode = resizeMode == "contain" ? .scaleAspectFit : .scaleAspectFill
            cancelRequest()
            setNeedsLayout()
        }
    }

    var allowNetworkAccess = false {
        didSet {
            guard allowNetworkAccess != oldValue else { return }
            cancelRequest()
            setNeedsLayout()
        }
    }

    private let imageView = UIImageView()
    private let manager = PHImageManager.default()
    private var requestId: PHImageRequestID = PHInvalidImageRequestID
    private var currentRequest: Request?
    private var generation: UInt64 = 0
    private var hasFinalImage = false
    private static let maximumEdge: CGFloat = 2048

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        clipsToBounds = true
        imageView.clipsToBounds = true
        imageView.contentMode = .scaleAspectFill
        imageView.isUserInteractionEnabled = false
        addSubview(imageView)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        imageView.frame = bounds
        updateRequest()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            cancelRequest()
            imageView.image = nil
            hasFinalImage = false
        } else {
            setNeedsLayout()
        }
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.displayScale != traitCollection.displayScale { setNeedsLayout() }
    }

    private func layoutRequest() -> Request? {
        guard window != nil, !assetId.isEmpty, bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = max(1, window?.screen.scale ?? traitCollection.displayScale)
        let width = bounds.width * scale, height = bounds.height * scale
        guard width.isFinite, height.isFinite else { return nil }
        let factor = min(1, Self.maximumEdge / max(width, height))
        return Request(assetId: assetId, width: max(1, Int(ceil(width * factor))),
            height: max(1, Int(ceil(height * factor))), cover: resizeMode != "contain",
            allowNetworkAccess: allowNetworkAccess)
    }

    private func updateRequest() {
        guard let request = layoutRequest() else { cancelRequest(); return }
        guard request != currentRequest else { return }
        cancelRequest()
        currentRequest = request
        guard FotosPhotoKitLibrary.hasReadAccess,
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [request.assetId], options: nil).firstObject else { return }
        let token = generation
        let options = PHImageRequestOptions()
        options.version = .current
        options.deliveryMode = .opportunistic
        options.resizeMode = .exact
        options.isNetworkAccessAllowed = request.allowNetworkAccess
        requestId = manager.requestImage(for: asset,
            targetSize: CGSize(width: request.width, height: request.height),
            contentMode: request.cover ? .aspectFill : .aspectFit, options: options) { [weak self] image, info in
            // Callbacks can be synchronous or arrive off-main after cancellation.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == token, self.currentRequest == request, self.window != nil else { return }
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) == true
                let cancelled = (info?[PHImageCancelledKey] as? Bool) == true
                guard !cancelled, info?[PHImageErrorKey] == nil, let image else { return }
                // Preserve an existing final render during resizing, and never
                // let an out-of-order degraded callback downgrade the image.
                guard !degraded || !self.hasFinalImage else { return }
                self.imageView.image = image
                if !degraded {
                    self.hasFinalImage = true
                    self.requestId = PHInvalidImageRequestID
                }
            }
        }
    }

    private func cancelRequest() {
        generation &+= 1
        currentRequest = nil
        if requestId != PHInvalidImageRequestID { manager.cancelImageRequest(requestId) }
        requestId = PHInvalidImageRequestID
    }

    deinit {
        if requestId != PHInvalidImageRequestID { manager.cancelImageRequest(requestId) }
    }
}
