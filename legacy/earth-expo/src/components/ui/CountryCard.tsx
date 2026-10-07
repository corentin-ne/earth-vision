/**
 * ============================================================================
 * CountryCard.tsx — Country Info / Edit Card
 * ============================================================================
 *
 * A card component displayed inside the BottomSheet when a country
 * is selected. Allows editing name, color, flag, and region list.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useWorldStore } from '../../store/useWorldStore';
import type { CountryId } from '../../types';
import { ColorPicker } from './ColorPicker';

interface CountryCardProps {
  countryId: CountryId;
}

export function CountryCard({ countryId }: CountryCardProps) {
  const country = useWorldStore((s) => s.countries[countryId]);
  const updateCountry = useWorldStore((s) => s.updateCountry);
  const deleteCountry = useWorldStore((s) => s.deleteCountry);
  const selectCountry = useWorldStore((s) => s.selectCountry);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(country?.name ?? '');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleNameSubmit = useCallback(() => {
    if (nameInput.trim()) {
      updateCountry(countryId, { name: nameInput.trim() });
    }
    setEditingName(false);
  }, [countryId, nameInput, updateCountry]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Country',
      `Are you sure you want to delete "${country?.name}"? All regions will become unowned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteCountry(countryId);
            selectCountry(null);
          },
        },
      ],
    );
  }, [country?.name, countryId, deleteCountry, selectCountry]);

  if (!country) return null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.colorDot, { backgroundColor: country.color }]}
          onPress={() => setShowColorPicker(!showColorPicker)}
        />

        {editingName ? (
          <TextInput
            style={styles.nameInput}
            value={nameInput}
            onChangeText={setNameInput}
            onSubmitEditing={handleNameSubmit}
            onBlur={handleNameSubmit}
            autoFocus
            returnKeyType="done"
          />
        ) : (
          <TouchableOpacity
            onPress={() => {
              setNameInput(country.name);
              setEditingName(true);
            }}
          >
            <Text style={styles.name}>{country.name}</Text>
          </TouchableOpacity>
        )}

        {country.flag && <Text style={styles.flag}>{country.flag}</Text>}
      </View>

      {/* Color Picker */}
      {showColorPicker && (
        <ColorPicker
          value={country.color}
          onChange={(color) => {
            updateCountry(countryId, { color });
            setShowColorPicker(false);
          }}
        />
      )}

      {/* Stats */}
      <View style={styles.stats}>
        <Text style={styles.stat}>
          {country.regionIds.length} region
          {country.regionIds.length !== 1 ? 's' : ''}
        </Text>
        <Text style={styles.stat}>
          Created {new Date(country.createdAt).toLocaleDateString()}
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Delete Country</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ECEFF1',
  },
  nameInput: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ECEFF1',
    borderBottomWidth: 1,
    borderBottomColor: '#4FC3F7',
    paddingVertical: 0,
    flex: 1,
  },
  flag: {
    fontSize: 24,
    marginLeft: 'auto',
  },
  stats: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    fontSize: 13,
    color: '#78909C',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  deleteBtn: {
    backgroundColor: 'rgba(229, 57, 53, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  deleteBtnText: {
    color: '#E53935',
    fontSize: 14,
    fontWeight: '600',
  },
});
