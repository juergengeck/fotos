const {
  withInfoPlist,
  withAndroidManifest,
  createRunOncePlugin,
} = require('@expo/config-plugins');

/**
 * Expo config plugin for react-native-ble-plx
 * Ensures proper permissions and configuration for BLE functionality
 */

// iOS Configuration
const withBLEInfoPlist = (config) => {
  return withInfoPlist(config, (config) => {
    // Add iOS Bluetooth permissions
    config.modResults.NSBluetoothAlwaysUsageDescription =
      config.modResults.NSBluetoothAlwaysUsageDescription ||
      'This app uses Bluetooth to discover and connect to nearby devices for local data exchange.';

    config.modResults.NSBluetoothPeripheralUsageDescription =
      config.modResults.NSBluetoothPeripheralUsageDescription ||
      'This app uses Bluetooth to discover and connect to nearby devices for local data exchange.';

    // Add background modes for BLE if needed
    const backgroundModes = config.modResults.UIBackgroundModes || [];
    if (!backgroundModes.includes('bluetooth-central')) {
      backgroundModes.push('bluetooth-central');
    }
    if (!backgroundModes.includes('bluetooth-peripheral')) {
      backgroundModes.push('bluetooth-peripheral');
    }
    config.modResults.UIBackgroundModes = backgroundModes;

    return config;
  });
};

// Android Configuration
const withBLEAndroidManifest = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Add required permissions for BLE
    const permissions = androidManifest.manifest['uses-permission'] || [];

    const requiredPermissions = [
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    ];

    // Add permissions if they don't exist
    requiredPermissions.forEach((permission) => {
      const hasPermission = permissions.find(
        (perm) => perm.$['android:name'] === permission
      );

      if (!hasPermission) {
        permissions.push({
          $: {
            'android:name': permission,
          },
        });
      }
    });

    // Add special attributes for Android 12+ permissions
    const bluetoothScanPermission = permissions.find(
      (perm) => perm.$['android:name'] === 'android.permission.BLUETOOTH_SCAN'
    );
    if (bluetoothScanPermission && !bluetoothScanPermission.$['android:usesPermissionFlags']) {
      bluetoothScanPermission.$['android:usesPermissionFlags'] = 'neverForLocation';
    }

    // Add uses-feature for BLE
    const features = androidManifest.manifest['uses-feature'] || [];
    const hasBLEFeature = features.find(
      (feature) => feature.$['android:name'] === 'android.hardware.bluetooth_le'
    );

    if (!hasBLEFeature) {
      features.push({
        $: {
          'android:name': 'android.hardware.bluetooth_le',
          'android:required': 'true',
        },
      });
    }

    androidManifest.manifest['uses-permission'] = permissions;
    androidManifest.manifest['uses-feature'] = features;

    // Ensure min SDK version is at least 21 for BLE support
    const usesSdk = androidManifest.manifest['uses-sdk'];
    if (usesSdk && usesSdk[0]) {
      const minSdk = parseInt(usesSdk[0].$['android:minSdkVersion'] || '21', 10);
      if (minSdk < 21) {
        usesSdk[0].$['android:minSdkVersion'] = '21';
      }
    }

    return config;
  });
};

// Main plugin function
const withBLEPermissions = (config) => {
  config = withBLEInfoPlist(config);
  config = withBLEAndroidManifest(config);

  return config;
};

module.exports = createRunOncePlugin(
  withBLEPermissions,
  'react-native-ble-plx-permissions',
  '1.0.0'
);
