export const palette = {
  accent: '#17825f',
  accentSoft: '#dff4ec',
  accentStrong: '#0d6a4c',
  background: '#f4f5f2',
  surface: '#ffffff',
  surfaceMuted: '#eef1ec',
  text: '#171717',
  textMuted: '#5f655f',
  border: '#d7ddd6',
  danger: '#b84a2c',
  warning: '#b46c11',
  info: '#2d6aa1',
  darkBackground: '#121212',
  darkSurface: '#1d1d1d',
  darkSurfaceMuted: '#282828',
  darkText: '#f5f5f5',
  darkTextMuted: '#b8bcb7',
  darkBorder: '#363a36',
};

export function screenBackground(isDark: boolean): string {
  return isDark ? palette.darkBackground : palette.background;
}

export function cardBackground(isDark: boolean): string {
  return isDark ? palette.darkSurface : palette.surface;
}

export function mutedCardBackground(isDark: boolean): string {
  return isDark ? palette.darkSurfaceMuted : palette.surfaceMuted;
}

export function borderColor(isDark: boolean): string {
  return isDark ? palette.darkBorder : palette.border;
}

export function textColor(isDark: boolean): string {
  return isDark ? palette.darkText : palette.text;
}

export function mutedTextColor(isDark: boolean): string {
  return isDark ? palette.darkTextMuted : palette.textMuted;
}
