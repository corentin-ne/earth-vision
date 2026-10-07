/**
 * ============================================================================
 * WorldNameBadge.tsx — HUD World Name Display
 * ============================================================================
 *
 * Displays the user's world name at the top of the screen.
 * Tappable to open settings.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useWorldStore } from '../../store/useWorldStore';
import { SettingsModal } from '../ui/SettingsModal';

export function WorldNameBadge() {
  const worldName = useWorldStore((s) => s.settings.worldName);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.badge}
          onPress={() => setShowSettings(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.name}>{worldName}</Text>
          <Text style={styles.gear}>⚙</Text>
        </TouchableOpacity>
      </View>

      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ECEFF1',
    letterSpacing: 0.5,
  },
  gear: {
    fontSize: 16,
    color: '#78909C',
  },
});
