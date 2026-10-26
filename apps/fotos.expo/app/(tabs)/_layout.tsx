import { Tabs } from 'expo-router';
import { Activity, Camera, Network, Settings2 } from 'lucide-react-native';
import { useColorScheme } from 'react-native';
import { palette } from '../../src/theme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        lazy: true,
        headerTitleStyle: {
          fontSize: 17,
          fontWeight: '700',
          color: isDark ? palette.darkText : palette.text,
        },
        headerStyle: {
          backgroundColor: isDark ? palette.darkSurface : palette.surface,
        },
        headerShadowVisible: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: isDark ? palette.darkTextMuted : palette.textMuted,
        tabBarStyle: {
          backgroundColor: isDark ? palette.darkSurface : palette.surface,
          borderTopColor: isDark ? palette.darkBorder : palette.border,
        },
      }}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          title: 'Devices',
          tabBarIcon: ({ color, size }) => <Network color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="runtime"
        options={{
          title: 'Runtime',
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings2 color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
