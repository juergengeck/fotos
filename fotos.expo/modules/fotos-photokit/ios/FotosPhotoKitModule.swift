import ExpoModulesCore

public final class FotosPhotoKitModule: Module {
    private let library = FotosPhotoKitLibrary()

    public func definition() -> ModuleDefinition {
        Name("FotosPhotoKit")
        Events("onLibraryChange")

        AsyncFunction("listAssets") { (offset: Int, limit: Int) throws -> [String: Any] in
            try self.library.listAssets(offset: offset, limit: limit)
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
        AsyncFunction("listAlbums") { (offset: Int, limit: Int) throws -> [String: Any] in
            try self.library.listAlbums(offset: offset, limit: limit)
        }
        AsyncFunction("listAlbumMembers") { (id: String, offset: Int, limit: Int) throws -> [String: Any] in
            try self.library.listAlbumMembers(id: id, offset: offset, limit: limit)
        }
        OnStartObserving {
            self.library.observer.start { [weak self] event in
                self?.sendEvent("onLibraryChange", event)
            }
        }
        OnStopObserving { self.library.observer.stop() }
        OnDestroy { self.library.observer.stop() }
    }
}
