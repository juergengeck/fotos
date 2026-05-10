/**
 * TabScreenLayout - Consistent layout for tab screens with transparent headers
 *
 * Handles:
 * - Dynamic safe area insets
 * - Transparent header offset (large title style)
 * - Theme-aware background colors
 * - Bottom tab bar spacing
 */

import { View, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';

// Large title header height on iOS (status bar + navigation bar with large title)
// This matches the 96pt used in ChatLayout.native.tsx
const HEADER_HEIGHT = Platform.OS === 'ios' ? 96 : 56;

// Tab bar height (matches tabs layout)
const TAB_BAR_HEIGHT = 60;

export interface TabScreenLayoutProps {
  children: ReactNode;
  /** Use ScrollView wrapper (default: false) */
  scrollable?: boolean;
  /** Additional top padding beyond header */
  extraTopPadding?: number;
  /** Custom background color class (default: bg-gray-50 dark:bg-gray-900) */
  backgroundClass?: string;
  /** Disable bottom padding for tab bar */
  noBottomPadding?: boolean;
}

export function TabScreenLayout({
  children,
  scrollable = false,
  extraTopPadding = 0,
  backgroundClass = 'bg-gray-50 dark:bg-gray-900',
  noBottomPadding = false,
}: TabScreenLayoutProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();

  const topPadding = HEADER_HEIGHT + extraTopPadding;
  const bottomPadding = noBottomPadding ? 0 : TAB_BAR_HEIGHT + insets.bottom;

  if (scrollable) {
    return (
      <ScrollView
        className={`flex-1 ${backgroundClass}`}
        contentInset={{ top: topPadding, bottom: bottomPadding }}
        contentOffset={{ x: 0, y: -topPadding }}
        scrollIndicatorInsets={{ top: topPadding, bottom: bottomPadding }}
        contentInsetAdjustmentBehavior="never"
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View className={`flex-1 ${backgroundClass}`}>
      <View style={{ paddingTop: topPadding, flex: 1, paddingBottom: bottomPadding }}>
        {children}
      </View>
    </View>
  );
}

// Export constants for screens that need custom handling
export { HEADER_HEIGHT, TAB_BAR_HEIGHT };
