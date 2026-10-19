import React, {type ReactNode} from 'react';
import {ActivityIndicator, Pressable, Text, View} from 'react-native';

/** Keep Glue sign-in beside the login identity it uses as browser prefill. */
export function GlueLoginField({children, busy, disabled, onPress}: {
  children: ReactNode; busy: boolean; disabled: boolean; onPress(): void;
}) {
  return (
    <View testID="expo-login-identity-row" style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <View style={{flex: 1}}>{children}</View>
      <Pressable testID="expo-glue-login" accessibilityRole="button" accessibilityLabel="Sign in with glue.one"
        accessibilityState={{busy, disabled}} disabled={disabled} onPress={onPress}
        style={{minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#a74b19',
          alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.6 : 1}}>
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={{color: '#ffffff', fontWeight: '700'}}>glue.one</Text>}
      </Pressable>
    </View>
  );
}
