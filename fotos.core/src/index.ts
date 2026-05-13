export type {
    BBox,
    FaceDetection,
    FaceResult,
    FaceAnalysisResult,
    ImagePixels,
    ImageProcessor,
    OnnxSession,
    OnnxTensor,
    OnnxRuntime,
    FacePlatform,
} from './types.js';

export type {FaceClusterInfo, FaceExportData} from './faces.js';
export type {
    GallerySurface,
    GallerySurfaceRole,
    GallerySourceKind,
    GalleryIntakeMode,
    FaceEnrichmentMode,
    GallerySurfaceProfile,
    GallerySourceCapabilities,
    GalleryIntakePlan,
} from './gallery-intake.js';
export type {
    GalleryTrieSlot,
    GalleryBrowseSlot,
    GalleryProjectionSlot,
    GalleryIndexEntry,
    GalleryTimelineDay,
    GalleryFacetCount,
} from './gallery-trie.js';
export type {
    FotosStream,
    FotosCatalogEntry,
    FotosCatalogExif,
    FotosCatalog,
    FotosCatalogV1,
    FotosCatalogV2,
    FotosCatalogConfig,
    FotosCatalogFilter,
} from './fotos-catalog.js';
export type {FotosCatalogTrieSnapshot} from './fotos-catalog-trie.js';
export type {FotosBundleManifest} from './fotos-bundle.js';
export type {
    FotosServiceMethod,
    FotosServiceChannel,
    FotosManagedMode,
    FotosServiceManagedMode,
    FotosIngestState,
    FotosBinaryResourceKind,
    FotosServiceFaceData,
    FotosFolderMetadata,
    FotosServiceEntry,
    FotosDecodedFaceData,
    FotosIngestStatus,
    FotosServiceStatusData,
    FotosServiceBrowseParams,
    FotosServiceBrowseData,
    FotosServiceFoldersParams,
    FotosServiceFoldersData,
    FotosServiceSuccess,
    FotosServiceFailure,
    FotosServiceResult,
    FotosServiceParamsByMethod,
    FotosServiceDataByMethod,
    FotosServiceResultByMethod,
    FotosServiceTransport,
} from './service-contract.js';

export {
    DET_INPUT_SIZE,
    REC_INPUT_SIZE,
    EMBEDDING_DIM,
    setPlatform,
    initFaceDetectionModel,
    initFaceRecognitionModel,
    initFaceModels,
    disposeFaceModels,
    detectFaces,
    computeEmbedding,
    analyzeImage,
    iou,
    nms,
    l2Normalize,
    cosineSimilarity,
    facesToDataAttrs,
    dataAttrsToFaces,
    dataAttrsToFaceExport,
    hwcToCHW_det,
    hwcToCHW_rec,
} from './faces.js';
export {
    getGallerySurfaceProfile,
    getGallerySourceCapabilities,
    planGalleryIntake,
} from './gallery-intake.js';
export {
    FOTOS_SERVICE_METHODS,
    isFotosServiceMethod,
    isFotosServiceChannel,
    toFotosServiceChannel,
    parseFotosServiceChannel,
    normalizeFotosServiceManagedMode,
    decodeFotosServiceFaceData,
    buildFotosBinaryUrl,
    invokeFotosService,
} from './service-contract.js';
export {GalleryTrieManager} from './gallery-trie.js';
export {
    isJpeg,
    stripJpegMetadata,
    normalizeImageBytesForContentHash,
} from './content-hash.js';
export {
    DEFAULT_FOTOS_CONFIG,
    filterFotosCatalogEntries,
    listFotosTags,
    listFotosPeople,
    listFotosFaceGroups,
} from './fotos-catalog.js';
export {FotosCatalogTrie} from './fotos-catalog-trie.js';
export {FOTOS_BUNDLE_MANIFEST, createFotosBundleManifest} from './fotos-bundle.js';
export {
    makeFotosDeviceBookId,
    buildFotosDeviceBookTitle,
    createFotosDeviceBook,
    updateFotosDeviceBookContent,
    getFotosDeviceBookIdHash,
    readFotosDeviceBook,
    ensureFotosDeviceBook,
    appendFotosDeviceBookContent,
} from './fotos-device-book.js';
export type {
    CreateFotosDeviceBookParams,
    UpdateFotosDeviceBookContentParams,
    FotosDeviceBookPersistenceDeps,
    EnsureFotosDeviceBookParams,
    AppendFotosDeviceBookContentParams,
} from './fotos-device-book.js';
export {
    buildFotosMediaLocatorId,
    createFotosMediaLocator,
    createFotosMediaVariant,
} from './media-model.js';
export type {
    BuildFotosMediaLocatorIdParams,
    CreateFotosMediaLocatorParams,
    CreateFotosMediaVariantParams,
} from './media-model.js';

export {FaceClusterDimension} from './FaceClusterDimension.js';
export type {FaceCluster, ClusterMember, ClusterMatch} from './FaceClusterDimension.js';

export {
    FOTOS_AUTHENTICITY_SCHEME,
    FotosRecipes,
    FotosEntryRecipe,
    FotosManifestRecipe,
    FotosAuthenticityAttestationRecipe,
} from './recipes/FotosRecipes.js';
export type {
    FotosEntry,
    FotosManifest,
    FotosAuthenticityAttestation,
} from './recipes/FotosRecipes.js';
export {
    FOTOS_DEVICE_BOOK_ROLES,
    isFotosDeviceBookRole,
    FotosDeviceBookRecipes,
    FotosDeviceBookRecipe,
} from './recipes/FotosDeviceBookRecipes.js';
export type {
    FotosDeviceBookRole,
    FotosDeviceBook,
} from './recipes/FotosDeviceBookRecipes.js';
export {
    FOTOS_MEDIA_VARIANT_ROLES,
    FOTOS_MEDIA_LOCATOR_PLATFORMS,
    FOTOS_MEDIA_LOCATOR_KINDS,
    FOTOS_MEDIA_LOCATOR_SCOPES,
    isFotosMediaVariantRole,
    isFotosMediaLocatorPlatform,
    isFotosMediaLocatorKind,
    isFotosMediaLocatorScope,
    FotosMediaRecipes,
    FotosMediaVariantRecipe,
    FotosMediaLocatorRecipe,
} from './recipes/FotosMediaRecipes.js';
export type {
    FotosMediaVariantRole,
    FotosMediaLocatorPlatform,
    FotosMediaLocatorKind,
    FotosMediaLocatorScope,
    FotosMediaVariant,
    FotosMediaLocator,
} from './recipes/FotosMediaRecipes.js';
export {
    GalleryTrieRecipes,
    GalleryCaptureTrieNodeRecipe,
    GalleryCaptureTrieRootRecipe,
    GalleryUpdatedTrieNodeRecipe,
    GalleryUpdatedTrieRootRecipe,
    GalleryFolderTrieNodeRecipe,
    GalleryFolderTrieRootRecipe,
    GalleryTagTrieNodeRecipe,
    GalleryTagTrieRootRecipe,
    GalleryPersonTrieNodeRecipe,
    GalleryPersonTrieRootRecipe,
    GalleryFaceGroupTrieNodeRecipe,
    GalleryFaceGroupTrieRootRecipe,
    GalleryDetectedFaceTrieNodeRecipe,
    GalleryDetectedFaceTrieRootRecipe,
} from './recipes/GalleryTrieRecipes.js';
