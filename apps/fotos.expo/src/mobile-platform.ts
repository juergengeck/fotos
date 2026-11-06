import { Platform } from 'react-native';

export type FotosMobileRuntimePlatform = 'ios' | 'android' | 'unknown';
export type FotosInstancePlatform =
  | FotosMobileRuntimePlatform
  | 'cube'
  | 'browser'
  | 'headless'
  | 'html'
  | 'fire';

export interface FotosPlatformCapabilities {
  currentPlatform: FotosMobileRuntimePlatform;
  platformLabel: string;
  supportsLocalNetworkDiscovery: boolean;
  supportsVerifiedPeerCollection: boolean;
  supportsPeerPairing: boolean;
  supportsUdpHandshake: boolean;
  supportsPhotoLibrarySync: boolean;
  supportsShareInbox: boolean;
  supportsLocalModels: boolean;
  supportsLocalMLX: boolean;
}

export interface FotosPlatformDefaults {
  storageDirectory: string;
  localDeviceType: string;
  localInstancePlatform: FotosInstancePlatform;
  defaultDeviceDisplayName: string;
  defaultInstanceName: string;
  appLabel: string;
}

function getCurrentPlatform(): FotosMobileRuntimePlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }

  if (Platform.OS === 'android') {
    return 'android';
  }

  return 'unknown';
}

export function getFotosPlatformCapabilities(): FotosPlatformCapabilities {
  const currentPlatform = getCurrentPlatform();

  if (currentPlatform === 'ios') {
    return {
      currentPlatform,
      platformLabel: 'iOS',
      supportsLocalNetworkDiscovery: true,
      supportsVerifiedPeerCollection: true,
      supportsPeerPairing: true,
      supportsUdpHandshake: true,
      supportsPhotoLibrarySync: true,
      supportsShareInbox: true,
      supportsLocalModels: true,
      supportsLocalMLX: true,
    };
  }

  if (currentPlatform === 'android') {
    // Keep Android conservative until the native discovery, transport,
    // media-library ingest, and local-model paths are verified end to end.
    return {
      currentPlatform,
      platformLabel: 'Android',
      supportsLocalNetworkDiscovery: false,
      supportsVerifiedPeerCollection: false,
      supportsPeerPairing: false,
      supportsUdpHandshake: false,
      supportsPhotoLibrarySync: false,
      supportsShareInbox: false,
      supportsLocalModels: false,
      supportsLocalMLX: false,
    };
  }

  return {
    currentPlatform,
    platformLabel: 'Mobile',
    supportsLocalNetworkDiscovery: false,
    supportsVerifiedPeerCollection: false,
    supportsPeerPairing: false,
    supportsUdpHandshake: false,
    supportsPhotoLibrarySync: false,
    supportsShareInbox: false,
    supportsLocalModels: false,
    supportsLocalMLX: false,
  };
}

export function getFotosPlatformDefaults(): FotosPlatformDefaults {
  const capabilities = getFotosPlatformCapabilities();

  if (capabilities.currentPlatform === 'ios') {
    return {
      storageDirectory: 'fotos.ios.storage',
      localDeviceType: 'ios',
      localInstancePlatform: 'ios',
      defaultDeviceDisplayName: 'fotos iOS',
      defaultInstanceName: 'fotos-ios',
      appLabel: 'fotos iOS',
    };
  }

  if (capabilities.currentPlatform === 'android') {
    return {
      storageDirectory: 'fotos.android.storage',
      localDeviceType: 'android',
      localInstancePlatform: 'android',
      defaultDeviceDisplayName: 'fotos Android',
      defaultInstanceName: 'fotos-android',
      appLabel: 'fotos Android',
    };
  }

  return {
    storageDirectory: 'fotos.mobile.storage',
    localDeviceType: 'mobile',
    localInstancePlatform: 'unknown',
    defaultDeviceDisplayName: 'fotos Mobile',
    defaultInstanceName: 'fotos-mobile',
    appLabel: 'fotos Mobile',
  };
}
