import ExpoModulesCore

public final class FotosPhotoKitModule: Module {
    private let library = FotosPhotoKitLibrary()

    public func definition() -> ModuleDefinition {
        Name("FotosPhotoKit")
        Events("onLibraryChange")

        View(FotosPhotoKitImageView.self) {
            Prop("assetId") { (view: FotosPhotoKitImageView, id: String?) in view.assetId = id ?? "" }
            Prop("resizeMode") { (view: FotosPhotoKitImageView, mode: String?) in view.resizeMode = mode ?? "cover" }
            Prop("allowNetworkAccess") { (view: FotosPhotoKitImageView, allowed: Bool?) in
                view.allowNetworkAccess = allowed ?? false
            }
        }

        AsyncFunction("listAssets") { (offset: Int, limit: Int, cursor: String?) throws -> [String: Any] in
            try self.library.listAssets(offset: offset, limit: limit, cursor: cursor)
        }
        AsyncFunction("inspectOriginal") { (id: String, allowNetworkAccess: Bool) async throws -> [String: Any] in
            try await self.library.inspectOriginal(id: id, allowNetworkAccess: allowNetworkAccess)
        }
        AsyncFunction("thumbnailFile") { (id: String, maxEdge: Int, allowNetworkAccess: Bool) async throws -> String? in
            try await self.library.thumbnailFile(id: id, maxEdge: maxEdge, allowNetworkAccess: allowNetworkAccess)
        }
        AsyncFunction("originalFile") { (id: String, allowNetworkAccess: Bool) async throws -> String in
            try await self.library.originalFile(id: id, allowNetworkAccess: allowNetworkAccess)
        }
        AsyncFunction("listAlbums") { (offset: Int, limit: Int, cursor: String?) throws -> [String: Any] in
            try self.library.listAlbums(offset: offset, limit: limit, cursor: cursor)
        }
        AsyncFunction("listAlbumMembers") { (id: String, offset: Int, limit: Int, cursor: String?) throws -> [String: Any] in
            try self.library.listAlbumMembers(id: id, offset: offset, limit: limit, cursor: cursor)
        }
        AsyncFunction("releaseCursor") { (id: String) in self.library.releaseCursor(id: id) }
        OnStartObserving {
            self.library.observer.start { [weak self] event in
                self?.sendEvent("onLibraryChange", event)
            }
        }
        OnStopObserving { self.library.observer.stop() }
        OnDestroy { self.library.observer.stop() }
    }
}
