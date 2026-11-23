import Foundation
import Photos
import UIKit

/// Snapshots are confined to one queue. Keep per-album fetch results so a
/// membership-only edit emits an event even when the global asset set is stable.
final class FotosPhotoKitObserver: NSObject, PHPhotoLibraryChangeObserver {
    private let queue = DispatchQueue(label: "one.fotos.photokit.observer")
    private var handler: (([String: Any]) -> Void)?
    private var registered = false
    private var foregroundObserver: NSObjectProtocol?
    private var authorization: PHAuthorizationStatus?
    private var assets: PHFetchResult<PHAsset>?
    private var userAlbums: PHFetchResult<PHAssetCollection>?
    private var smartAlbums: PHFetchResult<PHAssetCollection>?
    private var members: [String: PHFetchResult<PHAsset>] = [:]

    func start(_ handler: @escaping ([String: Any]) -> Void) {
        queue.sync {
            self.handler = handler
            if foregroundObserver == nil {
                foregroundObserver = NotificationCenter.default.addObserver(
                    forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil
                ) { [weak self] _ in
                    self?.queue.async { [weak self] in self?.refreshAuthorization(sendReload: true) }
                }
            }
            refreshAuthorization(sendReload: false)
        }
    }

    func stop() {
        queue.sync {
            handler = nil
            if let observer = foregroundObserver { NotificationCenter.default.removeObserver(observer) }
            foregroundObserver = nil
            if registered { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
            registered = false
            authorization = nil
            clearSnapshots()
        }
    }

    private func clearSnapshots() {
        assets = nil
        userAlbums = nil
        smartAlbums = nil
        members.removeAll()
    }

    private func refreshAuthorization(sendReload: Bool) {
        guard handler != nil else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status != authorization else { return }
        let previous = authorization
        authorization = status
        clearSnapshots()
        if status == .authorized || status == .limited {
            if !registered { PHPhotoLibrary.shared().register(self); registered = true }
            assets = FotosPhotoKitLibrary.fetchAssets()
            userAlbums = FotosPhotoKitLibrary.fetchAlbums(.album)
            smartAlbums = FotosPhotoKitLibrary.fetchAlbums(.smartAlbum)
            reconcileAlbumSnapshots()
        } else if registered {
            PHPhotoLibrary.shared().unregisterChangeObserver(self)
            registered = false
        }
        if sendReload && previous != status {
            emit(inserted: [], changed: [], removed: [], albumsChanged: true, requiresReload: true)
        }
    }

    private func reconcileAlbumSnapshots() {
        var ids: Set<String> = []
        for albums in [userAlbums, smartAlbums] {
            albums?.enumerateObjects { album, _, _ in
                let id = album.localIdentifier
                ids.insert(id)
                if self.members[id] == nil { self.members[id] = FotosPhotoKitLibrary.fetchAssets(in: album) }
            }
        }
        members = members.filter { ids.contains($0.key) }
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        queue.async { [weak self] in self?.apply(changeInstance) }
    }

    private func apply(_ change: PHChange) {
        guard handler != nil else { return }
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == authorization else {
            refreshAuthorization(sendReload: true)
            return
        }
        var inserted: [String] = [], changed: [String] = [], removed: [String] = []
        var requiresReload = false
        var albumsChanged = false
        if let before = assets, let details = change.changeDetails(for: before) {
            assets = details.fetchResultAfterChanges
            if details.hasIncrementalChanges {
                inserted = details.insertedObjects.map(\.localIdentifier)
                changed = details.changedObjects.map(\.localIdentifier)
                removed = details.removedObjects.map(\.localIdentifier)
            } else {
                requiresReload = true
            }
        }
        if let before = userAlbums, let details = change.changeDetails(for: before) {
            userAlbums = details.fetchResultAfterChanges
            albumsChanged = true
        }
        if let before = smartAlbums, let details = change.changeDetails(for: before) {
            smartAlbums = details.fetchResultAfterChanges
            albumsChanged = true
        }
        for (id, before) in members {
            if let details = change.changeDetails(for: before) {
                members[id] = details.fetchResultAfterChanges
                let membershipChanged = !details.hasIncrementalChanges || details.hasMoves
                    || !details.insertedObjects.isEmpty || !details.removedObjects.isEmpty
                albumsChanged = albumsChanged || membershipChanged
            }
        }
        if albumsChanged { reconcileAlbumSnapshots() }
        if !inserted.isEmpty || !changed.isEmpty || !removed.isEmpty || albumsChanged || requiresReload {
            emit(inserted: inserted, changed: changed, removed: removed,
                albumsChanged: albumsChanged, requiresReload: requiresReload)
        }
    }

    private func emit(inserted: [String], changed: [String], removed: [String], albumsChanged: Bool, requiresReload: Bool) {
        handler?(["inserted": Array(Set(inserted)).sorted(), "changed": Array(Set(changed)).sorted(),
            "removed": Array(Set(removed)).sorted(), "albumsChanged": albumsChanged, "requiresReload": requiresReload])
    }

    deinit {
        if registered { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
        if let observer = foregroundObserver { NotificationCenter.default.removeObserver(observer) }
    }
}
