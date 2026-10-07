/**
 * ============================================================================
 * ToolBar.tsx — Editor Tool Selector
 * ============================================================================
 *
 * Floating toolbar that lets the user switch between editing tools:
 * select, paint, erase, split, fuse.
 */

import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native';
import { useWorldStore } from '../../store/useWorldStore';
import type { EditorTool } from '../../types';

const TOOLS: { id: EditorTool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '👆' },
  { id: 'paint', label: 'Paint', icon: '🎨' },
  { id: 'erase', label: 'Erase', icon: '🧹' },
  { id: 'split', label: 'Split', icon: '✂️' },
  { id: 'fuse', label: 'Fuse', icon: '🔗' },
];

export function ToolBar() {
  const activeTool = useWorldStore((s) => s.interaction.activeTool);
  const setActiveTool = useWorldStore((s) => s.setActiveTool);

  return (
    <View style={styles.container}>
      {TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.id}
          style={[
            styles.button,
            activeTool === tool.id && styles.active,
          ]}
          onPress={() => setActiveTool(tool.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.icon}>{tool.icon}</Text>
          <Text
            style={[
              styles.label,
              activeTool === tool.id && styles.activeLabel,
            ]}
          >
            {tool.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 56,
  },
  active: {
    backgroundColor: 'rgba(79, 195, 247, 0.25)',
  },
  icon: {
    fontSize: 20,
    marginBottom: 2,
  },
  label: {
    fontSize: 10,
    color: '#B0BEC5',
    fontWeight: '600',
  },
  activeLabel: {
    color: '#4FC3F7',
  },
});
