// Type declarations for Expo modules without bundled types

declare module '@expo/vector-icons' {
  import { ComponentType } from 'react';
  import { TextStyle } from 'react-native';

  interface IconProps {
    name: string;
    size?: number;
    color?: string;
    style?: TextStyle;
  }

  export const Ionicons: ComponentType<IconProps>;
  export const MaterialIcons: ComponentType<IconProps>;
  export const FontAwesome: ComponentType<IconProps>;
  export const Feather: ComponentType<IconProps>;
}

declare module 'expo-file-system/next' {
  export const Paths: {
    document: string;
    cache: string;
    appleSharedContainers: Record<string, string>;
  };

  export class Directory {
    constructor(path: string | Directory, subpath?: string);
    readonly exists: boolean;
    readonly uri: string;
    readonly name: string;
    create(): void;
    delete(): void;
    list(): Array<Directory | File>;
  }

  export class File {
    constructor(path: string | Directory, name?: string);
    readonly exists: boolean;
    readonly size: number;
    readonly uri: string;
    readonly name: string;
    text(): Promise<string>;
    write(content: string): Promise<void>;
    delete(): void;
    copy(destination: string | Directory): void;
    move(destination: string | Directory): void;
  }
}

declare module 'expo-file-system/legacy' {
  export interface DownloadProgressData {
    totalBytesWritten: number;
    totalBytesExpectedToWrite: number;
  }

  export interface DownloadResult {
    uri: string;
    status: number;
  }

  export interface DownloadResumable {
    downloadAsync(): Promise<DownloadResult | undefined>;
  }

  export function createDownloadResumable(
    uri: string,
    fileUri: string,
    options?: Record<string, unknown>,
    callback?: (progress: DownloadProgressData) => void
  ): DownloadResumable;
}
