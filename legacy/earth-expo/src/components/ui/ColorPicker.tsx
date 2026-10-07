/**
 * ============================================================================
 * ColorPicker.tsx — Inline Color Picker
 * ============================================================================
 *
 * A simple grid of preset colors + hex input for assigning country colors.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  TextInput,
  Text,
  StyleSheet,
} from 'react-native';

const PALETTE = [
  '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
  '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
  '#00897B', '#43A047', '#7CB342', '#C0CA33',
  '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  '#6D4C41', '#757575', '#546E7A', '#263238',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [hex, setHex] = useState(value);

  const handleHexSubmit = useCallback(() => {
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    }
  }, [hex, onChange]);

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {PALETTE.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.swatch,
              { backgroundColor: color },
              value === color && styles.selected,
            ]}
            onPress={() => {
              setHex(color);
              onChange(color);
            }}
          />
        ))}
      </View>

      <View style={styles.hexRow}>
        <View style={[styles.preview, { backgroundColor: hex }]} />
        <TextInput
          style={styles.hexInput}
          value={hex}
          onChangeText={setHex}
          onSubmitEditing={handleHexSubmit}
          placeholder="#RRGGBB"
          placeholderTextColor="#546E7A"
          maxLength={7}
          autoCapitalize="characters"
          returnKeyType="done"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: {
    borderColor: '#FFFFFF',
  },
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  preview: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  hexInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#ECEFF1',
    fontFamily: 'monospace',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#263238',
  },
});
