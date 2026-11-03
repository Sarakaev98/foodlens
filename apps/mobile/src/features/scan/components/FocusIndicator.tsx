import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

const SIZE = 76;
const SHOW_MS = 180;
const HOLD_MS = 700;
const HIDE_MS = 250;

/** Кольцо фокуса: появляется при каждом новом pulse. Фокусировка идёт по всему кадру, поэтому кольцо в центре. */
export function FocusIndicator({ pulse }: { readonly pulse: number }) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(1.4));

  useEffect(() => {
    if (pulse === 0) return;
    opacity.setValue(1);
    scale.setValue(1.4);
    const animation = Animated.sequence([
      Animated.timing(scale, { toValue: 1, duration: SHOW_MS, useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: HIDE_MS, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [pulse, opacity, scale]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View style={[styles.ring, { opacity, transform: [{ scale }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingBottom: 140 },
  ring: { width: SIZE, height: SIZE, borderRadius: 14, borderWidth: 2, borderColor: '#FDE68A' },
});
