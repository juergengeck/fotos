import type {
  ScrollViewPropsAndroid,
  ScrollViewPropsIOS,
  Touchable,
  VirtualizedListProps,
} from 'react-native';

declare module '@react-native/virtualized-lists' {
  export interface VirtualizedListWithoutRenderItemProps<ItemT>
    extends ScrollViewProps {
    ListFooterComponentClassName?: string;
    ListHeaderComponentClassName?: string;
  }
}

declare module 'react-native' {
  interface ImagePropsBase {
    className?: string;
    cssInterop?: boolean;
  }

  interface ViewProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface TextProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface TextInputProps {
    className?: string;
    placeholderClassName?: string;
    cssInterop?: boolean;
  }

  interface ScrollViewProps
    extends ViewProps,
      ScrollViewPropsIOS,
      ScrollViewPropsAndroid,
      Touchable {
    contentContainerClassName?: string;
    indicatorClassName?: string;
  }

  interface FlatListProps<ItemT> extends VirtualizedListProps<ItemT> {
    columnWrapperClassName?: string;
  }

  interface ImageBackgroundProps extends ImagePropsBase {
    imageClassName?: string;
  }

  interface SwitchProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface InputAccessoryViewProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface TouchableWithoutFeedbackProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface PressableProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface StatusBarProps {
    className?: string;
    cssInterop?: boolean;
  }

  interface KeyboardAvoidingViewProps extends ViewProps {
    contentContainerClassName?: string;
  }

  interface ModalBaseProps {
    presentationClassName?: string;
  }
}
