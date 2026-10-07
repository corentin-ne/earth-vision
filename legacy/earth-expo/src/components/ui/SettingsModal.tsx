/**
 * ============================================================================
 * SettingsModal.tsx — Global Settings Editor
 * ============================================================================
 *
 * Modal overlay for editing WorldSettings (world name, colors, toggles).
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  Modal,
} from 'react-native';
import { useWorldStore } from '../../store/useWorldStore';
import { ColorPicker } from './ColorPicker';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const settings = useWorldStore((s) => s.settings);
  const updateSettings = useWorldStore((s) => s.updateSettings);
  const resetWorld = useWorldStore((s) => s.resetWorld);

  const [worldName, setWorldName] = useState(settings.worldName);
  const [colorTarget, setColorTarget] = useState<'ocean' | 'unowned' | 'border' | null>(null);

  const handleNameSubmit = useCallback(() => {
    if (worldName.trim()) {
      updateSettings({ worldName: worldName.trim() });
    }
  }, [worldName, updateSettings]);

  const handleReset = useCallback(() => {
    resetWorld();
    onClose();
  }, [resetWorld, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* World Name */}
            <Text style={styles.sectionTitle}>World Name</Text>
            <TextInput
              style={styles.textInput}
              value={worldName}
              onChangeText={setWorldName}
              onSubmitEditing={handleNameSubmit}
              onBlur={handleNameSubmit}
              placeholder="My World"
              placeholderTextColor="#546E7A"
              returnKeyType="done"
            />

            {/* Toggles */}
            <Text style={styles.sectionTitle}>Display</Text>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Show Borders</Text>
              <Switch
                value={settings.showBorders}
                onValueChange={(v) => updateSettings({ showBorders: v })}
                trackColor={{ false: '#263238', true: '#4FC3F7' }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Atmosphere</Text>
              <Switch
                value={settings.showAtmosphere}
                onValueChange={(v) => updateSettings({ showAtmosphere: v })}
                trackColor={{ false: '#263238', true: '#4FC3F7' }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Labels</Text>
              <Switch
                value={settings.showLabels}
                onValueChange={(v) => updateSettings({ showLabels: v })}
                trackColor={{ false: '#263238', true: '#4FC3F7' }}
                thumbColor="#fff"
              />
            </View>

            {/* Colors */}
            <Text style={styles.sectionTitle}>Colors</Text>
            {(['ocean', 'unowned', 'border'] as const).map((target) => {
              const colorKey =
                target === 'ocean'
                  ? 'oceanColor'
                  : target === 'unowned'
                    ? 'unownedRegionColor'
                    : 'borderColor';

              return (
                <View key={target}>
                  <TouchableOpacity
                    style={styles.colorRow}
                    onPress={() =>
                      setColorTarget(colorTarget === target ? null : target)
                    }
                  >
                    <View
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: settings[colorKey] },
                      ]}
                    />
                    <Text style={styles.colorLabel}>
                      {target.charAt(0).toUpperCase() + target.slice(1)} Color
                    </Text>
                  </TouchableOpacity>
                  {colorTarget === target && (
                    <View style={styles.pickerContainer}>
                      <ColorPicker
                        value={settings[colorKey]}
                        onChange={(color) => {
                          updateSettings({ [colorKey]: color });
                          setColorTarget(null);
                        }}
                      />
                    </View>
                  )}
                </View>
              );
            })}

            {/* Danger Zone */}
            <Text style={[styles.sectionTitle, { color: '#E53935' }]}>
              Danger Zone
            </Text>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Text style={styles.resetBtnText}>Reset World</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0D0D1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A2E',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ECEFF1',
  },
  close: {
    fontSize: 22,
    color: '#78909C',
    padding: 4,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78909C',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#ECEFF1',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#263238',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  toggleLabel: {
    fontSize: 16,
    color: '#ECEFF1',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  colorLabel: {
    fontSize: 16,
    color: '#ECEFF1',
  },
  pickerContainer: {
    paddingVertical: 12,
  },
  resetBtn: {
    backgroundColor: 'rgba(229, 57, 53, 0.12)',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#E53935',
    fontSize: 16,
    fontWeight: '700',
  },
});
