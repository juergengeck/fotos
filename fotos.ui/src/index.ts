export type {
    StorageMode,
    FaceInfo,
    SemanticInfo,
    PhotoEntry,
    ExifData,
    FotosSettings,
    StorageSettings,
    DeviceSettings,
    DisplaySettings,
    AnalysisSettings,
} from './types/fotos.js';
export {DEFAULT_SETTINGS} from './types/fotos.js';

export type {DayGroup, GalleryFilterOptions} from './lib/gallery.js';
export {
    photoDate,
    groupPhotosByDay,
    flattenDayGroups,
    collectTagCounts,
    filterGalleryPhotos,
} from './lib/gallery.js';
export type {PhotoGridProps} from './components/PhotoGrid.js';
export {PhotoGrid} from './components/PhotoGrid.js';
export type {SettingsStorage} from './lib/settings.js';
export {
    DEFAULT_SETTINGS_STORAGE_KEY,
    mergeFotosSettings,
    loadFotosSettings,
    saveFotosSettings,
} from './lib/settings.js';
export {useFotosSettings} from './hooks/useFotosSettings.js';
export type {
    GalleryAccessSource,
    UseFotosGalleryStateOptions,
} from './hooks/useFotosGalleryState.js';
export {useFotosGalleryState} from './hooks/useFotosGalleryState.js';
