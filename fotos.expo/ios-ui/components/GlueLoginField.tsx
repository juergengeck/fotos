import React, {type ReactNode} from 'react';
import {ActivityIndicator, Image, Pressable, View} from 'react-native';
import glueoneIcon from '../../assets/glueone-icon.png';

/** Keep Glue sign-in beside the login identity it uses as browser prefill. */
export function GlueLoginField({children, busy, disabled, onPress}: {
  children: ReactNode; busy: boolean; disabled: boolean; onPress(): void;
}) {
  return (
    <View testID="expo-login-identity-row" style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <View style={{flex: 1}}>{children}</View>
      <Pressable testID="expo-glue-login" accessibilityRole="button" accessibilityLabel="Sign in with glue.one"
        accessibilityState={{busy, disabled}} disabled={disabled} onPress={onPress}
        style={{width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.6 : 1}}>
        {busy ? (
          <ActivityIndicator color="#4d6fc6" />
        ) : (
          <Image
            source={glueoneIcon}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{width: 48, height: 48}}
            resizeMode="contain"
          />
        )}
      </Pressable>
    </View>
  );
}
