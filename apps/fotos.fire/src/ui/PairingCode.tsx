import React, {useMemo} from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {create} from 'qrcode';
import Svg, {Path, Rect} from 'react-native-svg';

export function PairingCode({url, size}: {url: string; size: number}) {
  const qr = useMemo(() => {
    try {
      const {modules} = create(url, {errorCorrectionLevel: 'M'});
      const paths: string[] = [];
      for (let row = 0; row < modules.size; row += 1) {
        for (let column = 0; column < modules.size; column += 1) {
          if (modules.get(row, column)) paths.push(`M${column + 4},${row + 4}h1v1h-1z`);
        }
      }
      return {path: paths.join(''), size: modules.size + 8};
    } catch {
      return null;
    }
  }, [url]);

  if (!qr) {
    return <View style={[styles.fallback, {width: size, height: size}]}>
      <Text style={styles.fallbackText}>Open the invitation link below on your Fotos device.</Text>
    </View>;
  }

  return <Svg width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} accessibilityLabel="Fotos device pairing QR code">
    <Rect width={qr.size} height={qr.size} fill="#ffffff" />
    <Path d={qr.path} fill="#111821" />
  </Svg>;
}

const styles = StyleSheet.create({
  fallback: {backgroundColor: '#ffffff', justifyContent: 'center', padding: 24},
  fallbackText: {color: '#111821', fontSize: 18, textAlign: 'center'},
});
