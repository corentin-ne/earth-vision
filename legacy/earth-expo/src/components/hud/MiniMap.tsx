/**
 * ============================================================================
 * MiniMap.tsx — 2D Mini-Map Overlay (Placeholder)
 * ============================================================================
 *
 * Displays a small 2D equirectangular projection of the globe with a
 * viewport indicator. Currently a placeholder — will be implemented
 * with react-native-svg in a future iteration.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function MiniMap() {
  // Placeholder: shows a dark rectangle where the minimap will be
  return (
    <View style={styles.container}>
      <View style={styles.map}>
        <Text style={styles.placeholder}>🌍</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 180,
    right: 16,
  },
  map: {
    width: 80,
    height: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#263238',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    fontSize: 20,
    opacity: 0.4,
  },
});
