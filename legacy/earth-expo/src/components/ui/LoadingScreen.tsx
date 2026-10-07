/**
 * ============================================================================
 * LoadingScreen.tsx — Suspense Fallback (Globe Loading State)
 * ============================================================================
 *
 * A sleek loading screen displayed while the heavy Globe component,
 * TopoJSON parsing, and Three.js initialization are being lazy-loaded.
 *
 * Design:
 *   - Dark theme matching the globe background (#0D1117)
 *   - Pulsing globe emoji + activity indicator
 *   - Shown via React.Suspense while Globe chunk is loading
 *   - Also reused as the initial splash loading indicator
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface LoadingScreenProps {
  /** Optional message below the spinner. */
  message?: string;
}

export function LoadingScreen({ message = 'Loading world…' }: LoadingScreenProps) {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.globe, { opacity: pulseAnim }]}>
        🌍
      </Animated.Text>
      <Text style={styles.title}>My World</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.dotRow}>
        <PulseDot delay={0} />
        <PulseDot delay={200} />
        <PulseDot delay={400} />
      </View>
    </View>
  );
}

/** Individual pulsing dot for the loading indicator. */
function PulseDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          toValue: 1.0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  globe: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#E6EDF3',
    marginBottom: 8,
    letterSpacing: 1,
  },
  message: {
    fontSize: 15,
    color: '#8B949E',
    marginBottom: 24,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4FC3F7',
  },
});
