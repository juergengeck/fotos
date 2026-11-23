import Foundation
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

enum FotosPhotoKitError: LocalizedError {
    case unauthorized, missingAsset, missingAlbum, missingResource, invalidPage, invalidThumbnail
    case io(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Read access to the Photos library is required"
        case .missingAsset: return "The Photos asset no longer exists or is not accessible"
        case .missingAlbum: return "The Photos album no longer exists or is not accessible"
        case .missingResource: return "The Photos asset has no unmodified original photo or video resource"
        case .invalidPage: return "PhotoKit pagination requires offset >= 0 and limit > 0"
        case .invalidThumbnail: return "PhotoKit could not produce a bounded JPEG thumbnail"
        case .io(let message): return message
        }
    }
}

final class FotosPhotoKitLibrary {
    let observer = FotosPhotoKitObserver()
    private let pageLock = NSLock()
    private var assetPage: PHFetchResult<PHAsset>?
    private var albumPage: [(PHAssetCollection, String)]?
    private var memberPage: (id: String, assets: PHFetchResult<PHAsset>)?

    static var hasReadAccess: Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return status == .authorized || status == .limited
    }

    static func requireReadAccess() throws {
        guard hasReadAccess else { throw FotosPhotoKitError.unauthorized }
    }

    static func assetOptions() -> PHFetchOptions {
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d",
            PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.includeAllBurstAssets = true
        return options
    }

    static func fetchAssets(in album: PHAssetCollection? = nil) -> PHFetchResult<PHAsset> {
        if let album { return PHAsset.fetchAssets(in: album, options: assetOptions()) }
        return PHAsset.fetchAssets(with: assetOptions())
    }

    static func fetchAlbums(_ type: PHAssetCollectionType) -> PHFetchResult<PHAssetCollection> {
        PHAssetCollection.fetchAssetCollections(with: type, subtype: .any, options: nil)
    }

    private func page(offset: Int, limit: Int, count: Int) throws -> Range<Int> {
        guard offset >= 0, limit > 0 else { throw FotosPhotoKitError.invalidPage }
        let start = min(offset, count)
        return start..<(start + min(limit, count - start))
    }

    private func asset(_ id: String) throws -> PHAsset {
        try Self.requireReadAccess()
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
              asset.mediaType == .image || asset.mediaType == .video else { throw FotosPhotoKitError.missingAsset }
        return asset
    }

    private func resource(_ asset: PHAsset) throws -> PHAssetResource {
        let type: PHAssetResourceType = asset.mediaType == .video ? .video : .photo
        guard let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == type }) else {
            throw FotosPhotoKitError.missingResource
        }
        return resource
    }

    private func describe(_ asset: PHAsset, resource: PHAssetResource?, exif: [String: Any]? = nil) -> [String: Any] {
        var subtypes: [String] = []
        let mapping: [(PHAssetMediaSubtype, String)] = [
            (.photoLive, "live-photo"), (.photoHDR, "hdr"), (.photoPanorama, "panorama"),
            (.photoScreenshot, "screenshot"), (.photoDepthEffect, "depth"),
            (.videoCinematic, "cinematic"), (.videoHighFrameRate, "high-frame-rate"),
        ]
        for (flag, name) in mapping where asset.mediaSubtypes.contains(flag) { subtypes.append(name) }
        if asset.burstIdentifier != nil || asset.representsBurst { subtypes.append("burst") }
        var result: [String: Any] = [
            "id": asset.localIdentifier, "filename": resource?.originalFilename ?? (asset.mediaType == .video ? "Video" : "Photo"),
            "width": asset.pixelWidth, "height": asset.pixelHeight,
            "mediaType": asset.mediaType == .video ? "video" : "photo",
            "mediaSubtypes": subtypes, "duration": asset.duration, "favorite": asset.isFavorite,
        ]
        if let identifier = resource?.uniformTypeIdentifier, let mime = UTType(identifier)?.preferredMIMEType {
            result["mimeType"] = mime
        }
        if let date = asset.creationDate { result["creationTime"] = date.timeIntervalSince1970 * 1000 }
        if let date = asset.modificationDate { result["modificationTime"] = date.timeIntervalSince1970 * 1000 }
        if let location = asset.location {
            var coordinates: [String: Double] = ["latitude": location.coordinate.latitude, "longitude": location.coordinate.longitude]
            if location.verticalAccuracy >= 0, location.altitude.isFinite { coordinates["altitude"] = location.altitude }
            result["location"] = coordinates
        }
        if let burst = asset.burstIdentifier { result["burstIdentifier"] = burst }
        if let exif { result["exif"] = exif }
        return result
    }

    func listAssets(offset: Int, limit: Int) throws -> [String: Any] {
        try Self.requireReadAccess()
        pageLock.lock()
        defer { pageLock.unlock() }
        if offset == 0 { assetPage = Self.fetchAssets() }
        guard let assets = assetPage else { throw FotosPhotoKitError.invalidPage }
        let range = try page(offset: offset, limit: limit, count: assets.count)
        var result: [String: Any] = ["assets": range.map { index in
            let asset = assets.object(at: index)
            return describe(asset, resource: try? resource(asset))
        }]
        if range.upperBound < assets.count { result["nextOffset"] = range.upperBound }
        else { assetPage = nil }
        return result
    }

    func listAlbums(offset: Int, limit: Int) throws -> [String: Any] {
        try Self.requireReadAccess()
        pageLock.lock()
        defer { pageLock.unlock() }
        if offset == 0 {
            var albums: [(PHAssetCollection, String)] = []
            for (type, kind) in [(PHAssetCollectionType.album, "user"), (.smartAlbum, "smart")] {
                Self.fetchAlbums(type).enumerateObjects { album, _, _ in albums.append((album, kind)) }
            }
            albums.sort {
                let left = $0.0.localizedTitle ?? "", right = $1.0.localizedTitle ?? ""
                return left == right ? $0.0.localIdentifier < $1.0.localIdentifier : left < right
            }
            albumPage = albums
        }
        guard let albums = albumPage else { throw FotosPhotoKitError.invalidPage }
        let range = try page(offset: offset, limit: limit, count: albums.count)
        var result: [String: Any] = ["albums": range.map { index -> [String: Any] in
            let (album, kind) = albums[index]
            return ["id": album.localIdentifier, "name": album.localizedTitle ?? "Untitled Album", "kind": kind]
        }]
        if range.upperBound < albums.count { result["nextOffset"] = range.upperBound }
        else { albumPage = nil }
        return result
    }

    func listAlbumMembers(id: String, offset: Int, limit: Int) throws -> [String: Any] {
        try Self.requireReadAccess()
        pageLock.lock()
        defer { pageLock.unlock() }
        if offset == 0 {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil).firstObject,
                  album.assetCollectionType == .album || album.assetCollectionType == .smartAlbum else {
                throw FotosPhotoKitError.missingAlbum
            }
            memberPage = (id, Self.fetchAssets(in: album))
        }
        guard let snapshot = memberPage, snapshot.id == id else { throw FotosPhotoKitError.invalidPage }
        let assets = snapshot.assets
        let range = try page(offset: offset, limit: limit, count: assets.count)
        var result: [String: Any] = ["assetIds": range.map { assets.object(at: $0).localIdentifier }]
        if range.upperBound < assets.count { result["nextOffset"] = range.upperBound }
        else { memberPage = nil }
        return result
    }

    func inspectOriginal(id: String, allowNetworkAccess: Bool) async throws -> [String: Any] {
        let asset = try self.asset(id)
        let resource = try self.resource(asset)
        let url: URL
        do {
            url = try await writePhotoKitResource(resource, to: temporaryURL(extension: resource.originalFilename),
                allowNetworkAccess: allowNetworkAccess)
        } catch {
            if isNetworkRequired(error) {
                return ["asset": describe(try self.asset(id), resource: resource), "status": "icloud-deferred"]
            }
            throw error
        }
        defer { try? FileManager.default.removeItem(at: url) }
        let currentAsset = try self.asset(id)
        let data = try Data(contentsOf: url, options: .alwaysMapped)
        let metadata = asset.mediaType == .image ? imageMetadata(url) : nil
        return ["asset": describe(currentAsset, resource: resource, exif: metadata), "status": "available",
            "contentHash": BitfieldHasher.contentHash(data), "byteSize": data.count]
    }

    func originalFile(id: String, allowNetworkAccess: Bool) async throws -> String {
        let asset = try self.asset(id)
        let resource = try self.resource(asset)
        let url = try await writePhotoKitResource(resource, to: temporaryURL(extension: resource.originalFilename),
            allowNetworkAccess: allowNetworkAccess)
        do { _ = try self.asset(id); return url.absoluteString }
        catch { try? FileManager.default.removeItem(at: url); throw error }
    }

    func thumbnailFile(id: String, maxEdge: Int, allowNetworkAccess: Bool) async throws -> String? {
        guard maxEdge > 0 else { throw FotosPhotoKitError.invalidThumbnail }
        let asset = try self.asset(id)
        let edge = min(maxEdge, 512)
        let image = try await requestPhotoKitThumbnail(asset, edge: edge, allowNetworkAccess: allowNetworkAccess)
        guard let image else { return nil }
        _ = try self.asset(id)
        let width = image.size.width * image.scale, height = image.size.height * image.scale
        guard width.isFinite, height.isFinite, width > 0, height > 0 else { throw FotosPhotoKitError.invalidThumbnail }
        let factor = min(1, CGFloat(edge) / max(width, height))
        let size = CGSize(width: max(1, floor(width * factor)), height: max(1, floor(height * factor)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        format.preferredRange = .standard
        let thumbnail = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = thumbnail.jpegData(compressionQuality: 0.75), jpeg.count <= 2 * 1024 * 1024 else {
            throw FotosPhotoKitError.invalidThumbnail
        }
        let url = try temporaryURL(extension: "thumbnail.jpg")
        do {
            try jpeg.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return url.absoluteString
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    private func temporaryURL(extension filename: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fotos-photokit", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let suffix = (filename as NSString).pathExtension.lowercased()
        let safeSuffix = !suffix.isEmpty && suffix.count <= 10 && suffix.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) && $0.isASCII
        } ? suffix : "bin"
        return folder.appendingPathComponent(UUID().uuidString).appendingPathExtension(safeSuffix)
    }

    private func imageMetadata(_ url: URL) -> [String: Any]? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithURL(url as CFURL, options),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options) as? [String: Any] else { return nil }
        var result: [String: Any] = [:]
        for key in ["{TIFF}", "{Exif}", "{ExifAux}", "{GPS}", "Orientation", "PixelWidth", "PixelHeight"] {
            if let value = properties[key], let safe = jsonMetadata(value, depth: 0) { result[key] = safe }
        }
        return result.isEmpty ? nil : result
    }

    private func jsonMetadata(_ value: Any, depth: Int) -> Any? {
        guard depth < 8 else { return nil }
        if let value = value as? String { return String(value.prefix(4096)) }
        if let value = value as? NSNumber { return value.doubleValue.isFinite ? value : nil }
        if let values = value as? [Any] { return values.prefix(64).compactMap { jsonMetadata($0, depth: depth + 1) } }
        if let values = value as? [String: Any] {
            var result: [String: Any] = [:]
            for key in values.keys.sorted().prefix(256) {
                if let value = jsonMetadata(values[key]!, depth: depth + 1) { result[key] = value }
            }
            return result
        }
        return nil
    }
}

func isNetworkRequired(_ error: Error) -> Bool {
    var current: NSError? = error as NSError
    for _ in 0..<8 {
        guard let error = current else { return false }
        if error.domain == PHPhotosErrorDomain && error.code == PHPhotosError.networkAccessRequired.rawValue { return true }
        current = error.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return false
}
